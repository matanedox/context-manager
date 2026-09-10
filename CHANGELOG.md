# Changelog

## 0.2.5

Clicking a persona warned that Cursor did not open a chat, and cleared the starting session.

A chat is created off-screen while its persona identity is bound, and revealed once that is done —
but only the hooks can name a chat nobody can see. The board decided they were up to it by looking
at `.cursor/hooks.json` and the scripts beside it, which says the hooks are wired, not that they
run: `node .cursor/hooks/…` is dead on a host with no `node` on the PATH Cursor was started with,
which is most Windows boxes. Every event was lost, the hidden chat was never identified, and the
start gave up on a chat that had in fact been created.

Hooks now have to have actually fired in the workspace before a chat is hidden behind them; until
the log has a line in it, the chat is created in view. The warning also names the cause when the
hooks are wired but have never run once, instead of blaming Cursor for a chat it did open.

## 0.2.4

The rest of Windows. 0.2.0 moved the hooks to Node, but three things still assumed a Unix box.

**Board chats answered as the bare model again.** Both hook modules decided whether they were the
process entrypoint by string-comparing a resolved `argv[1]` against `import.meta.url`'s path — a
comparison Windows loses on drive-letter case and on the relative path `hooks.json` passes. The
check compares file URLs now, case-insensitively on Windows, so a hook invoked as
`node .cursor/hooks/resolve-persona-context.mjs` actually runs.

**Installing hooks threw on the copy.** `chmod` has no meaning on Windows and its failure aborted
the install midway; the execute bit is best-effort now, since the wiring runs the scripts through
`node` either way.

**Account usage still fell back to a broken query.** On a host old enough to miss `node:sqlite`,
the Python reader built `file:C:\...?mode=ro`, which is not a URI, so the fallback could never read
the session it was there to read.

Pressing F5 also works: the preLaunchTask ran a bash script that sourced nvm, so the dev host never
compiled on Windows. Windows runs a Node script instead.

**Upgrading:** the hook scripts changed, so a workspace that installed the old copies needs one
Install / Repair to refresh them.

## 0.2.3

The context explanation's tip now leads with a filled info dot that sits on its first line, rather
than a hairline lightbulb floating between them.

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
