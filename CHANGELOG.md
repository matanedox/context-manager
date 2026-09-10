# Changelog

## 0.2.8

Touched files open, and "tool error" means what it says.

Every file in a chat's Touched files list is now a button: click one and it opens in the editor. The
list only ever kept the file's name, so it now carries the whole path too — the name is still what
the chip shows, with the full path on hover. Two files that share a name in different folders stay
two chips rather than collapsing into one, since one of them opening the other's file is worse than
a repeated label. A path that points outside the workspace, or at a file that has since been
deleted, opens nothing.

A chat's session status also read the wrong way round. One failed tool call painted the row "tool
error" and took over the working pulse for the rest of the turn, even when the agent retried and
carried on — while a turn that genuinely died on a failed tool was reported as idle a second later,
because the end of a turn cleared the state unconditionally. A successful tool call now hands the
row back to working, and a failure the agent never got past survives to the end of the turn. "Tool
error" now means one thing: the last tool this chat ran failed and it did not recover.

## 0.2.7

Install / Repair could leave the board unable to save anything, on Windows.

The reset behind it deleted the directory the board keeps its session state in — while the board's
own file watcher still had that directory open. Windows answers that by leaving the name behind in a
state nothing can open or recreate, so every write that followed failed: no event log, no persona
identity, and a Team screen showing the bundled demo. Clicking a persona then opened a chat Cursor
never told the board about, warned that no chat was opened, and cleared the session — every time,
until the window was reloaded.

A reset now empties that directory instead of removing it, which leaves the watcher's handle valid
and nothing wedged behind. It clears exactly what it cleared before, macOS and Linux included.

**Upgrading:** if a board is already stuck showing demo rows with persona clicks doing nothing,
reload the window once — that releases the old handle.

## 0.2.6

Hooks no longer depend on how Cursor was launched.

They are wired as `node .cursor/hooks/…`, and Cursor runs them through a shell holding the
environment Cursor itself started with. Launched from the Windows Start menu or the macOS Dock,
that environment routinely has no `node` on it — Explorer and Finder hand over a copy of the
environment made before Node was ever installed. Every hook then dies without a word: no event log,
no persona identity, and a board that says Cursor did not open a chat it did open.

Install now resolves the interpreter and writes it into the wiring. Plain `node` is kept whenever it
resolves, so a normal machine gets the same portable `hooks.json` as before; only a host that cannot
find it on PATH has an absolute path pinned in, quoted for `Program Files`. A workspace wired either
way reads as installed, so repair does not loop on it, and uninstall removes both forms.

Hook payloads also survive a BOM: Windows pipes them through PowerShell, which prefixes one, and
`JSON.parse` rejects it at position 0 — silently, inside the hook's own catch. The three hooks read
stdin through one helper that strips it.

**Upgrading:** run Install / Repair once so the wiring picks up an interpreter this machine can
actually run.

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
