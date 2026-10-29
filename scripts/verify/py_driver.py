"""Python drivers for scripts/verify-integrations.mjs. Gets the job as JSON on stdin, prints one JSON line: {"final", "usd"} or {"error"}.

    python3 -I py_driver.py http            TEND's HTTP API from Python (tend_gate.py) with Claude over the raw Messages API: stdlib only
    .verify/py-<framework>/bin/python -I py_driver.py pydantic_ai | autogen | crewai

Every tool goes through examples/python/tend_gate.py. Each attempt is written to the ledger before TEND is asked; the tool body writes
"ran" only when it really runs. The provider key comes from the environment and is never printed.
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "examples", "python"))
from tend_gate import Gate, guard_tool  # noqa: E402

MODEL = "claude-haiku-4-5"
usd = lambda i, o: (i * 1.0 + o * 5.0) / 1e6  # Claude Haiku 4.5 list price, USD per million tokens
NOTES = {"N-1": "Buy oat milk.", "N-2": "Team lunch on Friday."}
SPECS = {"read_note": ("Read a note by its id.", ["id"]), "delete_note": ("Delete a note by its id.", ["id"]), "send_note": ("Send a note to a recipient.", ["id", "to"])}


def make_tools(job):
    gate = Gate(url=job["url"], key=job["key"], approval_timeout=90, poll=0.3, retries=0)

    def log(ev, tool):
        with open(job["ledger"], "a") as f:
            f.write(json.dumps({"ev": ev, "tool": tool}) + "\n")

    def body(name):
        def run(**args):
            log("ran", name)
            if args.get("id") not in NOTES:
                return f"There is no note {args.get('id')}."
            return {"read_note": f"Note {args.get('id')}: {NOTES[args['id']]}", "delete_note": f"Deleted note {args.get('id')}.", "send_note": f"Sent note {args.get('id')} to {args.get('to')}."}[name]
        return run

    guarded = {n: guard_tool(gate, n, body(n)) for n in SPECS}

    def attempt(name, **args):
        log("attempt", name)
        return guarded[name](**args)

    # Plain typed functions with docstrings: what every Python framework turns into a tool.
    def read_note(id: str) -> str:
        """Read a note by its id, for example N-1."""
        return attempt("read_note", id=id)

    def delete_note(id: str) -> str:
        """Delete a note by its id, for example N-1."""
        return attempt("delete_note", id=id)

    def send_note(id: str, to: str) -> str:
        """Send a note (id, for example N-1) to a recipient (to, for example team-1)."""
        return attempt("send_note", id=id, to=to)

    return [read_note, delete_note, send_note]


def http_driver(job):
    """No SDK and no framework: Claude's Messages API and TEND's HTTP API, both over urllib."""
    fns = {f.__name__: f for f in make_tools(job)}
    tools = [{"name": n, "description": d, "input_schema": {"type": "object", "properties": {p: {"type": "string"} for p in ps}, "required": ps}} for n, (d, ps) in SPECS.items()]
    messages, i, o = [{"role": "user", "content": job["prompt"]}], 0, 0
    for _ in range(4):
        req = urllib.request.Request("https://api.anthropic.com/v1/messages", method="POST",
                                     data=json.dumps({"model": MODEL, "max_tokens": 400, "system": job["system"], "messages": messages, "tools": tools}).encode(),
                                     headers={"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01", "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as res:
            r = json.loads(res.read())
        i, o = i + r["usage"]["input_tokens"], o + r["usage"]["output_tokens"]
        messages.append({"role": "assistant", "content": r["content"]})
        uses = [c for c in r["content"] if c["type"] == "tool_use"]
        if not uses:
            return {"final": " ".join(c.get("text", "") for c in r["content"]), "usd": usd(i, o)}
        messages.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": u["id"], "content": str(fns[u["name"]](**u["input"]) if u["name"] in fns else "No such tool.")} for u in uses]})
    return {"final": "", "usd": usd(i, o)}


def pydantic_ai_driver(job):
    from pydantic_ai import Agent
    from pydantic_ai.usage import UsageLimits
    agent = Agent(f"anthropic:{MODEL}", system_prompt=job["system"], tools=make_tools(job))
    r = agent.run_sync(job["prompt"], usage_limits=UsageLimits(request_limit=4))
    u = r.usage() if callable(r.usage) else r.usage  # a method in older releases, a property in newer ones
    return {"final": str(r.output), "usd": usd(getattr(u, "input_tokens", 0) or 0, getattr(u, "output_tokens", 0) or 0)}


def autogen_driver(job):
    import asyncio
    from autogen_agentchat.agents import AssistantAgent
    from autogen_ext.models.anthropic import AnthropicChatCompletionClient

    async def go():
        # AutoGen 0.7.5 predates this model id, so its capabilities are declared (AutoGen's own model_info mechanism).
        info = {"vision": False, "function_calling": True, "json_output": False, "structured_output": False, "family": "unknown"}
        client = AnthropicChatCompletionClient(model=MODEL, max_tokens=400, model_info=info)
        agent = AssistantAgent("tend_verifier", model_client=client, tools=make_tools(job), system_message=job["system"], reflect_on_tool_use=True, max_tool_iterations=2)
        r = await agent.run(task=job["prompt"])
        await client.close()
        i = sum(m.models_usage.prompt_tokens for m in r.messages if getattr(m, "models_usage", None))
        o = sum(m.models_usage.completion_tokens for m in r.messages if getattr(m, "models_usage", None))
        return {"final": str(getattr(r.messages[-1], "content", "")), "usd": usd(i, o)}
    return asyncio.run(go())


def crewai_driver(job):
    from crewai import LLM, Agent, Crew, Task
    from crewai.tools import tool
    tools = [tool(f.__name__)(f) for f in make_tools(job)]
    agent = Agent(role="Test agent", goal="Do exactly what the task says, once.", backstory=job["system"], tools=tools, llm=LLM(model=f"anthropic/{MODEL}", max_tokens=400),
                  max_iter=3, cache=False, allow_delegation=False, verbose=False)
    crew = Crew(agents=[agent], tasks=[Task(description=job["prompt"], expected_output="One sentence saying what happened.", agent=agent)], verbose=False)
    out = crew.kickoff()
    m = crew.usage_metrics
    return {"final": str(out), "usd": usd(getattr(m, "prompt_tokens", 0) or 0, getattr(m, "completion_tokens", 0) or 0)}


if __name__ == "__main__":
    job = json.load(sys.stdin)
    drivers = {"http": http_driver, "pydantic_ai": pydantic_ai_driver, "autogen": autogen_driver, "crewai": crewai_driver}
    try:
        result = drivers[sys.argv[1]](job)
    except Exception as e:  # the harness reports it as ERROR; the key is never part of an exception message here
        result = {"error": f"{type(e).__name__}: {str(e)[:200]}"}
    print(json.dumps(result))
