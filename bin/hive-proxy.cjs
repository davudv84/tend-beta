#!/usr/bin/env node
'use strict';
const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');
// Under the listener's 256 KB frame limit (core/hookServer.ts MAX_HOOK_FRAME_BYTES), with room for the office token.
const HOOK_FRAME_ROOM = 200 * 1024;
const HOOK_FRAME_KEEP = ['ping', 'hive_launch_agent', 'hive_hook_token', 'hook_event_name', 'agent_id', 'session_id', 'transcript_path', 'context_window', 'rate_limits', 'cwd', 'tool_name', 'stop_hook_active', 'prompt', 'source', 'notification_type', 'message', 'model', 'agent_type', 'input', 'output', 'cache_read', 'cache_creation'];
// UTF-8 bytes of the frame; counted by hand where a host gives no Buffer (an extension run in a bare context). A
// payload that cannot be written as JSON counts 0: it is left as it is, and its sender drops it as before.
function hookFrameBytes(p) {
  let s;
  try { s = JSON.stringify(p); } catch (e) { return 0; }
  if (typeof s !== 'string') return 0;
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(s);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}
function fitFrame(p) {
  if (!p || typeof p !== 'object') return p;
  delete p.tool_response;
  if (hookFrameBytes(p) <= HOOK_FRAME_ROOM) return p;
  delete p.tool_input;
  ['prompt', 'prompt_response', 'last_assistant_message', 'message'].forEach(function (k) {
    if (typeof p[k] === 'string') p[k] = p[k].slice(-4096);
  });
  if (hookFrameBytes(p) <= HOOK_FRAME_ROOM) return p;
  Object.keys(p).forEach(function (k) {
    if (HOOK_FRAME_KEEP.indexOf(k) === -1) delete p[k];
    else if (typeof p[k] === 'string') p[k] = p[k].slice(-4096);
  });
  return p;
}

const SOCK = process.env.HIVE_SOCK;
const AGENT_ID = process.env.AGENT_ID || null;
const UPSTREAM = process.env.UPSTREAM_BASE_URL || '';
const SESSION = process.env.HIVE_PROXY_SESSION || null;
const API = process.env.HIVE_PROXY_API === 'anthropic' ? 'anthropic' : 'openai';

function trimSlash(s) { while (s.length && s.charAt(s.length - 1) === '/') s = s.slice(0, -1); return s; }

// Per-model context-window size for the Status gauge; fallback 200k.
function ctxSize(model) {
  const m = String(model || '').toLowerCase();
  if (m.indexOf('[1m]') !== -1 || m.indexOf('-1m') !== -1) return 1000000;
  if (m.indexOf('claude') !== -1) return 200000;
  if (m.indexOf('gpt-4o') !== -1 || m.indexOf('gpt-4.1') !== -1 || m.indexOf('o1') !== -1 || m.indexOf('o3') !== -1) return 128000;
  if (m.indexOf('qwen') !== -1) return 262144;
  return 200000;
}

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
const RELAY = SOCK ? null : relayTarget(AGENT_ID);

// Fire-and-forget emit of a shim-shaped payload to the hive socket, or to the
// worker's relay when there is no socket. Never throws.
function emit(payload) {
  fitFrame(payload);
  if (!SOCK && RELAY) {
    try {
      const body = JSON.stringify(payload);
      const req = http.request({ host: RELAY.host, port: RELAY.port, path: RELAY.path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, function (res) { res.resume(); });
      req.on('error', function () {});
      req.setTimeout(5000, function () { req.destroy(); });
      req.end(body);
    } catch (e) {}
    return;
  }
  if (!SOCK) return;
  try {
    const c = net.createConnection(SOCK, function () { c.end(JSON.stringify(payload) + '\n'); });
    c.on('error', function () {});
  } catch (e) {}
}

let stopTimer = null;
function armStop() {
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = setTimeout(function () {
    stopTimer = null;
    emit({ hook_event_name: 'Stop', agent_id: AGENT_ID, session_id: SESSION });
  }, 800);
  if (stopTimer.unref) stopTimer.unref();
}
function cancelStop() { if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; } }

function safeArgs(s) {
  if (s == null) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch (e) { return { _raw: String(s).slice(0, 500) }; }
}

