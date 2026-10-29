# API examples

Everything the dashboard and the `npm run tend` command line do goes through this HTTP API. Two kinds of caller:

- **The operator** (you) signs in with the admin token from `.env.local` and gets a session cookie. Only the operator can register agents, set
  rules, approve, revoke and read the full audit log.
- **An agent** sends its own key as `Authorization: Bearer tend_sk_...`. It can only ask for permission and use what it was given; it can never
  change rules or approve anything.

The block below is the whole flow with `curl`, against a TEND started with `npm run dev`. It is tested as written (copy it into a terminal in the
repository folder). It keeps the cookie and the agent key in files under a temporary folder and never prints them. It needs `jq`.

```bash
set -e
T=$(mktemp -d); URL=${TEND_URL:-http://localhost:3000}
ADMIN=$(grep '^TEND_ADMIN_TOKEN=' .env.local | cut -d= -f2)

# 1. Operator signs in (the cookie goes to a file, the token is never shown)
jq -n --arg t "$ADMIN" '{token:$t}' | curl -sf -c $T/jar -H 'content-type: application/json' -d @- $URL/api/operator/session > /dev/null

# 2. Register an agent; keep its key in a file
curl -sf -b $T/jar -H 'content-type: application/json' -d '{"name":"curl agent","model":"any","provider":"Custom"}' $URL/api/v1/agents > $T/agent.json
AGENT=$(jq -r .agent.id $T/agent.json); jq -r .apiKey $T/agent.json > $T/key; rm $T/agent.json

# 3. A central policy, assigned to that agent: reading is fine, sending asks a person, deleting never
CP=$(curl -sf -b $T/jar -H 'content-type: application/json' \
  -d '{"name":"curl baseline","rules":[{"tool":"read_ticket","action":"read","effect":"allow"},{"tool":"send_email","action":"send","effect":"approve"},{"tool":"delete_record","action":"delete","effect":"deny"}]}' \
  $URL/api/v1/central-policies | jq -r .centralPolicy.id)
curl -sf -b $T/jar -H 'content-type: application/json' -d "{\"assign\":[\"$AGENT\"]}" $URL/api/v1/central-policies/$CP/assignments > /dev/null

# 4. The agent asks before acting (its key, not the cookie)
ask() { curl -s -H "authorization: Bearer $(cat $T/key)" -H 'content-type: application/json' -d "$1" $URL/api/v1/authorizations; }
ask '{"tool":"delete_record","action":"delete","resource":"R-7"}' | jq -c '{status, reason}'     # {"status":"denied","reason":"policy_denied"}
REQ=$(ask '{"tool":"send_email","action":"send","resource":"team-1","detail":"Subject: hello"}' | jq -r .id)

# 5. The operator sees it waiting and approves exactly that request
curl -sf -b $T/jar $URL/api/v1/state | jq -c '.projection.authorizations[] | select(.status=="pending") | {id, tool, detail}'
curl -sf -b $T/jar -H 'content-type: application/json' -d '{"status":"approved"}' $URL/api/v1/reviews/$REQ > /dev/null

# 6. The agent claims a one-time token and spends it, repeating exactly what was approved; only then does it act
TOKEN=$(curl -s -X POST -H "authorization: Bearer $(cat $T/key)" $URL/api/v1/authorizations/$REQ/token | jq -r .token)
curl -s -H "authorization: Bearer $(cat $T/key)" -H 'content-type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"tool\":\"send_email\",\"action\":\"send\",\"resource\":\"team-1\",\"detail\":\"Subject: hello\"}" \
  $URL/api/v1/authorizations/$REQ/consume | jq -c '{authorized}'                                    # {"authorized":true}: now do the real thing, once

# 7. One change to the central policy governs the agent at once (no restart, no new key)
curl -sf -b $T/jar -H 'content-type: application/json' -d '{"rules":[{"tool":"send_email","action":"send","effect":"deny"}],"expectedVersion":1}' $URL/api/v1/central-policies/$CP > /dev/null
ask '{"tool":"send_email","action":"send","resource":"team-2"}' | jq -c '{status, reason}'          # {"status":"denied","reason":"policy_denied"}

# 8. The audit log (operator only), and revoking the agent
curl -sf -b $T/jar "$URL/api/v1/events?since=0" | jq -r --arg a "$AGENT" '.events[] | select(.agentId==$a) | .type' | sort | uniq -c
curl -sf -b $T/jar -X DELETE $URL/api/v1/agents/$AGENT/keys > /dev/null
ask '{"tool":"read_ticket","action":"read","resource":"T-1"}' | jq -c '{error}'                     # {"error":"invalid_key"}
rm -rf $T
```

## The same with the command line

```bash
npm run tester:agent -- "My agent" --rule read_ticket:read:allow        # registers the agent, saves its key to .env.agent
npm run tend -- policy create "Baseline" --rule send_email:send:approve --rule delete_record:delete:deny --assign "My agent"
npm run tend -- pending                                                  # what waits for you, with the exact text
npm run tend -- approve az_...                                           # or: reject az_...
npm run tend -- policy update "Baseline" --rule send_email:send:deny     # in force for every assigned agent at once
npm run tend -- audit --agent "My agent" --last 20
```

## Reference

| Who | Call | Body / answer |
|---|---|---|
| operator | `POST /api/operator/session` | `{ token }` -> session cookie |
| operator | `POST /api/v1/agents` | `{ name, model, provider }` (provider: Anthropic, OpenAI, Google or Custom) -> `{ agent, apiKey }`, the key shown once |
| operator | `POST /api/v1/agents/{id}/policy`, `GET` the same | the agent's own rules `{ rules, enforcement }`; the view shows the decision per gateway tool and where it came from |
| operator | `GET` / `POST /api/v1/central-policies` | list / create `{ name, rules }` |
| operator | `POST /api/v1/central-policies/{id}` | `{ rules, expectedVersion? }`: 409 `policy_changed` if someone saved first |
| operator | `POST /api/v1/central-policies/{id}/assignments` | `{ assign: [ids], unassign: [ids] }`, all or nothing |
| operator | `POST /api/v1/reviews/{id}` | `{ status: "approved" \| "rejected" }` |
| operator | `DELETE` / `POST /api/v1/agents/{id}/keys` | revoke the key (waiting requests are cancelled) / issue a new one (the old one stops) |
| operator | `GET /api/v1/state`, `GET /api/v1/events?since=N` | current state; the audit log in order (`more: true` means fetch again from the returned `seq`) |
| agent | `POST /api/v1/authorizations` | `{ tool, action, resource?, detail? }` (+ optional `Idempotency-Key` header) -> `approved`, `pending` or 403 `denied` |
| agent | `POST /api/v1/authorizations/{id}/token` | 202 while pending; 200 `{ token }` once approved; 403 if rejected, expired, cancelled or no longer allowed |
| agent | `POST /api/v1/authorizations/{id}/consume` | `{ token, tool, action, resource, detail }` exactly as approved -> 200 `{ authorized: true, ... }`; act only on that |

Rules are `{ tool, action, effect, resourcePrefix?, permission? }` with `effect` `allow`, `approve` or `deny`; `action` may be `*`. Identifiers
(`tool`, `action`, `resource`) are 1 to 64 letters, digits or `_ . : -`; `detail` is up to 200 printable characters. Anything without a rule is denied.
