# Making a code theme

A code theme is a web page that draws the office. It is HTML, CSS and JavaScript: a canvas, WebGL, three.js, anything a page can do. It runs in a locked box on Home, reads the office through one data line, and asks the app for five checked actions. That is all it can do.

Start from the nearest template in `templates/` beside this file (SKILL.md says which is which): a flat 2D canvas office, a three.js office, or HTML cards. Each is a whole theme that passes the app's check and imports as a zip: `index.html`, `theme.json`, and for the cards a stylesheet.

## The folder

- `index.html` at the top of the folder is the page. It is required.
- `theme.json` at the top says what the theme is (The package, below). Keep it there from the start.
- Any other files beside them: scripts, styles, pictures, models, fonts, sounds.
- Load them by relative path (`./scene.js`, `img/desk.png`). The box serves the folder as `mdtheme://theme/`.
- At most 20 MB and 500 files.
- File types: html, css, js, mjs, json, txt, md, png, jpg, webp, gif, svg, glb, gltf, bin, wasm, woff, woff2, ttf, otf, mp3, ogg, wav. A zip is not one of them: never put a zip in the folder.
- No hidden files (a name starting with a dot), no links.
- A path has at most 4 parts (three folders and the file) and 200 characters, with no `..`, no `\`, `:`, `*`, `?`, `"`, `<`, `>` or `|`, and no part ending in a space or a dot. No part may be a Windows device name (CON, PRN, AUX, NUL, COM1 to COM9, LPT1 to LPT9), with any extension.

## The package: theme.json, Save and the zip

### theme.json

A code theme says what it is in `theme.json`, at the top beside `index.html`. Write `kind` and `name`, and `author` if the person gave one:

```json
{ "kind": "code", "name": "Pirate newsroom" }
```

| Key | Who writes it | What it is |
|---|---|---|
| `kind` | you, required | Always `"code"`. A zip whose `theme.json` lacks it, or that has no `theme.json`, is read as a map theme and refused for having no `manifest.json` |
| `name` | you, required | The name in the Theme panel. 1 to 60 characters once control characters and runs of spaces are taken out |
| `author` | you, optional | Who made it, as they want to be shown. At most 60 characters, as for the name |
| `version` | the app | 1 for a new theme, one more each time it is saved again. Any version you write is not kept |
| `app` | the app | The app version that saved or shared it |
| `lineVersion` | the app | The data line version the theme was made for |
| `savedAt` | the app, on Save | When it was saved. Not in a shared zip |
| `example` | the app | `true` on the app's own example themes only |

Any other key is ignored. When a theme comes in, only `name` and `author` are kept; the app writes the rest.

### What Save writes

Save is the person's, in the workbench. It checks the working copy again, copies every file but `theme.json` into the app's own folder for saved themes, and writes a new `theme.json` there with `name`, `author` (when there is one), `version`, `kind`, `app`, `lineVersion` and `savedAt`. The name is the one the person types at Save, or the saved theme's own when they go on with one. The working copy stays as it was.

### The zip the app imports and shares

