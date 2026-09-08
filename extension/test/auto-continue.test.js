#!/usr/bin/env node
/** Auto-continue trigger and recap file: node test/auto-continue.test.js */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  recapPath,
  readRecap,
  recapRequestText,
  shouldAutoContinue,
  waitForRecap,
} = require("../out/data/auto-continue");

const idle = {
  autoContinueOnLimit: true,
  contextLimitTokens: 80_000,
  status: "idle",
};

assert.equal(shouldAutoContinue(idle, true), true, "over limit and idle rolls over");
assert.equal(shouldAutoContinue({ ...idle, status: "working" }, true), false, "wait for the turn to end");
assert.equal(shouldAutoContinue({ ...idle, autoContinuedTo: "pending" }, true), false, "already claimed");
assert.equal(shouldAutoContinue({ ...idle, autoContinueOnLimit: false }, true), false, "checkbox off");
assert.equal(shouldAutoContinue({ ...idle, contextLimitTokens: undefined }, true), false, "no cap");
assert.equal(shouldAutoContinue(idle, false), false, "under the cap");
assert.equal(shouldAutoContinue({ ...idle, status: "closed" }, true), false, "a closed chat is done");
assert.equal(shouldAutoContinue({ ...idle, status: "failed" }, true), true, "a failed full chat still rolls");
assert.equal(
  shouldAutoContinue(idle, true, false),
  false,
  "a chat that ran no tool and touched no file has nothing to hand over"
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-viz-recap-"));
process.env.CURSOR_AGENT_VIZ_HOME = tmp;
const file = recapPath(tmp, "chat-full");
assert.match(recapRequestText(file), /chat-full/);
assert.equal(readRecap(file), undefined);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, "  goal: ship the meter  \n");
assert.equal(readRecap(file), "goal: ship the meter");

waitForRecap(file, 0)
  .then((text) => {
    assert.equal(text, "goal: ship the meter");
    return waitForRecap(`${file}.missing`, 0);
  })
  .then((missing) => {
    assert.equal(missing, undefined);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("auto-continue checks passed");
  })
  .catch((err) => {
    fs.rmSync(tmp, { recursive: true, force: true });
    console.error(err);
    process.exit(1);
  });