// Parse a completed response (single JSON or an SSE stream) and synthesize events.
function parseAndEmit(bodyStr, isSse) {
  const objs = [];
  if (isSse) {
    const lines = bodyStr.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const idx = ln.indexOf('data:');
      if (idx === -1) continue;
      const data = ln.slice(idx + 5).trim();
      if (!data || data === '[DONE]') continue;
      try { objs.push(JSON.parse(data)); } catch (e) {}
    }
  } else {
    try { objs.push(JSON.parse(bodyStr)); } catch (e) {}
  }
  if (!objs.length) { armStop(); return; }

  let model = null, input = 0, output = 0, cacheRead = 0, cacheCreation = 0, sawUsage = false;
  const toolCalls = [];
  const oaiTools = {}; // accumulate streaming openai tool_calls by index

  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    if (!o || typeof o !== 'object') continue;
    if (o.model) model = o.model;
    if (API === 'anthropic') {
      if (o.type === 'message_start' && o.message) {
        if (o.message.model) model = o.message.model;
        const u = o.message.usage || {};
        input += u.input_tokens || 0;
        cacheRead += u.cache_read_input_tokens || 0;
        cacheCreation += u.cache_creation_input_tokens || 0;
        sawUsage = true;
      } else if (o.type === 'message_delta' && o.usage) {
        output += o.usage.output_tokens || 0;
        sawUsage = true;
      } else if (o.type === 'content_block_start' && o.content_block && o.content_block.type === 'tool_use') {
        toolCalls.push({ name: o.content_block.name, input: o.content_block.input || {} });
      } else if (o.usage && !o.type) {
        // non-streaming full message body
        const u = o.usage;
        input += u.input_tokens || 0;
        output += u.output_tokens || 0;
        cacheRead += u.cache_read_input_tokens || 0;
        cacheCreation += u.cache_creation_input_tokens || 0;
        sawUsage = true;
      }
      if (Array.isArray(o.content)) {
        for (let j = 0; j < o.content.length; j++) {
          const blk = o.content[j];
          if (blk && blk.type === 'tool_use') toolCalls.push({ name: blk.name, input: blk.input || {} });
        }
      }
    } else {
      if (o.usage) {
        const u = o.usage;
        input += u.prompt_tokens || 0;
        output += u.completion_tokens || 0;
        if (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) cacheRead += u.prompt_tokens_details.cached_tokens;
        sawUsage = true;
      }
      const choices = o.choices || [];
      for (let c = 0; c < choices.length; c++) {
        const ch = choices[c];
        if (!ch) continue;
        if (ch.message && Array.isArray(ch.message.tool_calls)) {
          for (let t = 0; t < ch.message.tool_calls.length; t++) {
            const tc = ch.message.tool_calls[t];
            if (tc && tc.function) toolCalls.push({ name: tc.function.name, input: safeArgs(tc.function.arguments) });
          }
        }
        if (ch.delta && Array.isArray(ch.delta.tool_calls)) {
          for (let t = 0; t < ch.delta.tool_calls.length; t++) {
            const tc = ch.delta.tool_calls[t];
            if (!tc) continue;
            const k = (tc.index != null ? tc.index : t);
            if (!oaiTools[k]) oaiTools[k] = { name: null, args: '' };
            if (tc.function) {
              if (tc.function.name) oaiTools[k].name = tc.function.name;
              if (tc.function.arguments) oaiTools[k].args += tc.function.arguments;
            }
          }
        }
      }
    }
  }
  const keys = Object.keys(oaiTools);
  for (let i = 0; i < keys.length; i++) {
    const t = oaiTools[keys[i]];
    if (t.name) toolCalls.push({ name: t.name, input: safeArgs(t.args) });
  }

  if (sawUsage) {
    emit({ hook_event_name: 'Status', agent_id: AGENT_ID, context_window: { total_input_tokens: input + cacheRead + cacheCreation, context_window_size: ctxSize(model) } });
    emit({ hook_event_name: 'CostSample', agent_id: AGENT_ID, session_id: SESSION, model: model, input: input, output: output, cache_read: cacheRead, cache_creation: cacheCreation });
  }
  if (toolCalls.length) {
    cancelStop(); // a tool call means the turn continues
    for (let i = 0; i < toolCalls.length; i++) {
      emit({ hook_event_name: 'PostToolUse', agent_id: AGENT_ID, session_id: SESSION, tool_name: toolCalls[i].name, tool_input: toolCalls[i].input });
    }
  } else {
    armStop();
  }
}

let upstreamUrl = null;
try { upstreamUrl = new URL(UPSTREAM); } catch (e) {}

const server = http.createServer(function (req, res) {
  cancelStop(); // a new request means the turn is still going
  if (!upstreamUrl) { res.statusCode = 502; res.end('proxy: no upstream'); return; }
  let target;
  try { target = new URL(trimSlash(UPSTREAM) + req.url); } catch (e) { res.statusCode = 502; res.end('proxy: bad url'); return; }
  const isHttps = target.protocol === 'https:';
  const lib = isHttps ? https : http;
  const headers = Object.assign({}, req.headers);
  headers.host = target.host;
  // Ask upstream for plaintext so the tee can parse SSE/JSON reliably; the client
  // gets uncompressed bytes (loopback — negligible) and no content-encoding to undo.
  delete headers['accept-encoding'];
  const opts = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    method: req.method,
    path: target.pathname + target.search,
    headers: headers
  };
  const upReq = lib.request(opts, function (upRes) {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    const ct = String((upRes.headers['content-type'] || ''));
    const wantParse = ct.indexOf('json') !== -1 || ct.indexOf('event-stream') !== -1;
    const isSse = ct.indexOf('event-stream') !== -1;
    const chunks = [];
    let total = 0;
    upRes.on('data', function (chunk) {
      res.write(chunk); // stream straight through to the CLI
      if (wantParse && total < 4194304) { chunks.push(chunk); total += chunk.length; }
    });
    upRes.on('end', function () {
      res.end();
      if (wantParse && chunks.length) {
        try { parseAndEmit(Buffer.concat(chunks).toString('utf8'), isSse); } catch (e) {}
      }
    });
    upRes.on('error', function () { try { res.end(); } catch (e) {} });
  });
  upReq.on('error', function () { try { res.statusCode = 502; res.end('proxy: upstream error'); } catch (e) {} });
  req.pipe(upReq);
});

server.on('error', function () {
  try { process.stdout.write(JSON.stringify({ port: 0 }) + '\n'); } catch (e) {}
  process.exit(0);
});
server.listen(0, '127.0.0.1', function () {
  const addr = server.address();
  const port = (addr && typeof addr === 'object') ? addr.port : 0;
  try { process.stdout.write(JSON.stringify({ port: port }) + '\n'); } catch (e) {}
});
