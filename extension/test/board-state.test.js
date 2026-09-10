#!/usr/bin/env node
/** Exercises the pure model and its display copy: npm run compile && node test/board-state.test.js */
const assert = require('node:assert/strict');
const { boardState } = require('../out/model/board-state');
const { groupByConversation, orderSessions } = require('../out/model/events');
const {
	activityDescription,
	contextMeter,
	contextSummary,
	formatTokens,
	relativeTime,
} = require('../out/present/copy');
const { parseTokenBudget, tokenBudgetField } = require('../out/model/token-budget');
const { event, grouped, roleMap, sampleState } = require('./fixtures');

// grouping keeps conversations apart
assert.deepEqual([...grouped.keys()], ['conv-a', 'conv-b'], 'events without a conversation are dropped');
assert.equal(grouped.get('conv-a').length, 3);
assert.equal(grouped.get('conv-b').length, 4);

// Trimming here truncated the spend sum: a chat with more than 120 events lost its early turns and
// its total fell as it got busier. Only the painted log is capped now, and it caps its own copy.
// The early turn is the point: a tail trim keeps the 200 tool calls and throws this one away.
const busy = groupByConversation([
	event('afterAgentResponse', 'big', 1, { input_tokens: 300_000 }),
	...Array.from({ length: 200 }, (_, i) => event('postToolUse', 'big', 0, { tool_name: `T${i}` })),
]);
assert.equal(busy.get('big').length, 201, 'a chat keeps every event it logged');
assert.equal(
	contextSummary(busy.get('big')).inputTokens,
	300_000,
	'so a turn logged before the 120 most recent events still counts toward the reading'
);

// context summary
const summaryB = contextSummary(grouped.get('conv-b'));
assert.equal(summaryB.model, 'auto-smart');
assert.equal(summaryB.inputTokens, 1000);
assert.equal(summaryB.cachedShare, 0.75, 'cached share comes from cache_read/input');
assert.equal(summaryB.toolCalls, 1);
assert.deepEqual(summaryB.files, ['two.ts'], 'file names are extracted from tool_input');
// The chips label with `files` and open with `filePaths`, so a drift between them opens the wrong tab.
assert.deepEqual(summaryB.filePaths, ['b/two.ts'], 'the whole path is kept for opening the file');
assert.equal(summaryB.endReason, 'completed', 'final_status wins over reason when set');

const summaryEmpty = contextSummary([]);
assert.equal(summaryEmpty.toolCalls, 0);
assert.equal(summaryEmpty.inputTokens, undefined, 'no tokens reported yet is not zero');
assert.deepEqual(summaryEmpty.files, []);

// Cursor reports each turn on its own and never a running total. Reading only the last one made a
// chat that had answered ten times show the price of one answer.
const turns = contextSummary([
	event('afterAgentResponse', 'conv-c', 1, {
		input_tokens: 48_000,
		output_tokens: 80,
		cache_read_tokens: 40_000,
	}),
	event('afterAgentResponse', 'conv-c', 2, {
		input_tokens: 52_000,
		output_tokens: 20,
		cache_read_tokens: 36_000,
	}),
]);
assert.equal(turns.inputTokens, 100_000, 'the reading is what the chat has spent, not its last turn');
assert.equal(turns.outputTokens, 100, 'output is spend too');
assert.equal(turns.cachedShare, 0.76, 'cached share is measured over the whole spend');

const uncapped = contextMeter(summaryB);
assert.equal(uncapped.label, '1.0k · 75% cached');
assert.equal(uncapped.overLimit, false);
assert.equal(uncapped.fill, undefined, 'no cap means no fill');
const cappedMeter = contextMeter(summaryB, 800);
assert.equal(cappedMeter.overLimit, true, 'spend at or above the cap is tight');
assert.equal(cappedMeter.fill, 1);
assert.match(cappedMeter.label, /1\.0k \/ 800/);

// ordering: open sessions first, newest first inside each group
const sessions = [
	{ conversationId: 'closed-old', role: 'gamma', status: 'closed', subagents: [] },
	{ conversationId: 'conv-a', role: 'beta', status: 'working', subagents: [] },
	{ conversationId: 'conv-b', role: 'gamma', status: 'idle', subagents: [] },
];
const ordered = orderSessions(sessions, grouped);
assert.deepEqual(
	ordered.map((s) => s.conversationId),
	['conv-b', 'conv-a', 'closed-old'],
	'closed sessions sort last, open sessions by most recent activity'
);

// live edges only for running subagents
assert.deepEqual(sampleState.liveEdges, [{ from: 'beta', to: 'gamma', label: 'bugbot' }]);
assert.deepEqual(sampleState.working.slice().sort(), ['beta', 'gamma'], 'parent and running child both blink');
assert.equal(sampleState.working.includes('alpha'), false, 'roles with no running session never blink');

// events repair a stale persisted status
const closedByReplay = boardState(
	[event('sessionStart', 'stale', 0), event('sessionEnd', 'stale', 1)],
	roleMap,
	{
		sessions: [{ conversationId: 'stale', role: 'alpha', status: 'working', subagents: [] }],
	},
	false
);
assert.equal(closedByReplay.sessions[0].status, 'closed', 'events repair stale persisted status');

