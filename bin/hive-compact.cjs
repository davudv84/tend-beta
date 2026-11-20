#!/usr/bin/env node
'use strict';

/* Reclaim the space the hive repo took before it learned not to.
 *
 * Usage, with Munder Difflin CLOSED:
 *   node <hive>/bin/hive-compact.cjs            report only, changes nothing
 *   node <hive>/bin/hive-compact.cjs --yes      do it
 *
 * It rewrites history, so every commit id in the hive repo changes. Nothing
 * outside the hive reads those ids. No file in the working tree is touched.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// The hive's real path: a hive reached through a link is still the hive, and
// a git that sits inside it is never the one to run.
let REAL_ROOT = ROOT;
try { REAL_ROOT = fs.realpathSync(ROOT); } catch (e) { /* as named */ }
const GO = process.argv.includes('--yes');

// The hive's .git/config can be written by an agent. Git never reads it here:
// it runs on a private copy that holds only the keys on the allow list
// (the same list and the same code as the app's own git,
// src/shared/gitConfigAllow.ts and src/core/gitSafe.ts), with the fixed
// switches on top.
const GIT_CONFIG_ALLOW = [{"key":"core\\.repositoryformatversion","value":"[01]","why":"git must know the layout of the repository to read it at all"},{"key":"extensions\\.objectformat","value":"sha1|sha256","why":"a sha256 repository cannot be read without it"},{"key":"extensions\\.refstorage","value":"files|reftable","why":"a reftable repository has no readable refs without it"},{"key":"core\\.filemode","value":"(?:true|false|yes|no|on|off|0|1)","why":"on a disk with no executable bit every file would read as changed"},{"key":"core\\.precomposeunicode","value":"(?:true|false|yes|no|on|off|0|1)","why":"macOS file names in status; set by git init from the disk"},{"key":"core\\.ignorecase","value":"(?:true|false|yes|no|on|off|0|1)","why":"set by git init on a Mac or Windows disk; without it a file renamed only by case reads as untracked"},{"key":"core\\.symlinks","value":"(?:true|false|yes|no|on|off|0|1)","why":"set by git init where links cannot be made (Windows); without it every tracked link reads as a type change"},{"key":"core\\.autocrlf","value":"(?:true|false|yes|no|on|off|0|1)|input","why":"line endings; without it every CRLF file reads as modified"},{"key":"core\\.eol","value":"lf|crlf|native","why":"line endings, with core.autocrlf"},{"key":"core\\.safecrlf","value":"(?:true|false|yes|no|on|off|0|1)|warn","why":"line endings, with core.autocrlf; it only refuses or warns"},{"key":"core\\.sparsecheckout","value":"(?:true|false|yes|no|on|off|0|1)","why":"a sparse work tree set the older way; without it a switch would fill the whole tree in"},{"key":"core\\.sparsecheckoutcone","value":"(?:true|false|yes|no|on|off|0|1)","why":"how the sparse patterns are read, with core.sparsecheckout"},{"key":"core\\.logallrefupdates","value":"(?:true|false|yes|no|on|off|0|1)|always","why":"keeps the reflog as the repository had it"},{"key":"core\\.untrackedcache","value":"(?:true|false|yes|no|on|off|0|1)|keep","why":"the hive turns it on for its own repository; it only speeds status up"},{"key":"pack\\.windowmemory","value":"[0-9]+[kmg]?","why":"the hive bounds what a repack may use"},{"key":"pack\\.packsizelimit","value":"[0-9]+[kmg]?","why":"the hive bounds what a repack may use"},{"key":"pack\\.threads","value":"[0-9]+","why":"the hive bounds what a repack may use"},{"key":"branch\\.[^\\x00-\\x1f]+\\.remote","value":"\\.|[A-Za-z0-9_][A-Za-z0-9_./@+-]*","why":"the upstream of a branch, for ahead and behind"},{"key":"branch\\.[^\\x00-\\x1f]+\\.merge","value":"refs/[A-Za-z0-9_][A-Za-z0-9_./@+-]*","why":"the upstream of a branch, for ahead and behind"},{"key":"remote\\.[^\\x00-\\x20-][^\\x00-\\x20]*\\.url","value":"(?:https://|ssh://)[A-Za-z0-9_.@:\\[\\]-]+/[^\\x00-\\x1f]*|[A-Za-z0-9_][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9.-]*:[^\\x00-\\x1f]+","why":"gh reads it to find the repository on GitHub; no git transport runs"},{"key":"remote\\.[^\\x00-\\x20-][^\\x00-\\x20]*\\.fetch","value":"\\+?refs/[A-Za-z0-9_./*@+-]+:refs/[A-Za-z0-9_./*@+-]+","why":"maps a branch to its remote tracking ref, for ahead and behind"},{"key":"extensions\\.partialclone","value":"[A-Za-z0-9_][A-Za-z0-9_./@+-]*","why":"a partial clone names the remote its missing objects come from"},{"key":"remote\\.[^\\x00-\\x20-][^\\x00-\\x20]*\\.promisor","value":"(?:true|false|yes|no|on|off|0|1)","why":"marks the remote a partial clone would fetch its missing objects from"},{"key":"remote\\.[^\\x00-\\x20-][^\\x00-\\x20]*\\.partialclonefilter","value":"blob:none|blob:limit=[0-9]+[kmg]?|tree:[0-9]+","why":"the filter of a partial clone, kept so the clone reads as what it is; the app never fetches"},{"key":"remote\\.[^\\x00-\\x20-][^\\x00-\\x20]*\\.gh-resolved","value":"[A-Za-z0-9_][A-Za-z0-9_./@+-]*","why":"the note gh keeps of which remote is the base"},{"key":"user\\.name","value":"[^\\x00-\\x1f\\x7f]{1,256}","why":"the name a temp's teardown commit is made under, as the repository sets it"},{"key":"user\\.email","value":"[^\\x00-\\x1f\\x7f]{1,256}","why":"the address a temp's teardown commit is made under, as the repository sets it"},{"key":"user\\.useconfigonly","value":"(?:true|false|yes|no|on|off|0|1)","why":"the repository forbids git to guess an identity from the machine"}];
const parseConfigList = function parseConfigList(text2) {
  var parts = text2.split("\0");
  var out2 = [];
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    var at2 = parts[i].indexOf("\n");
    out2.push({ scope: "local", key: at2 < 0 ? parts[i] : parts[i].slice(0, at2), value: at2 < 0 ? null : parts[i].slice(at2 + 1) });
  }
  return out2;
};
const privateConfigText = function privateConfigText(entries, allow) {
  var quote2 = function(s) {
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
  };
  var out2 = "";
  var keyIs = [];
  var valueIs = [];
  for (var k = 0; k < allow.length; k++) {
    keyIs.push(new RegExp("^(?:" + allow[k].key + ")$"));
    valueIs.push(new RegExp("^(?:" + allow[k].value + ")$", "i"));
  }
  var answers = /* @__PURE__ */ new Map();
  var kept2 = 0;
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.scope !== "local") continue;
    var v = e.value === null ? "true" : e.value;
    var forKey = answers.get(e.key);
    var allowed = forKey ? forKey.get(v) : void 0;
    if (allowed === void 0) {
      allowed = false;
      for (var j = 0; j < allow.length; j++) {
        if (keyIs[j].test(e.key) && valueIs[j].test(v)) {
          allowed = true;
          break;
        }
      }
      if (kept2 < 4096) {
        if (!forKey) {
          forKey = /* @__PURE__ */ new Map();
          answers.set(e.key, forKey);
        }
        forKey.set(v, allowed);
        kept2++;
      }
    }
    if (!allowed) continue;
    var first = e.key.indexOf(".");
    var last = e.key.lastIndexOf(".");
    if (first <= 0 || last === e.key.length - 1) continue;
    var section = e.key.slice(0, first);
    var sub = last > first ? e.key.slice(first + 1, last) : null;
    var name = e.key.slice(last + 1);
    out2 += sub === null ? "[" + section + "]\n" : "[" + section + ' "' + sub.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"]\n';
    out2 += "	" + name + " = " + quote2(v) + "\n";
  }
  return out2;
};
const SAFE_GIT = [['core.fsmonitor', 'false'], ['core.hooksPath', process.platform === 'win32' ? path.join(os.tmpdir(), 'md-no-hooks-' + process.pid + '-' + Date.now()) : '/dev/null'],
  ['log.showSignature', 'false'], ['submodule.recurse', 'false'], ['diff.ignoreSubmodules', 'all'], ['safe.bareRepository', 'explicit'], ['maintenance.auto', 'false'], ['gc.autoDetach', 'false'],
  ['core.pager', 'cat'], ['core.askPass', ''], ['credential.helper', ''], ['core.attributesFile', os.devNull]];

