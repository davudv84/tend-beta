// Imported first by the command-line tools: stops with one clear sentence on a Node version that would otherwise fail somewhere
// deep inside with a message nobody can act on (several scripts use node:util parseEnv, which needs Node 20.12 or newer).
// With --tests (the npm "pretest" step) it checks the stricter requirement of the project's own test suite, which runs TypeScript
// directly: Node 22.18+, 23.6+ or 24+. The demo and the integration do not need that.
const tests = process.argv.includes("--tests");
const v = process.env.TEND_NODE_VERSION_FOR_TEST ?? process.versions.node;
const [maj, min] = v.split(".").map(Number);
const ok = tests ? maj >= 24 || (maj === 23 && min >= 6) || (maj === 22 && min >= 18) : maj > 20 || (maj === 20 && min >= 12);
if (!ok) {
  console.error(tests
    ? `The test suite runs TypeScript directly and needs Node 22.18 or newer (24 is what it is tested on); this is Node ${v}.\nThe demo and the integration still work on Node 20.12 or newer. To run the tests, install Node 24 (nodejs.org, or nvm install 24).`
    : `TEND needs Node 20.12 or newer, and this is Node ${v}.\nInstall a current version (Node 22 or 24 is best) from https://nodejs.org or with a version manager (nvm install 24), then run this again.`);
  process.exit(2);
}
