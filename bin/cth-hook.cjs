#!/usr/bin/env node
'use strict';
const net = require('net');
const http = require('http');
const isStatus = process.argv.includes('--status');
// Under the listener's 256 KB frame limit (core/hookServer.ts MAX_HOOK_FRAME_BYTES), with room for the office token.
const HOOK_FRAME_ROOM = 200 * 1024;
// THE RELAY WAY (Cloud Office M8, PR 27c2). Inside the laptop sandbox VM
// there is no HIVE_SOCK: the host's socket never enters the VM. The worker
// there listens on loopback and names itself in MD_WORKER_RELAY; the same
// JSON that would be written to the socket is POSTed to
// <MD_WORKER_RELAY>/hook/<AGENT_ID>, with no Authorization header (the worker
// passes it to the app, which adds its own token and applies its checks), and
// the reply body is what the socket would have answered. Only when HIVE_SOCK
// is absent, and only to http on this machine: any other address is ignored,
// so a changed variable cannot send a hook payload off the machine.
function relayTarget(agentId) {
  const base = process.env.MD_WORKER_RELAY;
  if (!base || !agentId) return null;
  try {
    const u = new URL(base);
    if (u.protocol !== 'http:' || (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost')) return null;
    let p = u.pathname;
    while (p.length && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
    return { host: u.hostname, port: u.port || 80, path: p + '/hook/' + encodeURIComponent(agentId) };
  } catch (_) { return null; }
}
// One POST. onEnd gets the reply body, or '' when the worker did not answer
// with 200: a hook never blocks a stop because the relay is down.
function relayPost(target, payload, onEnd) {
  const body = JSON.stringify(payload);
  try {
    const req = http.request({ host: target.host, port: target.port, path: target.path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { out += d; });
      res.on('end', () => onEnd(res.statusCode === 200 ? out : ''));
      res.on('error', () => onEnd(''));
    });
    req.on('error', () => onEnd(''));
    req.end(body);
  } catch (_) { onEnd(''); }
}
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { data += d; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(data || '{}'); } catch (_) {}
  if (!payload.agent_id) payload.agent_id = process.env.AGENT_ID || null;
  // M30-460: what a tool gave back is never read by the app, and an image or a PDF read made the frame 310 to 327 KB,
  // over the listener's 256 KB, so the whole event was refused. It goes nowhere now. A payload still too large (a
  // very long prompt, a tool asked to write a large file) keeps the prompt's end, which proves it was taken, and
  // drops what the tool was asked: the event itself always arrives.
  if (payload && typeof payload === 'object') {
    delete payload.tool_response;
    if (Buffer.byteLength(JSON.stringify(payload)) > HOOK_FRAME_ROOM) {
      delete payload.tool_input;
      if (typeof payload.prompt === 'string') payload.prompt = payload.prompt.slice(-4096);
      if (typeof payload.last_assistant_message === 'string') payload.last_assistant_message = payload.last_assistant_message.slice(-4096);
    }
  }
  const sock = process.env.HIVE_SOCK;
  // A Cloud Office starts each terminal with a token of its own. The listener
  // there takes an event only with it, and only for the agent this terminal was
  // started as. Sent on the socket alone, never to the relay. Absent on a laptop.
  // An office hands over the PATH of a file that holds the token, never the
  // token itself: a terminal's environment can end up on a command line.
  let officeToken = process.env.MD_OFFICE_HOOK_TOKEN || '';
  if (!officeToken && process.env.MD_OFFICE_HOOK_TOKEN_FILE) {
    try { officeToken = require('fs').readFileSync(process.env.MD_OFFICE_HOOK_TOKEN_FILE, 'utf8').trim(); } catch (_) {}
  }
  if (sock && officeToken) {
    payload.hive_launch_agent = process.env.AGENT_ID || '';
    payload.hive_hook_token = officeToken;
  }
  // The socket whenever there is one (the laptop, unchanged); the relay only without it.
  const relay = sock ? null : relayTarget(payload.agent_id);
  if (isStatus) {
    // Status-line mode: Claude Code pipes the session status JSON (incl.
    // context_window.total_input_tokens / .context_window_size) after every
    // response. Print the in-terminal gauge IMMEDIATELY (the TUI is waiting),
    // then forward the payload to the harness fire-and-forget so the agent
    // card's context gauge updates push-based, with the EXACT window size.
    payload.hook_event_name = 'Status';
    const cw = payload.context_window || {};
    const used = cw.total_input_tokens, size = cw.context_window_size;
    if (typeof used === 'number' && typeof size === 'number' && size > 0) {
      const pct = Math.round((used / size) * 100);
      process.stdout.write('ctx ' + Math.round(used / 1000) + 'k/' + Math.round(size / 1000) + 'k (' + pct + '%)');
    }
    if (sock) {
      try {
        const c = net.createConnection(sock, () => { c.end(JSON.stringify(payload) + '\n'); });
        c.on('error', () => {});
        c.on('close', () => process.exit(0));
      } catch (_) { process.exit(0); }
    } else if (relay) {
      // Fire and forget, like the socket: the gauge is already printed.
      relayPost(relay, payload, () => process.exit(0));
    } else {
      process.exit(0);
    }
    setTimeout(() => process.exit(0), 1500).unref();
    return;
  }
  if (!sock && relay) {
    // The reply body is written out as the socket's reply is: verbatim.
    relayPost(relay, payload, (out) => { if (out) process.stdout.write(out); process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
    return;
  }
  if (!sock) { process.exit(0); }
  let resp = '';
  const done = (code) => { if (resp) process.stdout.write(resp); process.exit(code); };
  const c = net.createConnection(sock, () => c.write(JSON.stringify(payload) + '\n'));
  c.setEncoding('utf8');
  c.on('data', (d) => { resp += d; });
  c.on('end', () => done(0));
  c.on('error', () => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
