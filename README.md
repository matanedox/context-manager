# Context Manager

**A visual scrum board over the Cursor context your repo already has — personas are hats one agent
wears, not separate bots.**

![The team board: usage meter, persona figures, live sessions](docs/board.png)

## Features

- **Team roster** — personas from `.cursor/personas` as figures. Click one to start a chat as that
  role; **+ Add persona** writes into the project's own files.
- **Sessions** — who is running, how long ago, usage on the session. Focus or close from the list.
- **Usage meter** — Cursor included / on-demand remaining, refreshed from the same account the IDE
  already uses.
- **Agent detail** — status, model, mode, tool-call count; edit the persona; limit and auto toggles.
- **Context in place** — rules, skills, workflows and favorites, tagged by persona. Open a file in
  the editor or add more from **+ Add context**. Touched files and global rules sit above that list.
- **Handoff** — available teammates to work with, plus a note you send one (not a drawn graph).
- **Activity log** — tail of the hook event log for the session. Live pulse only while hooks fire.

![The agent detail screen: current agent, tagged rules, activity log](docs/agent.png)

Install, layers, what it writes on disk, commands, screens and limits: **[PRODUCT.md](./PRODUCT.md)**.
