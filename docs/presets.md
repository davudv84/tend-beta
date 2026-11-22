# Ready-made policies for coding assistants: versions

`src/lib/agent-presets.ts`. A preset is a list of ordinary policy rules. Presets are **versioned**, and a saved policy is never rewritten: it keeps the
rules of the version it was saved with. The dashboard recognises every version, shows an older one as such, and switches it to the current version
only when an operator saves it again. Nothing about an agent's protection changes without someone pressing Save.

| Preset | Version | Shell commands | Files | Web, MCP | Notes |
|---|---|---|---|---|---|
| Balanced | 1 | Run, unless the text contains `git push`, `rm `, `sudo `, `curl `, `wget `, `ssh `, `scp `, `npm publish`, `chmod `, `kubectl `, `terraform ` (then ask) | Edits run; `.env` read/write and `.git/` writes ask | Ask | **Text tripwire**: a reworded command runs unasked. Kept only for policies saved with it |
| Balanced | 2 | Ask, except plainly written read-only commands: `git status`, `git diff`, `git log`, `git show`, `ls`, `pwd` | as v1 | Ask | Any `; & \| $ \` > <`, line break, `--output`, `--ext-diff`, `--textconv`, `difftool` or `-c ` makes such a command ask. Tests and linters ask: they run project code the agent may have just edited |
| Strict | 1 | Ask | Edits ask; reads run, `.env` included | Ask | Kept only for policies saved with it |
| Strict | 2 | Ask | Edits ask; reads run except `.env`, which asks | Ask | |
| Monitor | 1 | Run | Run | Run | Records only; not protection |

Every version of every preset also: denies anything mentioning `.ssh` (shell, file read, file write) and `rm -rf /`; keeps the two "Test my protection"
rules, which can only make a command stricter.

**Why v2.** The November 2026 security review (docs/security-review-2026-11.md, H-1) showed that Balanced v1, the recommended preset, let reworded
commands run with no person asked, including an SSH-key read whose plain form is "never allowed". Matching command text cannot be made complete,
so v2 inverts the default: the shell asks, and only a short list of commands that cannot do more than read may run unasked. Strict v1 also let an
agent read `.env` without asking while Balanced asked (M-1); v2 closes that.

**Changing a preset later.** Add a new version; never edit a published one (saved policies are recognised by their exact rules). Add it to
`PRESET_VERSIONS` and `LATEST`, and to the tests: `agent-presets.test.ts` checks every version is valid, recognised as itself, and that no reworded
command runs unasked under the latest Balanced or any Strict.