/* git by its full path, from the absolute folders of PATH: never one that
 * sits in the hive (on Windows a bare name is looked for in the cwd first). */
function findGit() {
  const win = process.platform === 'win32';
  for (const dir of (process.env.PATH || process.env.Path || '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const ext of win ? ['.exe', '.com'] : ['']) {
      const p = path.join(dir, 'git' + ext);
      try {
        const st = fs.statSync(p);
        const real = fs.realpathSync(p);
        if (st.isFile() && (win || (st.mode & 0o111) !== 0) && !real.startsWith(REAL_ROOT + path.sep)) return p;
      } catch (e) { /* not here */ }
    }
  }
  return null;
}
const GIT = findGit();

/* Where this script keeps its private folder: beside the hive, in the home
 * folder that holds it, made for this user alone. Not inside the hive and
 * not the system temp folder, which an agent may write. */
let PRIVATE_ROOT = null;
function privateRoot() {
  if (PRIVATE_ROOT) return PRIVATE_ROOT;
  const dir = process.env.MD_GIT_PRIVATE_ROOT || path.resolve(ROOT, '..', '.md-git-private');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(dir).isDirectory()) die('The private folder is not a folder: ' + dir);
  if (process.platform !== 'win32') fs.chmodSync(dir, 0o700);
  PRIVATE_ROOT = fs.mkdtempSync(path.join(fs.realpathSync(dir), 'md-git-'));
  process.on('exit', () => { try { fs.rmSync(PRIVATE_ROOT, { recursive: true, force: true }); } catch (e) { /* a temp folder */ } });
  return PRIVATE_ROOT;
}
function safeGitEnv(more) {
  const env = {};
  for (const k of Object.keys(process.env)) if (!/^GIT_/i.test(k)) env[k] = process.env[k];
  env.GIT_ALLOW_PROTOCOL = '';
  env.GIT_NO_LAZY_FETCH = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_ASKPASS = '';
  env.GIT_LFS_SKIP_SMUDGE = '1';
  env.GIT_CONFIG_COUNT = String(SAFE_GIT.length);
  SAFE_GIT.forEach((kv, i) => { env['GIT_CONFIG_KEY_' + i] = kv[0]; env['GIT_CONFIG_VALUE_' + i] = kv[1]; });
  env.FILTER_BRANCH_SQUELCH_WARNING = '1';
  return Object.assign(env, more || {});
}

