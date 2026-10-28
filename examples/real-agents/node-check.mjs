// Imported first by the command-line tools: stops with one clear sentence on a Node version that would otherwise fail somewhere
// deep inside with a message nobody can act on (several scripts use node:util parseEnv, which needs Node 20.12 or newer).
const MIN = [20, 12];
const v = process.env.TEND_NODE_VERSION_FOR_TEST ?? process.versions.node;
const [maj, min] = v.split(".").map(Number);
if (maj < MIN[0] || (maj === MIN[0] && min < MIN[1])) {
  console.error(`TEND needs Node ${MIN.join(".")} or newer, and this is Node ${v}.\nInstall a current version (Node 22 or 24 is best) from https://nodejs.org or with a version manager (nvm install 24), then run this again.`);
  process.exit(2);
}
