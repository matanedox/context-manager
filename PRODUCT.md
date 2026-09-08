# Product: Context Manager

## Problem

A repo's Context Manager — personas, rules, skills, workflows — is a consistent team model, but it is
invisible: markdown files and `@`-mentions. Users cannot see who owns what, who hands off to whom,
or what happened in a session.

## Solution

A **live scrum board** over the context a workspace already has, which:

1. Scans `.cursor/` and `AGENTS.md` for declared roles and the files scoped to them.
2. Displays roles as animated figures on a GUI.
3. Lets the user add, edit, retag and remove that context in place.
4. Shows declared handoffs and live activity when hooks fire, over an append-only event log.

## Users

- Teams running multi-persona agent sessions in Cursor.
- Tech leads who want visible ownership and handoffs during agent sessions.

## Core screens

### 1. Team roster

Personas discovered from `.cursor/personas/*.md` (per-file or one charter), else
`.cursor/agent-viz/personas.json`. **+ Add persona** writes into whichever source is already in use.

**Onboarding** is injected by the extension and leads every roster, alongside the project's own
personas rather than instead of them. It walks the user through the board and offers the Project
Manager that maps this project's context into personas — the mapping is that persona's job, not
Onboarding's. It owns no file: it never lands in `personas.json`. A project that declares a `guide`
of its own keeps its own wording in that first slot.

It is initial guidance, so it can be removed whenever the user is done with it — dismissed as a
board preference next to the runtime state, never by touching the repo. No persona is permanent,
that card included and even when it is the last one: an empty board is a state the user can ask for,
and **+ Add persona** is always on the roster. Since a removed Onboarding card leaves nothing to click,
**Context Manager: Restore onboarding** puts it back.

An unconfigured workspace is left untouched: the roster is Onboarding plus a setup panel, and the
first file appears only when the user adds a persona.

The walkthrough happens in the chat, not in a README: the first session started while the board has
no live activity receives a board request to introduce the board and to offer the persona that maps
the repo into a team, delivered over the same handoff pipeline as any other note. That chat opens
with a short hello prefilled in its composer and unsent, so the user starts the walkthrough rather
than the board taking a turn on its own. Once per workspace, hooks required.

Onboarding closes that walkthrough with one offer: a **Project Manager**, the first persona the
project owns. It does the mapping against the code rather than from the markdown alone — reading the
declared context and the repo's actual shape, reporting where the two disagree, and proposing a
roster only the user approves into files. Declining writes nothing and is not asked again. Display
names belong in the persona files the project writes, not in the extension.

### 2. Scrum board (extension webview)

- **Roster** — figure per declared role (Onboarding, plus any personas the project adds).
- **Handoff graph** — static edges from the persona charter.
- **Live pulse** — role/subagent highlights on hook events.
- **Activity log** — tail of the session event log (who did what, when).

## Event model (hooks)

Events append one JSON object per line:

```json
{"ts":"2026-08-20T13:00:00Z","type":"subagentStart","subagentType":"explore","role":"guide"}
{"ts":"2026-08-20T13:00:05Z","type":"postToolUse","tool":"Read","path":"src/App.tsx"}
```

Hook sources: `sessionStart`, `sessionEnd`, `subagentStart`, `subagentStop`, `preToolUse`, `postToolUse`, `afterAgentResponse`.

The log lives in `~/.cursor/agent-viz/<workspace>/events.jsonl`, outside the repo, and a closed
session's lines are removed with it. Keeping history would mean opting out of that cleanup.

Role mapping is **convention**: the subagent→role map lives only in
`.cursor/agent-viz/role-map.json`, which the project owns and the extension never seeds. An unmapped
subagent type keeps its own name as the role.

## Non-goals

- Replacing Cursor’s agent panel.
- Spawning real multi-agent bots (unless user explicitly runs `Task` subagents).
- Reading undisclosed Cursor internals.
