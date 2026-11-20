# Connections: set them up yourself

Munder Difflin applies connection requests that an agent writes into its OWN folder:

    $AGENT_DIR/connections/requests/<anything>.json

One request per file, at most 16 KB. The app reads it within a few seconds,
removes it (it may hold a token), and writes the outcome to

    $AGENT_DIR/connections/results/<request id>.json

Results are removed after 24 hours. A result that holds a secret is readable by
you only. Never copy a secret into a message, a card or a log.

The current picture, with no secret or token in it, is in
connections/state.json next to this file.

Every request has "id" (letters, digits, dot, dash, underscore; up to 64) and
"op". Any other field, or an unknown op, is refused and nothing is applied.

  {"id":"r1","op":"webhook.add","webhook":{"name":"Support desk","to":"<agent id>","prompt":"Draft a reply.","auth":"bearer"}}
      webhook fields: name (required), description, source (custom|github|linear|telegram),
      auth (header|bearer|hmac, blank webhooks only), to (agent id, "temp", "temp:<agent id>" for a clone, "" = default agent),
      prompt, schema (JSON Schema as a string), mode (strict|allow-all|communication-only),
      guardrails (bool), enabled (bool, default true)
      result: webhookId, url (empty until the server has a public address), secret, sends
  {"id":"r2","op":"webhook.edit","webhookId":"wh-...","webhook":{"to":"<agent id>"}}
      the same fields, plus secret for a Linear webhook (the signing secret Linear shows)
  {"id":"r3","op":"webhook.remove","webhookId":"wh-..."}
  {"id":"r4","op":"webhook.rotateSecret","webhookId":"wh-..."}
  {"id":"r5","op":"slack.set","slack":{"enabled":true,"botToken":"xoxb-...","appToken":"xapp-...","channelId":"C0123"}}
      slack fields: enabled, mode (socket|polling|webhook), botToken, appToken,
      signingSecret, channelId, proactivePosting, pollSeconds, catchupSeconds
  {"id":"r6","op":"defaults.set","defaults":{"webhookResponder":"<agent id>","responder":"<agent id>"}}
      webhookResponder: who takes a webhook that names no agent; responder: who answers Slack

SCHEDULED MISSIONS (Automations > Schedules): a message sent to an agent on a timer.

  {"id":"r7","op":"mission.add","mission":{"label":"Board update","to":"<agent id>","body":"Run your board update.","intervalMs":43200000}}
      mission fields: label (required), body (required, what the agent is told),
      to (required: an agent id, "temp", or "temp:<agent id>"), intervalMs (at least 900000 = 15 minutes, at most 7 days)
      or weekly {"days":[1,2,3,4,5],"minute":540,"zone":"Asia/Kolkata"} (0 = Sunday; minute of the day, 540 = 09:00; zone is the person's IANA time zone, without it the time is this machine's clock, UTC in a Cloud Office),
      enabled (bool, default true)
      result: missionId
  {"id":"r8","op":"mission.edit","missionId":"m_...","mission":{"enabled":false}}
      the same fields; setting intervalMs switches a weekly mission back to an interval
  {"id":"r9","op":"mission.remove","missionId":"m_..."}
  {"id":"r10","op":"mission.list"}
      result: missions, each with canChange (whether you may edit or remove it)

  Rules: you may change only the missions you made. The founder's own and the
  built in ones are god's to change. At most 20 agent made missions per floor.
  The current list is also in state.json under "missions".

Everything you do here is logged with your agent id, and shows in Settings >
Connections and in Automations (a mission you made says so on its row).