const REAL_GIT = path.join(ROOT, '.git');
let PRIVATE = null;
/* The private folder git runs on: the copy of the config, and links to the
 * real objects and refs. Made once, removed when the script ends. Refuses
 * when .git or its config is not a plain folder and a plain file. */
/* The repository's own exclude rules, read as git reads them: through a
 * link. Not there, or a link to nothing: no rules. An ordinary file: its
 * text. Anything else, one that cannot be opened, or one over 1 MB: the
 * script stops, since carried as empty the files it left out would be taken. */
function excludeRules(file) {
  const no = function () { die('The exclude file of this repository (info/exclude in its .git folder) could not be read, so nothing was run. Replace it with an ordinary file under 1 MB that you can open, then try again.'); };
  const MAX = 1024 * 1024;
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0)); }
  catch (e) { if (e && e.code === 'ENOENT') return ''; no(); }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > MAX) no();
    const buf = Buffer.alloc(MAX + 1);
    let got = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, got, buf.length - got, null);
      if (n <= 0) break;
      got += n;
      if (got > MAX) no();
    }
    return buf.toString('utf8', 0, got);
  } catch (e) { no(); }
  finally { try { fs.closeSync(fd); } catch (e) { /* closed */ } }
}
function privateGitEnv() {
  if (PRIVATE) return PRIVATE.env;
  const plain = (p, what) => { try { const s = fs.lstatSync(p); return what === 'dir' ? s.isDirectory() : s.isFile(); } catch (e) { return false; } };
  const cfg = path.join(REAL_GIT, 'config');
  if (!plain(REAL_GIT, 'dir') || !plain(cfg, 'file') || fs.existsSync(path.join(REAL_GIT, 'commondir'))) die('The .git of this hive is not a plain repository. Nothing was run.');
  if (!GIT) die('git was not found on PATH. Nothing was run.');
  const base = privateRoot();
  const listed = spawnSync(GIT, ['config', '--file', cfg, '--no-includes', '-z', '--list'], { cwd: base, encoding: 'utf8', env: safeGitEnv() });
  if (listed.status !== 0) die('The settings of this repository could not be read. Nothing was run.');
  const common = path.join(base, '.git');
  const win = process.platform === 'win32';
  fs.mkdirSync(common, { mode: 0o700 });
  fs.writeFileSync(path.join(common, 'config'), privateConfigText(parseConfigList(listed.stdout || ''), GIT_CONFIG_ALLOW), { mode: 0o600 });
  for (const name of ['objects', 'refs', 'logs', 'worktrees', 'reftable', 'lfs']) fs.symlinkSync(path.join(REAL_GIT, name), path.join(common, name), 'junction');
  for (const name of ['packed-refs', 'shallow', 'HEAD']) {
    // Only a file that is NOT THERE is left out. One that is there and could not be copied is not "none":
    // git would write a new one in its place, and it would go back over the real file at the end.
    if (win) { try { fs.copyFileSync(path.join(REAL_GIT, name), path.join(common, name)); } catch (e) { if (!e || e.code !== 'ENOENT') die('A file of this repository (' + name + ') could not be copied. Nothing was run.'); } }
    else fs.symlinkSync(path.join(REAL_GIT, name), path.join(common, name), 'file');
  }
  fs.mkdirSync(path.join(common, 'info'));
  fs.writeFileSync(path.join(common, 'info', 'exclude'), excludeRules(path.join(REAL_GIT, 'info', 'exclude')), { mode: 0o600 });
  PRIVATE = { base, common, env: safeGitEnv({ GIT_DIR: REAL_GIT, GIT_COMMON_DIR: common, GIT_WORK_TREE: ROOT }) };
  process.on('exit', () => {
    // Windows: packed-refs was a copy. If git rewrote it, it goes back.
    if (win) { try { fs.copyFileSync(path.join(common, 'packed-refs'), path.join(REAL_GIT, 'packed-refs')); } catch (e) { /* none */ } }
  });
  return PRIVATE.env;
}

