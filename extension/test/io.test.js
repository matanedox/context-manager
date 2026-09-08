#!/usr/bin/env node
/** Event log, persisted state, and the pending-role handshake: node test/io.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { boardState } = require('../out/model/board-state');
const { parseLines } = require('../out/model/events');
// Runtime state lives outside the workspace; redirect the whole tree so tests own it.
process.env.CURSOR_AGENT_VIZ_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-home-'));
const {
	appendSessionStart,
	bindSessionRole,
	clearPendingRole,
	loadEvents,
	PENDING_ROLE_TTL_MS,
	readPendingRole,
	readPersistedState,
	readSessionSettings,
	setSessionContextLimit,
	setSessionContextLimitField,
	writePendingRole,
	writePersistedState,
} = require('../out/data/io');
const { readSnapshot } = require('../out/data/snapshot');
const { claimAutoContinue, finishAutoContinue, setSessionAutoContinue } = require('../out/data/auto-continue');
const { continuationNote, planSiblingNotes } = require('../out/data/sibling-sessions');
const { assignInstanceIndexes } = require('../out/model/session-label');
const {
	clearConversationActivity,
	openConversationIds,
	purgedIds,
	purgeConversation,
	removeRuntimeState,
} = require('../out/data/purge');
const { runtimeFile } = require('../out/data/runtime-dir');
const { payloadFor, repoContext, roleMap } = require('./fixtures');

// Closing from the board deletes that conversation's data rather than logging an end event, so
// nothing accumulates in the shared log.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-close-'));
appendSessionStart(tmp, 'keep', 'gamma');
appendSessionStart(tmp, 'manual', 'beta');
bindSessionRole(tmp, 'keep', 'gamma');
bindSessionRole(tmp, 'manual', 'beta');
clearConversationActivity(tmp, 'manual');
const afterClear = fs
	.readFileSync(runtimeFile(tmp, 'events.jsonl'), 'utf8')
	.split('\n')
	.filter((line) => line.includes('manual'));
assert.equal(afterClear.length, 1, "clearing activity removes only that session's events");
assert.match(
	afterClear[0],
	/"role":"beta"/,
	'and keeps the event that binds its persona, so a cleared chat is not rebuilt as the guide'
);
assert.ok(
	readPersistedState(tmp).sessions.some((session) => session.conversationId === 'manual'),
	'clearing activity keeps the session open'
);
purgeConversation(tmp, 'manual');
const kept = fs.readFileSync(runtimeFile(tmp, 'events.jsonl'), 'utf8');
assert.doesNotMatch(kept, /manual/, 'the closed conversation leaves no events behind');
assert.match(kept, /keep/, 'an open conversation keeps its own events');
assert.deepEqual(
	readPersistedState(tmp).sessions.map((session) => session.conversationId),
	['keep'],
	'and its state row, while the closed one is dropped'
);
assert.equal(
	payloadFor(
		boardState(parseLines(kept), roleMap, readPersistedState(tmp), false),
		false,
		roleMap,
		'keep',
		repoContext,
		Date.now()
	).sessions.length,
	1,
	'a purged session leaves the board and the survivor stays'
);

// The last session out removes the saved state, so a finished workspace stores nothing of it.
writePendingRole(tmp, 'gamma', 0);
purgeConversation(tmp, 'keep');
for (const name of ['current-state.json', 'pending-role.json']) {
	assert.equal(fs.existsSync(runtimeFile(tmp, name)), false, `${name} is deleted with the last session`);
}
// The log stays behind empty: with no log at all the board reads the workspace as a first run and
// shows the bundled demo, which put demo rows in the rail the moment the last chat was closed.
assert.equal(fs.readFileSync(runtimeFile(tmp, 'events.jsonl'), 'utf8'), '', 'the log is left empty');
assert.deepEqual(
	loadEvents(tmp, path.join(__dirname, '..')),
	{ text: '', usingDemo: false },
	'an empty log is an empty board, not the demo'
);

// Install / Repair is a reset: it archives the open chats and then leaves nothing on disk.
const reset = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-reset-'));
appendSessionStart(reset, 'live', 'gamma');
bindSessionRole(reset, 'live', 'gamma');
const rows = [
	{ conversationId: 'live', status: 'working' },
	{ conversationId: 'gone', status: 'closed' },
];
assert.deepEqual(openConversationIds(rows, false), ['live'], 'a reset archives only open chats');
assert.deepEqual(openConversationIds(rows, true), [], 'demo rows name no chat to archive');
removeRuntimeState(reset);
assert.equal(fs.existsSync(runtimeFile(reset, 'events.jsonl')), false, 'a reset clears every saved board file');

// a click Cursor never turned into a session expires instead of wedging the board
writePendingRole(tmp, 'gamma', 0);
assert.equal(readPendingRole(tmp), 'gamma', 'a fresh click is still waiting for its session');
assert.equal(
	readPendingRole(tmp, Date.now() + PENDING_ROLE_TTL_MS + 1000),
	null,
	'an unclaimed role expires so later clicks are not stuck on Starting'
);
assert.equal(readPendingRole(tmp), null, 'the expired role file is cleaned up');
fs.rmSync(tmp, { recursive: true, force: true });

// Clicking a role in a workspace with no hooks yet: there is no current-state.json to write to,
// so the role has to survive on the event log alone.
const board = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-start-'));
writePendingRole(board, 'beta', 0);
const stillStarting = payloadFor(
	boardState([], roleMap, { ...readPersistedState(board), pendingRole: readPendingRole(board) }, false),
	false,
	roleMap,
	undefined,
	repoContext,
	Date.now()
);
assert.equal(stillStarting.sessions[0].pending, true, 'the row waits while the chat is created');

appendSessionStart(board, 'chat-new', 'beta');
assert.equal(
	bindSessionRole(board, 'chat-new', 'beta'),
	true,
	'persona assignment is persisted before the chat becomes visible'
);
assert.equal(readPersistedState(board).sessions[0].role, 'beta');
clearPendingRole(board);
const bound = payloadFor(
	boardState(
		parseLines(fs.readFileSync(runtimeFile(board, 'events.jsonl'), 'utf8')),
		roleMap,
		{ ...readPersistedState(board), pendingRole: readPendingRole(board) },
		false
	),
	false,
	roleMap,
	undefined,
	repoContext,
	Date.now()
);
assert.equal(bound.sessions.length, 1, 'the starting row is replaced by the real session');
assert.equal(bound.sessions[0].pending, false, 'the bound session is no longer starting');
assert.equal(bound.sessions[0].roleLabel, 'Beta', 'the bound session keeps the clicked role');
assert.equal(bound.sessions[0].conversationId, 'chat-new');
assert.equal(
	readPersistedState(board).sessions[0].instanceIndex,
	1,
	'the first board-started chat of a persona is session 1'
);
bindSessionRole(board, 'chat-two', 'beta');
assert.equal(readPersistedState(board).sessions[1].instanceIndex, 2, 'a second click is session 2');

// Chats that predate the ordinal have none, and numbering only the newest made it call itself 1
// while the older one showed no number at all.
const legacy = [
	{ conversationId: 'old', role: 'beta', status: 'idle', subagents: [] },
	{ conversationId: 'fresh', role: 'beta', status: 'idle', subagents: [] },
];
assignInstanceIndexes(legacy, 'beta');
assert.deepEqual(
	legacy.map((session) => session.instanceIndex),
	[1, 2],
	'unnumbered chats of a persona are backfilled oldest first'
);
// What the user set is read back from the settings file, not from the state file the hook owns.
const setting = (id) => readSessionSettings(board)[id] ?? {};
assert.equal(setSessionContextLimit(board, 'chat-new', 80_000), true);
assert.equal(setting('chat-new').contextLimitTokens, 80_000);
// The field takes either unit; a bare number is millions, the scale a long chat's spend sits at.
assert.equal(setSessionContextLimitField(board, 'chat-new', '5'), true);
assert.equal(setting('chat-new').contextLimitTokens, 5_000_000);
assert.equal(setSessionContextLimitField(board, 'chat-new', '80k'), true);
assert.equal(setting('chat-new').contextLimitTokens, 80_000, 'a short chat can still be capped in thousands');
assert.equal(setSessionContextLimitField(board, 'chat-new', '2.5M'), true);
assert.equal(setting('chat-new').contextLimitTokens, 2_500_000);
assert.equal(setSessionContextLimitField(board, 'chat-new', 'nope'), false, 'junk is refused');
assert.equal(setting('chat-new').contextLimitTokens, 2_500_000, 'a refused budget leaves the stored one alone');
assert.equal(setSessionContextLimitField(board, 'chat-new', '  '), true);
assert.equal(setting('chat-new').contextLimitTokens, undefined, 'an empty field clears the budget');
assert.equal(setSessionContextLimit(board, 'chat-new', 80_000), true);
assert.equal(setSessionContextLimit(board, 'chat-new', undefined), true);
assert.equal(setting('chat-new').contextLimitTokens, undefined, 'clearing the field drops the cap');
assert.equal(setSessionContextLimit(board, 'chat-new', 80_000), true);
assert.equal(setSessionAutoContinue(board, 'chat-new', true), true);
assert.equal(setting('chat-new').autoContinueOnLimit, true);
assert.equal(setSessionAutoContinue(board, 'chat-new', false), true);
assert.equal(setting('chat-new').autoContinueOnLimit, undefined, 'unchecking drops the flag');
assert.equal(setSessionAutoContinue(board, 'chat-new', true), true);
assert.equal(setSessionContextLimit(board, 'chat-new', undefined), true);
assert.equal(setting('chat-new').autoContinueOnLimit, undefined, 'clearing the cap also clears auto-continue');
assert.equal(setSessionContextLimit(board, 'chat-new', 80_000), true);
assert.equal(setSessionAutoContinue(board, 'chat-new', true), true);

// The hook rebuilds current-state.json from the log on every event and writes the whole file back.
// While those settings lived in there, a tick that landed inside that read-modify-write was
// overwritten — Auto switched itself off when the user sent a message.
writePersistedState(board, {
	sessions: [{ conversationId: 'chat-new', role: 'beta', status: 'idle', subagents: [] }],
});
assert.equal(
	setting('chat-new').autoContinueOnLimit,
	true,
	'a full rewrite of the state file cannot clear what the user set'
);
assert.equal(
	readSnapshot(board, path.resolve(__dirname, '..')).state.sessions.find((row) => row.conversationId === 'chat-new')
		.autoContinueOnLimit,
	true,
	'and the board still reads it back onto the session it belongs to'
);

assert.equal(claimAutoContinue(board, 'chat-new'), true);
assert.equal(setting('chat-new').autoContinuedTo, 'pending');
assert.equal(claimAutoContinue(board, 'chat-new'), false, 'a claimed session cannot roll twice');
bindSessionRole(board, 'chat-next', 'beta');
assert.equal(finishAutoContinue(board, 'chat-new', 'chat-next'), true);
assert.equal(setting('chat-new').autoContinuedTo, 'chat-next');
assert.equal(setting('chat-next').contextLimitTokens, 80_000, 'the replacement keeps the cap');
// Carrying the checkbox too rolled one persona over five times in four minutes: every replacement
// inherited a cap smaller than a single turn, so it was over the moment it answered.
assert.equal(
	setting('chat-next').autoContinueOnLimit,
	undefined,
	'the replacement does not inherit Auto, so one tick cannot start an endless chain'
);

const siblingNotes = planSiblingNotes(
	[
		{ conversationId: 'chat-new', role: 'beta', status: 'idle', instanceIndex: 1, subagents: [] },
		{ conversationId: 'chat-two', role: 'beta', status: 'idle', instanceIndex: 2, subagents: [] },
	],
	'chat-two',
	'beta',
	'Beta'
);
assert.equal(siblingNotes.length, 1);
assert.equal(siblingNotes[0].conversationId, 'chat-new');
assert.match(siblingNotes[0].text, /Another Beta session opened \(Beta · 2\)/);
assert.deepEqual(
	planSiblingNotes(
		[{ conversationId: 'solo', role: 'beta', status: 'idle', instanceIndex: 1, subagents: [] }],
		'solo',
		'beta',
		'Beta'
	),
	[],
	'the first session of a persona does not notify itself'
);

// A hook mid-write puts the row back after a close purged it, which flickered the row off, on and
// off again: the board tombstones the id so the close reads as one.
purgeConversation(board, 'chat-two');
assert.equal(purgedIds(board).has('chat-two'), true, 'a just-closed chat stays hidden');
assert.equal(purgedIds(board).has('chat-new'), false, "an open chat is untouched by a neighbour's close");

// Closing the last chat deletes the state file, so the rows come from the log instead. A sessionEnd
// the hook appended after the purge replayed the chat back with no role, which the rail named after
// the fallback guide and showed for one repaint under the closing spinner.
const ghostRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-ghost-'));
appendSessionStart(ghostRoot, 'chat-ghost', 'beta');
bindSessionRole(ghostRoot, 'chat-ghost', 'beta');
purgeConversation(ghostRoot, 'chat-ghost');
fs.appendFileSync(
	runtimeFile(ghostRoot, 'events.jsonl'),
	`${JSON.stringify({
		ts: new Date().toISOString(),
		type: 'sessionEnd',
		raw: { hook_event_name: 'sessionEnd', conversation_id: 'chat-ghost' },
	})}\n`
);
assert.deepEqual(
	readSnapshot(ghostRoot, path.resolve(__dirname, '..')).state.sessions,
	[],
	'a late hook event cannot replay a just-closed chat back onto the rail'
);

// The hook process outlives the purge by however long its own turn takes, and a chat Cursor only
// untabbed keeps reporting turns for minutes: the row came back once no in-memory grace covered it
// any more, and came back on every window reload with the grace gone entirely. A reload is a fresh
// module registry, so requiring the layer again is the closest a test gets to one.
const laterRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-later-'));
appendSessionStart(laterRoot, 'chat-later', 'beta');
bindSessionRole(laterRoot, 'chat-later', 'beta');
purgeConversation(laterRoot, 'chat-later');
appendSessionStart(laterRoot, 'chat-later', 'beta');
writePersistedState(laterRoot, {
	sessions: [{ conversationId: 'chat-later', role: 'beta', status: 'idle', subagents: [] }],
});
for (const layer of ['../out/data/purge', '../out/data/snapshot']) {
	delete require.cache[require.resolve(layer)];
}
assert.deepEqual(
	require('../out/data/snapshot').readSnapshot(laterRoot, path.resolve(__dirname, '..')).state.sessions,
	[],
	'a chat still writing after its close stays closed across a window reload'
);

const brief = continuationNote({
	personaLabel: 'Beta',
	previousIndex: 2,
	reading: '5.0M / 5.0M',
	files: ['src/a.ts'],
	toolCalls: 1,
	kind: 'full',
});
assert.match(brief, /Beta session 2/);
assert.match(brief, /5\.0M \/ 5\.0M/);
assert.match(brief, /1 tool call\b/, 'the brief counts one call in the singular');
assert.match(brief, /src\/a\.ts/);
assert.match(brief, /confirm the goal/, 'the brief admits it never saw the conversation');
assert.match(
	continuationNote({
		personaLabel: 'Beta',
		previousIndex: 2,
		files: [],
		toolCalls: 1,
		kind: 'full',
		recap: 'Finish the meter, then stop.',
	}),
	/Its recap: Finish the meter/,
	'a landed recap rides the continuation note'
);
assert.match(
	continuationNote({
		personaLabel: 'Beta',
		previousIndex: 1,
		files: [],
		toolCalls: 3,
		kind: 'sibling',
	}),
	/second chat for Beta.*stays open/,
	'a chat opened beside a healthy session is not told that one filled up'
);

// The hook reducer recomputes current-state.json and used to reset every board chat to
// a leftover default; the clicked role on the event has to win.
const overwritten = boardState(
	parseLines(fs.readFileSync(runtimeFile(board, 'events.jsonl'), 'utf8')),
	roleMap,
	{ sessions: [{ conversationId: 'chat-new', role: 'alpha', status: 'idle', subagents: [] }] },
	false
);
assert.equal(
	overwritten.sessions[0].role,
	'beta',
	'a state file rewritten by the hooks cannot demote a clicked persona'
);
fs.rmSync(board, { recursive: true, force: true });

console.log('io checks passed');
