"""TEND for Python agents, with only the standard library: the same contract as examples/claude-agent/gate.mjs.

    gate = Gate()                                  # TEND_URL and TEND_AGENT_KEY from the environment
    read_note = guard_tool(gate, "read_note", lambda id: notes[id])
    read_note(id="N-1")                            # runs only if TEND allows it; otherwise returns a "Not done: ..." sentence

Fail closed: a timeout, a network error, an error status or an unexpected answer all end in "do not act". Creating a request is retried
(it is idempotent); spending the one-time token never is. Nothing here prints a token or a key. Every outcome is reported to TEND's audit
log as a tool.called event. This is cooperative enforcement: code that skips the gate is not stopped (see docs/connectivity.md).
"""
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
import uuid

MORE = "… (shortened; bound to all arguments)"  # TEND accepts at most 200 characters of detail


class TendError(Exception):
    def __init__(self, status, code, body=None):
        super().__init__(f"TEND {status} {code}")
        self.status, self.code, self.body = status, code, body or {}


def to_request(name, args):
    """What TEND is asked for one call: the tool, "call", a hash of all arguments, and the readable arguments (shortened if long)."""
    text = json.dumps(args, separators=(",", ":"), ensure_ascii=False)
    detail = text if len(text) <= 200 else text[: 200 - len(MORE)] + MORE
    return {"tool": name, "action": "call", "resource": "args:" + hashlib.sha256(text.encode()).hexdigest()[:32], "detail": detail}


class Gate:
    def __init__(self, url=None, key=None, approval_timeout=120.0, poll=2.0, retries=2):
        self.url = (url or os.environ.get("TEND_URL") or "http://localhost:3000").rstrip("/")
        self.key = key or os.environ.get("TEND_AGENT_KEY")
        if not self.key:
            raise RuntimeError("TEND_AGENT_KEY is not set, so this agent has no identity at TEND. Register it once: npm run tester:agent")
        self.approval_timeout, self.poll, self.retries = approval_timeout, poll, retries

    def _call(self, path, body=None, headers=None):
        req = urllib.request.Request(self.url + path, method="POST" if body is not None else "GET",
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers={"authorization": f"Bearer {self.key}", "content-type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                data = json.loads(e.read() or b"{}")
            except ValueError:
                data = {}
            raise TendError(e.code, data.get("error"), data) from None
        except (urllib.error.URLError, OSError, ValueError):
            raise TendError(None, "unreachable") from None

    def _report(self, req, outcome, authorization_id=None, error=None, policy=None):
        data = {**req, "outcome": outcome, **({"authorizationId": authorization_id} if authorization_id else {}), **({"policy": policy} if policy else {}), **({"error": error} if error else {})}
        try:
            self._call("/api/v1/events", {"type": "tool.called", "data": data})
        except TendError:
            pass  # monitoring is best effort; the outcome stands either way

    def run(self, request, execute):
        """Run execute() at most once, and only after TEND authorized exactly this request. Returns a dict with "executed"."""
        req = {k: request[k] for k in ("tool", "action", "resource", "detail") if request.get(k)}
        auth_id = None

        def stop(outcome, reason=None, event="cancelled", policy=None):
            self._report(req, event, auth_id, f"{outcome}: {reason}" if reason else outcome, policy)
            return {"executed": False, "outcome": outcome, **({"reason": reason} if reason else {})}

        transient = lambda e: e.status is None or e.status >= 500
        idem = f"gate-{uuid.uuid4()}"
        for attempt in range(self.retries + 1):
            try:
                created = self._call("/api/v1/authorizations", req, {"Idempotency-Key": idem})
                break
            except TendError as e:
                if e.status == 403 and e.body.get("status") == "denied":
                    auth_id = e.body.get("id")
                    reason = e.body.get("reason")
                    return stop("denied", reason, "denied", reason if reason in ("policy_denied", "no_policy", "invalid_policy", "missing_permission") else None)
                if transient(e) and attempt < self.retries:
                    time.sleep(0.5)
                    continue
                return stop("unavailable" if transient(e) else "refused", e.code)
        auth_id = created.get("id")
        if not isinstance(auth_id, str) or created.get("status") not in ("pending", "approved"):
            return stop("refused", "unexpected_response")

        deadline = time.monotonic() + self.approval_timeout
        while True:
            try:
                claim = self._call(f"/api/v1/authorizations/{auth_id}/token", {})
                if claim.get("status") == "approved" and isinstance(claim.get("token"), str):
                    token = claim["token"]
                    break
                if claim.get("status") != "pending":
                    return stop("refused", "unexpected_response")
            except TendError as e:
                if not transient(e):
                    status = e.body.get("status") or e.body.get("reason") or e.code
                    return stop("rejected" if status == "rejected" else "expired" if status == "expired" else "refused", status, "denied" if status == "rejected" else "cancelled")
            if time.monotonic() >= deadline:
                try:
                    self._call(f"/api/v1/authorizations/{auth_id}/cancel", {})
                except TendError:
                    pass
                return stop("timeout", "no_decision")
            time.sleep(self.poll)

        try:
            used = self._call(f"/api/v1/authorizations/{auth_id}/consume", {"token": token, **req})
        except TendError as e:
            return stop("unavailable" if transient(e) else "refused", e.code)
        finally:
            token = None
        if used.get("authorized") is not True or used.get("authorizationId") != auth_id or any(used.get(k) != req.get(k) for k in ("tool", "action", "resource", "detail")):
            return stop("refused", "unexpected_response")

        try:
            result = execute()
        except Exception:
            self._report(req, "failure", auth_id, "execution_failed")
            return {"executed": True, "outcome": "failure", "authorization_id": auth_id}
        self._report(req, "success", auth_id)
        return {"executed": True, "outcome": "success", "result": result, "authorization_id": auth_id}


def not_done(out):
    return f"Not done: TEND did not allow this tool call ({out['outcome']}{': ' + str(out['reason']) if out.get('reason') else ''})."


def guard_tool(gate, name, fn):
    """fn(**args) runs only on TEND's yes; otherwise the model gets a sentence starting with "Not done"."""
    def guarded(**args):
        out = gate.run(to_request(name, args), lambda: fn(**args))
        if not out["executed"]:
            return not_done(out)
        return out["result"] if out["outcome"] == "success" else "TEND allowed this call, but the tool itself failed."
    return guarded