function git(args, opts) {
  const res = spawnSync(GIT, args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024,
    input: opts && opts.input, stdio: opts && opts.inherit ? 'inherit' : 'pipe',
    env: privateGitEnv()
  });
  return { ok: res.status === 0, out: res.stdout || '', err: res.stderr || '' };
}

function die(msg) { console.error(msg); process.exit(1); }

function human(bytes) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}

function repoBytes() {
  const v = git(['count-objects', '-v']);
  let total = 0;
  for (const line of v.out.split('\n')) {
    const m = /^(size|size-pack|size-garbage): (\d+)$/.exec(line.trim());
    if (m) total += Number(m[2]) * 1024;
  }
  return total;
}

/* The app holds this socket open while it runs. A rewrite underneath a live
 * committer would race the index and could lose a commit, so this is a refusal
 * and not a warning. The file surviving a crash is why we connect instead of
 * checking that it exists. */
function appearsRunning() {
  // A hive too deep for a socket keeps it in the temp folder (core/hookSockPlace.ts).
  const name = 'md-hive-' + require('crypto').createHash('sha256').update(ROOT).digest('hex').slice(0, 16);
  return [path.join(ROOT, 'hooks.sock'), path.join(require('os').tmpdir(), name, 'hooks.sock'), path.join('/tmp', name, 'hooks.sock')].some(socketAnswers);
}

