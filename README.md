# Context Manager

Visual scrum-team companion for Cursor. It reads the context a workspace already has — personas,
rules, skills, workflows — and shows roles, handoffs, and live session activity in a GUI.

The board scans `.cursor/` and `AGENTS.md`, and edits those same files when you add or remove a
persona or a rule. It writes nothing else into your project.

## What this is

| Layer | Purpose |
|-------|---------|
| **Extension** (`extension/`) | VS Code webview: roster, handoff graph, activity log |
| **Hooks** (`.cursor/hooks/`) | Append agent/subagent/tool events to a session log |

Personas are **hats on one agent**, not separate bots. The GUI shows **declared roles** plus **live
activity** only when hooks fire (subagent start/stop, tool use, session events).

## What it puts on disk

| What | Where | Lifetime |
|------|-------|----------|
| Session state — event log, board state, pending click, handoff notes | `~/.cursor/agent-viz/<workspace>/` | Deleted when the session closes; the last session out removes the files |
| Hook scripts and wiring | `.cursor/hooks/`, `.cursor/hooks.json` | Installed only when you accept the prompt; listed in `.gitignore` so they stay out of git |
| Your context — personas, rules, skills, workflows, `role-map.json` | `.cursor/` | Yours; the board never deletes it |

Session state lives outside the repo. Install also appends the hook copies to `.gitignore` (before
writing them) so they never show in `git status`. An empty workspace gains those copies and the
ignore lines — no personas, no role map, no invented team.

**Onboarding** is the one persona the extension brings itself. It leads the roster in every project —
first card, ahead of whatever personas the repo declares — and a project with none of its own has
only that card, plus a setup panel. It walks you through the extension, then offers a **Project
Manager** — the first persona your project owns, and the one that maps this repo into a team: it
reads the rules, skills, workflows and `AGENTS.md`, checks them against how the code is actually laid
out, says where the two have drifted apart, and proposes a roster you approve before anything is
written. That happens in the chat rather than in a README. The chat opens with a short hello waiting
in the composer — unsent, so the walkthrough starts when you press enter. Offered once per workspace,
and it needs the hooks installed since they are what delivers it.

It is initial guidance, so remove that card whenever you are done with it. Because it was never a
file in your repo, dismissing it is remembered outside it and takes nothing with it. No card is
permanent — Onboarding or your own, even the last one left — so **⌘⇧P** → **Context Manager: Restore
onboarding** is how you ask it back.

To remove everything: **⌘⇧P** → **Context Manager: Remove Agent Hooks And Board Data**. Uninstalling
the extension clears `~/.cursor/agent-viz/` on its own; your personas and rules are left alone.

## How to view the demo

1. Open this repo in Cursor.
2. Press **F5** → pick **Run Scrum Board Extension** (compiles automatically).
3. A **second Cursor window** opens (Extension Development Host). The **Scrum Board** tab should open automatically in the editor area.
4. Also look for a **robot icon** on the **left activity bar** → click it for the sidebar Scrum view.

If the board did not auto-open: in the **dev-host window**, **⌘⇧P** → **Context Manager: Open Board**.

## Repo layout

```text
├── README.md
├── PRODUCT.md                 # product design + screen spec
├── .cursor/
│   ├── hooks.json
│   └── hooks/                 # event log + persona context injection
└── extension/                 # host in src/; UI in extension/webview/
```

The extension's `src/` is layered: `model/` (pure types and rules), `data/` (disk reads and writes),
`present/` (view model and screens), `host/` (VS Code API). `test/layers.test.js` enforces it.

## Limits (honest)

- No official Cursor API for live agent thought streams or in-chat avatars.
- “Who is talking to who” = **handoff graph from personas** + **edges when subagents/tools run**.
- Extension reads the hook log file; it does not hook into Cursor internals.
- Cursor only runs hooks declared in the workspace, so live activity needs `.cursor/hooks/` there.

## Docs

- [PRODUCT.md](./PRODUCT.md) — product vision and screens
