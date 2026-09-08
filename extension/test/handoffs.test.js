#!/usr/bin/env node
/** Handoff pilot: open sessions, subagents, deliver script. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
// The hook scripts read the same runtime tree; child processes inherit this override.
process.env.CURSOR_AGENT_VIZ_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "agent-viz-home-"));
const { appendHandoff, collaboratorsFor, readHandoffs } = require("../out/data/handoffs");
const { runtimeDir, runtimeFile } = require("../out/data/runtime-dir");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoffs-"));
const deliverScript = path.join(__dirname, "../../.cursor/hooks/resolve-persona-context.mjs");

appendHandoff(root, {
  fromConversationId: "conv-a",
  fromRole: "alpha",
  to: { kind: "session", role: "beta", conversationId: "conv-b" },
  text: "API shape is frozen",
});
assert.equal(readHandoffs(root).length, 1);

const list = collaboratorsFor(
  {
    conversationId: "conv-a",
    role: "alpha",
    subagents: [{ type: "bugbot", role: "gamma", status: "working" }],
  },
  [
    { conversationId: "conv-a", role: "alpha", status: "working" },
    { conversationId: "conv-b", role: "beta", status: "idle" },
    { conversationId: "conv-c", role: "delta", status: "working" },
  ],
  readHandoffs(root),
  { alpha: "Alpha", beta: "Beta", gamma: "Gamma", delta: "Delta" }
);
assert.ok(list.some((item) => item.kind === "subagent" && item.subagentType === "bugbot"));
assert.ok(list.some((item) => item.kind === "session" && item.conversationId === "conv-b"));
assert.ok(list.some((item) => item.kind === "session" && item.conversationId === "conv-c"));
assert.ok(!list.some((item) => item.role === "alpha"), "never hand off to self");
assert.equal(list.filter((item) => item.kind === "session").length, 2, "every other open session");
assert.equal(
  list.find((item) => item.conversationId === "conv-b").lastNote,
  "API shape is frozen",
  "the sender keeps what it handed off"
);

// The chat that was handed to sees the same note from its side, marked as incoming.
const received = collaboratorsFor(
  { conversationId: "conv-b", role: "beta", subagents: [] },
  [
    { conversationId: "conv-a", role: "alpha", status: "working" },
    { conversationId: "conv-b", role: "beta", status: "idle" },
  ],
  readHandoffs(root),
  { alpha: "Alpha", beta: "Beta" }
).find((item) => item.conversationId === "conv-a");
assert.equal(received.lastNote, "API shape is frozen", "the delegated chat remembers the handoff");
assert.equal(received.lastNoteIncoming, true, "and shows it as theirs, not its own");

fs.mkdirSync(runtimeDir(root), { recursive: true });
fs.writeFileSync(
  runtimeFile(root, "events.jsonl"),
  [
    { hook_event_name: "sessionStart", conversation_id: "conv-a" },
    { hook_event_name: "sessionStart", conversation_id: "conv-b" },
    { hook_event_name: "subagentStart", conversation_id: "conv-a", subagent_type: "bugbot" },
  ]
    .map((raw) => JSON.stringify({ ts: "2026-08-26T10:00:00Z", type: raw.hook_event_name, raw }))
    .join("\n") + "\n"
);
// The log hook reduces the event log into state; the deliver hook only reads it. Without this the
// fixture has events but no state, which is not a shape the real hook chain ever produces.
execFileSync("node", [path.join(__dirname, "../../.cursor/hooks/update-agent-state.mjs")], {
  cwd: root,
  input: "",
});
appendHandoff(root, {
  fromConversationId: "conv-a",
  fromRole: "alpha",
  to: { kind: "session", role: "beta", conversationId: "conv-b" },
  text: "Build the form only",
});
appendHandoff(root, {
  fromConversationId: "conv-a",
  fromRole: "alpha",
  to: {
    kind: "subagent",
    role: "gamma",
    conversationId: "conv-a",
    subagentType: "bugbot",
  },
  text: "Check regression on login",
});

const sessionOut = execFileSync("node", [deliverScript], {
  cwd: root,
  input: JSON.stringify({
    conversation_id: "conv-b",
    hook_event_name: "beforeSubmitPrompt",
    prompt: "continue with the handoff",
  }),
  encoding: "utf8",
});
assert.match(sessionOut, /Build the form only/);

const subagentOut = execFileSync("node", [deliverScript], {
  cwd: root,
  input: JSON.stringify({
    conversation_id: "conv-a",
    hook_event_name: "beforeSubmitPrompt",
    prompt: "check login",
  }),
  encoding: "utf8",
});
assert.match(subagentOut, /gamma subagent/);
assert.match(subagentOut, /Check regression on login/);
assert.equal(readHandoffs(root).every((row) => row.read), true, "deliver marks notes read");

// A delivered note is marked read, so the target never hears the same handoff twice.
const repeatOut = execFileSync("node", [deliverScript], {
  cwd: root,
  input: JSON.stringify({
    conversation_id: "conv-b",
    hook_event_name: "beforeSubmitPrompt",
    prompt: "hi",
  }),
  encoding: "utf8",
});
assert.doesNotMatch(repeatOut, /Build the form only/, "a note is delivered once");

// Talk → Send: a session note switches to that chat, a subagent note waits for its hook.
const { planHandoff } = require("../out/host/commands/handoff");
const plans = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-plan-"));
const state = {
  sessions: [
    { conversationId: "conv-a", role: null, status: "working", subagents: [] },
    { conversationId: "conv-b", role: "beta", status: "idle", subagents: [] },
  ],
};
const toSession = planHandoff(plans, state, "conv-a", {
  kind: "session",
  role: "beta",
  conversationId: "conv-b",
  text: "ship the form",
});
assert.equal(
  toSession.openConversationId,
  "conv-b",
  "Send switches to the session that is already open, it never starts a second one"
);
assert.equal(readHandoffs(plans)[0].read, false, "the note waits for the target's next message");
assert.equal(toSession.nudge, true, "an idle target needs a turn before its stop hook can speak");
const toSubagent = planHandoff(plans, state, "conv-b", {
  kind: "subagent",
  role: "gamma",
  conversationId: "conv-b",
  subagentType: "bugbot",
  text: "regress login",
});
assert.equal(toSubagent.openConversationId, undefined, "a subagent has no chat to switch to");
assert.equal(readHandoffs(plans)[1].read, false, "so its note waits for the hook");
assert.equal(
  planHandoff(plans, state, "conv-a", { kind: "role", role: "gamma", text: "hi" }).warning,
  "Open a session for that persona first."
);
assert.equal(readHandoffs(plans).length, 2, "a rejected target records nothing");

// The note carries what the sender already opened, so the receiver skips rediscovering it.
const read = (file) => ({
  ts: "2026-08-26T10:00:00Z",
  type: "postToolUse",
  raw: { hook_event_name: "postToolUse", tool_name: "Read", tool_input: { path: file } },
});
planHandoff(
  plans,
  { ...state, eventsByConversation: new Map([["conv-a", [read("src/form.tsx")]]]) },
  "conv-a",
  { kind: "session", role: "beta", conversationId: "conv-b", text: "ship the form" }
);
assert.deepEqual(
  readHandoffs(plans).at(-1).files,
  ["form.tsx"],
  "the sender's touched files ride along with the note"
);
assert.match(
  execFileSync("node", [deliverScript], {
    cwd: plans,
    input: JSON.stringify({
      conversation_id: "conv-b",
      hook_event_name: "beforeSubmitPrompt",
      prompt: "continue",
    }),
    encoding: "utf8",
  }),
  /form\.tsx/,
  "and reach the receiving chat, so it does not grep for them"
);
assert.equal(
  planHandoff(plans, state, "conv-b", {
    kind: "session",
    role: null,
    conversationId: "conv-a",
    text: "heads up",
  }).nudge,
  false,
  "a working target stops on its own, so nudging it would only interrupt"
);

// The nudge submits no text, and the note rides that turn as hidden context. Leaving it for stop
// spent an extra turn on the target announcing it was about to look for the handoff.
planHandoff(plans, state, "conv-a", {
  kind: "session",
  role: "beta",
  conversationId: "conv-b",
  text: "nudged handoff",
});
assert.match(
  execFileSync("node", [deliverScript], {
    cwd: plans,
    input: JSON.stringify({
      conversation_id: "conv-b",
      hook_event_name: "beforeSubmitPrompt",
      prompt: "",
    }),
    encoding: "utf8",
  }),
  /nudged handoff/,
  "the nudge turn receives the handoff, not the turn after it"
);
assert.equal(
  JSON.parse(
    execFileSync("node", [deliverScript], {
      cwd: plans,
      input: JSON.stringify({ hook_event_name: "stop", conversation_id: "conv-b" }),
      encoding: "utf8",
    })
  ).followup_message,
  undefined,
  "so stop has nothing left to say out loud"
);


const toolOut = execFileSync("node", [deliverScript], {
  cwd: root,
  input: JSON.stringify({ conversation_id: "conv-b", hook_event_name: "afterFileEdit" }),
  encoding: "utf8",
});
assert.doesNotMatch(toolOut, /handed off/, "tool hooks never swallow notes");

// First run in a workspace: the board asks the new chat to introduce the extension, and the chat
// hears it on its own turn rather than the user having to read a README.
const { takeIntroNote, walkthroughDue } = require("../out/data/intro");
const introRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-viz-intro-"));

// Opening the board starts that chat by itself, but only where the hooks can deliver the note.
assert.equal(
  walkthroughDue(introRoot),
  false,
  "without hooks the walkthrough would sit unread, so no chat is opened"
);
require("../out/data/hooks-install").installHooks(introRoot, path.resolve(__dirname, ".."));
assert.equal(walkthroughDue(introRoot), true, "a first open of the board starts Onboarding");
assert.equal(walkthroughDue(introRoot), false, "and a second webview does not open another");
assert.ok(
  fs.existsSync(path.join(runtimeDir(introRoot), "intro-shown")),
  "the claim is on disk before the chat exists, so a later window is not a first entry"
);

const intro = takeIntroNote();
assert.match(intro, /I'm Onboarding/, "the walkthrough opens by naming Onboarding");
assert.doesNotMatch(
  intro,
  /wearing the \w+ persona/,
  "and never asks Onboarding to read out an internal persona id"
);

// The walkthrough ends on an offer, not an inventory: the first persona a project owns is the one
// that reconciles its declared context with the code, and it is written only once the user agrees.
assert.match(intro, /Project Manager/, "the walkthrough offers the project manager");
assert.match(intro, /do not (write|edit) anything|do not edit any files/i, "and writes nothing on the intro turn");
assert.match(intro, /If they decline/, "a no ends it rather than leaving Onboarding to improvise");
for (const key of [
  /^id: project-manager$/m,
  /^title: Project Manager$/m,
  /^description: .+$/m,
]) {
  // personaFromFile and the identity hook both read these keys; a loose header lands a bare slug.
  assert.match(intro, key, `the persona charter is dictated with ${key.source}`);
}
assert.doesNotMatch(intro, /^name:/m, "the dictated charter has no default first name");
assert.match(
  intro,
  /file and terminal tools/,
  "and the fit check reads the repo instead of recalling it"
);
// Mapping is the occasional job; the standing one is running the roster, so the dictated charter
// has to carry delegation too or every new workspace gets a persona that only ever audits.
assert.match(
  intro,
  /in flight|reassign/i,
  "the dictated charter gives the project manager the running of the roster, not only the mapping"
);
// A Read on a directory always fails, and postToolUseFailure paints the session as failed.
assert.doesNotMatch(
  intro,
  /read \.cursor\/personas\//i,
  "the roster is listed before writing, never probed with a read that cannot succeed"
);

assert.equal(
  takeIntroNote(),
  null,
  "and is offered once per workspace, so later sessions start clean"
);

// A project that already declares personas gets no offer to build the team it has: the walkthrough
// reads the roster first, so Onboarding offers the manager only where none owns the job.
const { introNote } = require("../out/data/intro");
const personaDir = path.join(introRoot, ".cursor", "personas");
fs.mkdirSync(personaDir, { recursive: true });
fs.writeFileSync(
  path.join(personaDir, "frontend.md"),
  "---\nid: frontend\ntitle: Frontend Engineer\nname: Ken\n---\nBuilds the UI.\n"
);
const rosterIntro = introNote(introRoot);
assert.match(rosterIntro, /already declares/, "the roster it can see is named back to the user");
assert.match(rosterIntro, /Frontend Engineer/);
assert.match(rosterIntro, /Ask whether to add it/, "and the manager is still the one offer");
fs.writeFileSync(
  path.join(personaDir, "project-manager.md"),
  "---\nid: project-manager\ntitle: Project Manager\nname: Wendy\n---\nRuns the roster.\n"
);
const managedIntro = introNote(introRoot);
assert.match(managedIntro, /goes by Wendy/, "an existing manager is named rather than duplicated");
assert.doesNotMatch(managedIntro, /Ask whether to add/, "so nothing is offered to create");
assert.doesNotMatch(
  managedIntro,
  /^id: project-manager$/m,
  "and no persona file is dictated for a persona the project already wrote"
);
fs.rmSync(path.join(introRoot, ".cursor", "personas"), { recursive: true, force: true });
appendHandoff(introRoot, {
  fromConversationId: "intro-chat",
  fromRole: "guide",
  to: { kind: "session", role: "guide", conversationId: "intro-chat" },
  text: intro,
});
const spokenIntro = execFileSync("node", [deliverScript], {
  cwd: introRoot,
  input: JSON.stringify({ hook_event_name: "stop", conversation_id: "intro-chat" }),
  encoding: "utf8",
});
assert.match(spokenIntro, /Board request/, "the chat hears it as a board request, not a peer handoff");
assert.match(spokenIntro, /Context Manager/, "and receives the walkthrough itself");

// The walkthrough rides the first submit as hidden context or not at all: a hello sent before the
// note was written must not make the end of that turn introduce Onboarding a second time.
appendHandoff(introRoot, {
  fromConversationId: "quick-chat",
  fromRole: "guide",
  to: { kind: "session", role: "guide", conversationId: "quick-chat" },
  text: "Introduce yourself as Onboarding.",
  submitOnly: true,
});
const quietStop = execFileSync("node", [deliverScript], {
  cwd: introRoot,
  input: JSON.stringify({ hook_event_name: "stop", conversation_id: "quick-chat" }),
  encoding: "utf8",
});
assert.equal(quietStop.trim(), "{}", "a missed walkthrough note is never spoken aloud");
assert.equal(
  readHandoffs(introRoot).find((row) => row.to.conversationId === "quick-chat")?.read,
  true,
  "and it is spent, so no later turn picks it up"
);
fs.rmSync(introRoot, { recursive: true, force: true });

console.log("handoffs.test.js passed");