function socketAnswers(sock) {
  if (!fs.existsSync(sock)) return false;
  const probe = spawnSync(process.execPath, ['-e', [
    'const net=require("net");const s=net.connect(process.argv[1]);',
    's.on("connect",()=>{s.destroy();process.exit(7)});',
    's.on("error",()=>process.exit(0));',
    'setTimeout(()=>{s.destroy();process.exit(0)},1500);'
  ].join('')  , sock], { timeout: 4000 });
  return probe.status === 7;
}

if (!fs.existsSync(path.join(ROOT, '.git'))) die('No git repo at ' + ROOT);
if (appearsRunning()) die('Munder Difflin is running. Quit it first: this rewrites the hive history.');

const before = repoBytes();
console.log('hive: ' + ROOT);
console.log('repo: ' + human(before));

/* Every path that has ever had a blob, with what its blobs weigh in the pack. */
const rev = git(['rev-list', '--objects', '--all']);
if (!rev.ok) die('git rev-list failed: ' + rev.err);
const check = git(['cat-file', '--batch-check=%(objecttype) %(objectsize:disk) %(rest)'], { input: rev.out });
if (!check.ok) die('git cat-file failed: ' + check.err);

const weight = new Map();
for (const line of check.out.split('\n')) {
  const sp = line.indexOf(' ');
  if (sp < 0 || line.slice(0, sp) !== 'blob') continue;
  const rest = line.slice(sp + 1);
  const sp2 = rest.indexOf(' ');
  if (sp2 < 0) continue;
  const size = Number(rest.slice(0, sp2));
  const file = rest.slice(sp2 + 1);
  if (!file) continue;
  weight.set(file, (weight.get(file) || 0) + size);
}

/* Anything the hive still tracks keeps all of its history. */
const live = new Set(git(['ls-files', '-z']).out.split('\0').filter(Boolean));
const dead = [...weight.entries()].filter(([p]) => !live.has(p)).sort((a, b) => b[1] - a[1]);
const reclaim = dead.reduce((n, [, s]) => n + s, 0);

if (dead.length === 0) { console.log('Nothing to compact: every path in history is still tracked.'); process.exit(0); }

console.log('');
console.log(dead.length + ' path(s) no longer tracked, holding ' + human(reclaim) + ' of packed history:');
for (const [p, s] of dead.slice(0, 15)) console.log('  ' + human(s).padStart(8) + '  ' + p);
if (dead.length > 15) console.log('  ... and ' + (dead.length - 15) + ' more');
console.log('');
console.log('Their files stay on disk. Only their history goes.');

if (!GO) {
  console.log('');
  console.log('This was a report. Run again with --yes to rewrite.');
  process.exit(0);
}

const listFile = path.join(privateRoot(), 'compact.paths');
fs.writeFileSync(listFile, dead.map(([p]) => ':(literal)' + p).join('\0') + '\0');

console.log('');
console.log('Rewriting. This walks every commit and takes minutes on a large hive.');
const filter = 'git rm --cached -q --ignore-unmatch --pathspec-from-file=' + JSON.stringify(listFile) + ' --pathspec-file-nul';
const rewrite = git(['filter-branch', '-f', '--index-filter', filter, '--prune-empty', '--tag-name-filter', 'cat', '--', '--all'], { inherit: true });
fs.unlinkSync(listFile);
if (!rewrite.ok) die('filter-branch failed. The repo is unchanged apart from .git/refs/original, which you can delete.');

fs.rmSync(path.join(ROOT, '.git', 'refs', 'original'), { recursive: true, force: true });
git(['reflog', 'expire', '--expire=now', '--expire-unreachable=now', '--all']);
/* Bounded on purpose: an unbounded repack of a hive this size is what took
 * 22GB of RAM and swapped a machine. Slower here, and it finishes. */
git(['-c', 'pack.windowMemory=128m', '-c', 'pack.packSizeLimit=1g', '-c', 'pack.threads=1',
     'gc', '--prune=now'], { inherit: true });

const after = repoBytes();
console.log('');
console.log('repo: ' + human(before) + ' -> ' + human(after) + '  (' + human(Math.max(0, before - after)) + ' reclaimed)');
console.log('Every file in the hive is still on disk. Open the app again when ready.');
