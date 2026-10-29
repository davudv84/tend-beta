#!/usr/bin/env node
// Builds the files TEND serves to developers at /sdk/, so connecting an agent needs no access to this repository:
//   /sdk/tend.mjs        connectTend, createGate, guardTool, notDone, runChatAgent, PROVIDERS, toRequest, startProxy; also the MCP proxy:
//                        node tend.mjs -- <mcp server command>    (with TEND_URL and TEND_AGENT_KEY in the environment)
//   /sdk/tend_gate.py    the standard-library Python client (Gate, guard_tool)
//   /sdk/notes-server.mjs  the harmless MCP server, to try the proxy
//   /sdk/sample.mjs      a sample agent with three tools behind TEND, scripted or driven by Claude (--claude)
// tend.mjs is the shipped modules (examples/) concatenated in dependency order, with their imports of each other removed and their imports of
// Node built-ins merged: the same code, not a copy kept by hand. No dependencies. The output is committed; sdk.test.mjs fails if it is stale.
//
//   node scripts/build-sdk.mjs            write public/sdk/
//   node scripts/build-sdk.mjs --check    exit 1 if public/sdk/ differs from what would be written
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const OUT = path.join(root, "public/sdk");
const ORDER = ["examples/claude-agent/gate.mjs", "examples/claude-quickstart/tend-client.mjs", "examples/mcp-proxy/tend-mcp-proxy.mjs", "examples/adapters/guard.mjs", "examples/adapters/openai-compatible.mjs"];

export function bundle() {
  const builtins = new Map(); // module -> Set of names
  const bodies = [];
  for (const file of ORDER) {
    let src = readFileSync(path.join(root, file), "utf8").replace(/^#!.*\n/, "");
    src = src.replace(/^import \{([^}]+)\} from "(node:[^"]+)";\n/gm, (_, names, mod) => {
      for (const n of names.split(",").map((x) => x.trim()).filter(Boolean)) (builtins.get(mod) ?? builtins.set(mod, new Set()).get(mod)).add(n);
      return "";
    });
    src = src.replace(/^import [^;]+ from "\.\.?\/[^"]+";\n/gm, "");
    // The proxy's command-line check imports a sibling file; the bundle checks the version inline instead.
    src = src.replace('  await import("../real-agents/node-check.mjs");\n', '  if (Number(process.versions.node.split(".")[0]) < 18) { console.error("Node 18 or newer is needed."); process.exit(2); }\n');
    if (/from "\.\.?\//.test(src) || /import\("\.\.?\//.test(src)) throw new Error(`${file}: an import of another file is left; extend build-sdk.mjs`);
    bodies.push(`// ---- ${file} ${"-".repeat(Math.max(0, 100 - file.length))}\n${src.trim()}\n`);
  }
  const head = `// TEND for JavaScript agents, one file, no dependencies (Node 18+). Built from TEND's own examples by scripts/build-sdk.mjs.
//   import { connectTend, guardTool } from "./tend.mjs";
//   const gate = connectTend();                       // TEND_URL and TEND_AGENT_KEY from the environment
//   const sendEmail = guardTool(gate, "send_email", (args) => realSend(args));   // runs only on TEND's yes
// MCP proxy:  node tend.mjs -- <your MCP server command>   (the host starts this instead of the server)
// This is cooperative enforcement: code that skips the gate is not stopped.\n`;
  const imports = [...builtins].map(([mod, names]) => `import { ${[...names].sort().join(", ")} } from "${mod}";`).join("\n");
  return `${head}${imports}\n\n${bodies.join("\n")}`;
}

export function files() {
  return {
    "tend.mjs": bundle(),
    "tend_gate.py": readFileSync(path.join(root, "examples/python/tend_gate.py"), "utf8"),
    "notes-server.mjs": readFileSync(path.join(root, "examples/mcp-proxy/notes-server.mjs"), "utf8"),
    "sample.mjs": readFileSync(path.join(root, "examples/sdk-sample/sample.mjs"), "utf8"),
  };
}

if (process.argv[1] === import.meta.filename) {
  const out = files();
  if (process.argv.includes("--check")) {
    const stale = Object.entries(out).filter(([name, text]) => !existsSync(path.join(OUT, name)) || readFileSync(path.join(OUT, name), "utf8") !== text).map(([n]) => n);
    if (stale.length) { console.error(`public/sdk is out of date (${stale.join(", ")}): run node scripts/build-sdk.mjs`); process.exit(1); }
    console.log("public/sdk is up to date");
  } else {
    mkdirSync(OUT, { recursive: true });
    for (const [name, text] of Object.entries(out)) writeFileSync(path.join(OUT, name), text);
    console.log(`wrote public/sdk/${Object.keys(out).join(", public/sdk/")}`);
  }
}
