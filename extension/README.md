# Context Manager

A visual scrum board over the Cursor context your repo already has — personas are hats one agent
wears, not separate bots.

Install, layers, what it writes on disk, commands and limits: see `PRODUCT.md` in the repository root.

`src/` is layered: `model/` (pure types and rules), `data/` (disk reads and writes), `present/`
(view model and screens), `host/` (VS Code API). `test/layers.test.js` enforces the direction.