Share as zip (in the workbench after Save, or on the theme's card) writes the saved theme's files and a `theme.json` with `kind`, `name`, `author` (when there is one), `version`, `app` and `lineVersion`. Import takes a zip like that, from the Theme panel's Import zip:

- `index.html` and `theme.json` at the top of the zip, or both inside one folder around everything (what zipping a folder makes): that folder is taken off.
- A plain zip: each file stored or deflated, no password, not zip64, not split in parts, no links. `.DS_Store`, `Thumbs.db`, `desktop.ini` and `__MACOSX/` are dropped. Any other hidden file is refused.
- At most 20 MB zipped. Unpacked, the folder rules above: 500 files and 20 MB. A zip that unpacks to more than 1 MB and over 100 times its own size is refused as a zip bomb.
- No file of the app's art, the same bytes or the same pictures in other colours or cut up.
- An import is always a new theme. It never replaces one already there.

To make one yourself, from inside the working copy, into the folder beside it (never into the working copy):

```sh
zip -r -X ../my-theme.zip . -x '.*' -x '*/.*'
```

### Why an import is refused

| Reason | What it means |
|---|---|
| `not-zip` | Not a zip file |
| `broken` | A damaged zip or file, or a file the app could not write |
| `big` | Over 20 MB zipped or unpacked, or one file over 20 MB |
| `many` | More than 500 files |
| `bomb` | Unpacks to far more than its size |
| `path` | A path outside the rules above |
| `hidden` | A hidden file or folder |
| `link` | A link |
| `type` | A file type the box does not serve, or a compression it does not read |
| `no-index` | No `index.html` at the top |
| `no-manifest` | No `theme.json`, `theme.json` is not JSON, or it has no `name` |
| `not-code` | `theme.json` does not say `"kind": "code"` |
| `licensed` | A file is the app's art |
| `missing` | Share as zip: the saved theme is gone |
| `built-in` | Share as zip: a theme the app ships is not shared |

## The box

The page has no internet and no files of this computer.
- Every request that is not `mdtheme:` fails: fetch, XHR, WebSocket, images, fonts or scripts from a website, iframes, WebRTC.
- Nothing lasts between runs: no cookies, localStorage is empty at every start.
- No pop ups, no navigation away, no downloads, no clipboard, no camera, microphone, location, notifications or fullscreen.
- So everything the theme needs must be in its folder, or in the libraries below.

## Reading the office: `window.md.onData`

```js
window.md.onData((state) => {
  if (state.v !== 1) return;   // a version this theme does not know
  draw(state);
});
```

The function gets the whole state first, then the whole state again after each change, at most 4 times a second. Draw from the newest state you were given. The fields (version 1):

**`state.agents`**, one per agent:
| field | what |
|---|---|
| `token` | its name on the line for this run. Hand it back in an action. Means nothing anywhere else. |
| `name` | the agent's name in the app |
| `role` | `lead` or `member` |
| `status` | one of `idle`, `thinking`, `working`, `waiting`, `blocked`, `success`, `ghost`, `compacting`, `looping`, `typing` |
| `statusSince` | when the status changed, ms since 1970, or null |
| `tool` | the kind of tool it last used (`Read`, `Edit`, `Bash`...), never what it used it on. Changes at most once a minute. Or null. |
| `station` | where it sits, as the app numbers seats, or null |
| `contextPercent` | context used, 0 to 100, or null |
| `engine` | `claude`, `codex`..., or null |
| `onHold` | true when its mail is held |
| `unread` | how many messages wait for it (never their words) |
| `taskTitle`, `ticket` | the card it holds: title cut to 40 characters, and the card's token. Or null. |
| `rate`, `spark` | work tokens in the last 60 s; per clock minute, oldest first, up to 14 cells, the last one the minute under way |
| `today`, `fiveHour`, `week` | `{ used, cap }`: work tokens in that period, and the limit the person set or null |

**`state.tasks`**: `{ token, title, status, agent }`. Title cut to 80 characters; status `doing` or `blocked`; agent is an agent token or null.

**`state.asks`**, what is open for the person: `{ token, kind, agent, text, options, askedAt, count, canAnswer }`. `kind` is one of:
- `question`: a question on a card. `text` is the question, `options` its quick answers in order. The only kind with `canAnswer` true.
- `held`: an agent's mail held in its Cloud Office. `text` is a fixed reason code such as `text-in-box`; `count` is how many messages wait.
- `box`: messages the person queued for a busy agent. `text` is empty; `count` is how many.
- `key`: a connection that is on and has no key. `text` is the connection's name (GitHub, Linear...) or empty.

Only offer Answer and Decline when `canAnswer` is true; the app refuses them on any other kind. A `held`, `box` or `key` card can only open its agent (`openAgent` with its `agent`).

**`state.telemetry`**, the whole office: `rate`, `spark`, `today`, `fiveHour`, `week` as for an agent, and `engineLimits`: `{ name, usedPercent, resetsInMs }` per engine window.

**`state.look`**: `scheme` (`light` or `dark`), `reducedMotion`, `lang` (the app's language: `en`, `ar` or `zh-CN` today) and `dir` (`ltr` or `rtl`). Follow them: draw in the person's scheme, keep still when they asked for less motion, word the theme in their language when you have it, and lay out right to left when `dir` is `rtl`.

**`state.at`**: when the state was made.

The line never carries message text, prompts, notes, paths, commands, memory, file contents, keys or people's names. Do not try to show them.

## Doing something: `window.md.ask`

Five actions. Anything else is refused.

```js
window.md.ask({ kind: 'openAgent', agent: a.token });           // opens that agent's screen
window.md.ask({ kind: 'openTask', task: t.token });             // opens that card
window.md.ask({ kind: 'answerAsk', ask: q.token, option: 0 });  // answers with its first option
window.md.ask({ kind: 'answerAsk', ask: q.token, text: 'Yes, ship it' });
window.md.ask({ kind: 'declineAsk', ask: q.token, reason: 'Not this week' });
window.md.ask({ kind: 'openThemes' });                          // opens Home's theme dropdown
```

- An answer in your own words, and every decline, opens the app's own sheet with the exact words. Only the person's Send sends them.
- `answerAsk`, `declineAsk` and `openThemes` work only within 2 seconds of a click in the theme. Call them from a click handler.
- Home's Theme button is in the top bar, right of the limits, outside your theme (Pro and Max only). A theme may still offer its own and send `openThemes`.
- At most 2 actions a second and 20 a minute.
- Answer text up to 2,000 characters; a reason from 1 to 500.
- A token from an earlier run, or one made up, is refused.

## Limits

- Draw with `requestAnimationFrame`, and aim for 30 frames a second or less.
- Over 60% of one processor core for 10 seconds pauses the theme. Three pauses in 10 minutes stop it.
- A page that hangs for 6 seconds, crashes or will not load is stopped, and The Office comes back.
- Over 1 GB of memory stops it.
- When Home is hidden the page is hidden too (`visibilitychange`): stop drawing then.

## Libraries

Load these by their exact names. Nothing else is served from `mdtheme://lib/`.

| name | what |
|---|---|
| `mdtheme://lib/three.module.js` | three.js 0.170.0, MIT. `import * as THREE from 'mdtheme://lib/three.module.js';` in a `<script type="module">`. |
| `mdtheme://lib/three.LICENSE.txt` | its licence |

## The app's art

Never copy the app's art into a theme: not The Office's tiles, sprites or pictures, not Star Hike's. They are licensed to the app only, and a theme can be exported and sent to a friend. An export holding one is refused. Draw your own, or make it in code.

## The preview

The workbench shows the page in the same box, big. It reloads by itself 300 ms after you stop writing files. The person switches it between sample data (made up agents named "Sample ...", never real) and this office's real line. Actions on the sample do nothing.
