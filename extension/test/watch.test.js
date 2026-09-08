#!/usr/bin/env node
/** The board's repaint triggers: node test/watch.test.js */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// Runtime state lives outside the workspace; redirect the whole tree so tests own it.
process.env.CURSOR_AGENT_VIZ_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "agent-viz-home-"));
const { BoardWatcher } = require("../out/data/watch");
const { runtimeDir, runtimeFile } = require("../out/data/runtime-dir");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-viz-watch-"));
let refreshes = 0;
const watcher = new BoardWatcher();
// Nobody is looking, so the poll stays out of it: only the file watcher can move the counter.
watcher.start(
  root,
  () => {
    refreshes += 1;
  },
  () => ({ visible: false, agentLive: false, sincePaint: 0 }),
);

assert.ok(fs.existsSync(runtimeDir(root)), "the runtime dir is watched, so it is created to watch");

// A chat closed in Cursor is reported by a hook writing here, not by anything in the workspace:
// the board has to hear that write to start its closing loader instead of waiting for a poll tick.
fs.writeFileSync(runtimeFile(root, "events.jsonl"), '{"type":"sessionEnd"}\n');

setTimeout(() => {
  watcher.stop();
  assert.ok(refreshes > 0, "a hook write to the runtime dir repaints the board");
  console.log("watch checks passed");
}, 400);