// An older installed hook rewrites the state file without the stored ordinal, so the board
// renumbers a persona's chats itself rather than showing two rows with the same name.
const unnumbered = boardState(
	[],
	roleMap,
	{
		sessions: [
			{ conversationId: 'first', role: 'alpha', status: 'idle', subagents: [] },
			{ conversationId: 'second', role: 'alpha', status: 'idle', subagents: [] },
		],
	},
	false
);
assert.deepEqual(
	unnumbered.sessions
		.slice()
		.sort((a, b) => a.conversationId.localeCompare(b.conversationId))
		.map((session) => session.instanceIndex),
	[1, 2],
	'sessions of one persona are numbered in the order the state file lists them'
);

// a failed tool call is its own visible state, not silent idle
const failed = boardState(
	[
		event('sessionStart', 'boom', 0),
		event('beforeSubmitPrompt', 'boom', 1),
		event('postToolUseFailure', 'boom', 2, { tool_name: 'Shell' }),
	],
	roleMap,
	{},
	false
);
assert.equal(failed.sessions[0].status, 'failed');

// ...and it outlives the turn that ended on it, or the one state worth reading is wiped a second
// after it appears.
const failedTurn = boardState(
	[
		event('sessionStart', 'boom', 0),
		event('beforeSubmitPrompt', 'boom', 1),
		event('postToolUseFailure', 'boom', 2, { tool_name: 'Shell' }),
		event('afterAgentResponse', 'boom', 3),
	],
	roleMap,
	{},
	false
);
assert.equal(failedTurn.sessions[0].status, 'failed', 'a turn that ended on a failed tool still reads as failed');

// A failure the agent retried past is not the chat's state: the next successful tool restores the
// working pulse the failure had taken over.
const recovered = boardState(
	[
		event('sessionStart', 'boom', 0),
		event('beforeSubmitPrompt', 'boom', 1),
		event('postToolUseFailure', 'boom', 2, { tool_name: 'Read' }),
		event('postToolUse', 'boom', 3, { tool_name: 'Read' }),
	],
	roleMap,
	{},
	false
);
assert.equal(recovered.sessions[0].status, 'working', 'a recovered failure hands the row back to working');

// human-readable activity copy
assert.equal(activityDescription(event('sessionStart', 'conv-a', 0), 'beta', roleMap), 'New Beta session started');
assert.equal(
	activityDescription(event('sessionStart', 'conv-a', 0), 'guide', roleMap, { guide: 'Ada' }),
	'New Ada session started',
	"activity uses the persona's stable name instead of its internal role id"
);
assert.equal(
	activityDescription(event('subagentStart', 'conv-a', 1, { subagent_type: 'bugbot' }), 'beta', roleMap),
	'Beta delegated to Gamma (bugbot)'
);
assert.equal(
	activityDescription(
		event('postToolUse', 'conv-a', 2, { tool_name: 'Read', tool_input: { path: 'x/y/file.ts' } }),
		'beta',
		roleMap
	),
	'Beta researching — Read on file.ts'
);
assert.equal(
	activityDescription(event('beforeSubmitPrompt', 'conv-a', 1, { composer_mode: 'ask' }), 'beta', roleMap),
	'Beta started answering'
);
assert.equal(
	activityDescription(event('postToolUse', 'conv-a', 2, { tool_name: 'TodoWrite' }), 'alpha', roleMap),
	'Alpha planning — TodoWrite'
);
assert.equal(
	activityDescription(event('sessionEnd', 'conv-a', 3, { reason: 'user_close' }), 'beta', roleMap),
	'Beta session ended (user close)'
);

// formatting
assert.equal(formatTokens(999), '999');
assert.equal(formatTokens(48203), '48.2k');
assert.equal(formatTokens(3201456), '3.2M');

// The budget field takes either unit, and a bare number is millions.
assert.equal(parseTokenBudget('80k'), 80_000);
assert.equal(parseTokenBudget('80K'), 80_000);
assert.equal(parseTokenBudget('5M'), 5_000_000);
assert.equal(parseTokenBudget('2.5m'), 2_500_000);
assert.equal(parseTokenBudget('5'), 5_000_000, 'a bare number is the scale the reading sits at');
assert.equal(parseTokenBudget(' 5 M '), 5_000_000);
assert.equal(parseTokenBudget('0'), null, 'a zero budget is no budget, not an instant trip');
assert.equal(parseTokenBudget('-5'), null);
assert.equal(parseTokenBudget('5G'), null);
assert.equal(parseTokenBudget(''), null);
// What the field shows has to parse back to what is stored, or an untouched field rewrites it.
for (const tokens of [80_000, 2_500_000, 5_000_000, 750]) {
	assert.equal(parseTokenBudget(tokenBudgetField(tokens)), tokens, `${tokens} round-trips`);
}
assert.equal(relativeTime('2026-08-20T13:00:00Z', Date.parse('2026-08-20T13:00:30Z')), '30s ago');
assert.equal(relativeTime('2026-08-20T13:00:00Z', Date.parse('2026-08-20T13:05:00Z')), '5m ago');
assert.equal(relativeTime(undefined, Date.now()), '');

console.log('board-state checks passed');
