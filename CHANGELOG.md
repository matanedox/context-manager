# Changelog

## 0.2.2

The agent screen's context explanation is shorter: one plain line each for Tokens spent, Cached,
Calls, the context window, Limit, and Auto, and it closes with a dimmed lightbulb tip that long
chats cost more per reply.

## 0.2.1

The agent screen now labels cumulative prompt usage as **Tokens spent**, explains how replies,
tool calls, caching, the context window, Limit, and Auto differ, and opens that explanation from
either the reading or its help button. The reading is smaller and quieter, while its progress bar
follows the text.

Narrow boards now wrap controls instead of clipping them, with roomier action spacing and a
theme-safe context delete icon.

## 0.2.0

Windows support. The board was unusable there for two independent reasons, both fixed.

**Account usage never appeared after Connect.** The session token was read by shelling out to
`python3`, which a default Windows box does not have, so every load looked like a logged-out
session and reopened the login page. It is read with `node:sqlite` now, in-process, on every
platform; Python remains a fallback for older hosts and tries `py -3` and `python` first. A state
DB that nothing can read is reported instead of answered with the login page again.

**Every persona event ran a shell script.** `cmd.exe` cannot execute a `.sh` file, so no activity
was logged and no persona identity was injected: board chats answered as the bare model. The hooks
are Node entrypoints now, wired as `node .cursor/hooks/*.mjs`, which drops the dependency on bash,
`date`, `jq` and nvm. Both hook modules also compared `argv[1]` against `import.meta.url`'s
pathname, which never matches on Windows and left them silently dead even under Git Bash.

Packaging assumed Unix too: `vscode:prepublish` used `mkdir -p` and `cp`, so a build packaged on
Windows shipped no hooks at all.

**Upgrading:** the hook wiring changed, so an existing workspace needs one Install / Repair to
rewire `hooks.json`. The board prompts for it. The retired `.sh` commands are pruned in the same
pass.
