# Context Manager

**A visual scrum board over the Cursor context your repo already has — personas are hats one agent
wears, not separate bots.**

## Features

**View 1 — Team**

- **Usage meter** — Cursor included / on-demand remaining, from the same account the IDE already uses.
- **Team roster** — personas from `.cursor/personas` as figures. Click one to start a chat as that
  role; **+ Add persona** writes into the project's own files.
- **Sessions** — who is running, how long ago, usage on the session. Focus or close from the list.

**View 2 — Agent**

- **Current agent** — status, model, mode, tool-call count; edit the persona; limit and auto toggles.
- **Context in place** — rules, skills, workflows and favorites, tagged by persona. Open a file in
  the editor or add more from **+ Add context**. Touched files and global rules sit above that list.
- **Handoff** — available teammates to work with, plus a note you send one (not a drawn graph).
- **Activity log** — tail of the hook event log for the session. Live pulse only while hooks fire.

| Team | Agent |
|------|-------|
| ![Team board: usage, roster, sessions](docs/board.png) | ![Agent detail: current agent, tagged rules, activity](docs/agent.png) |

Install, layers, what it writes on disk, commands, screens and limits: **[PRODUCT.md](./PRODUCT.md)**.

Cutting a version: **[docs/RELEASING.md](./docs/RELEASING.md)**.
