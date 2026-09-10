#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDirectRun, pruneSessions, reduceSessions, runtimeDir } from './update-agent-state.mjs';

const roleMap = { explore: 'beta', shell: 'epsilon' };
const event = (type, conversationId, extra = {}) => ({
	ts: `2026-08-20T13:00:${String(extra.second ?? 0).padStart(2, '0')}Z`,
	type,
	raw: { hook_event_name: type, conversation_id: conversationId, ...extra },
});

const events = [
	event('sessionStart', 'existing'),
	event('sessionStart', 'beta-chat', { second: 1 }),
	event('beforeSubmitPrompt', 'beta-chat', { second: 2 }),
	event('sessionStart', 'gamma-chat', { second: 3 }),
	event('beforeSubmitPrompt', 'gamma-chat', { second: 4 }),
	event('subagentStart', 'beta-chat', { second: 5, subagentType: 'explore' }),
	event('subagentStop', 'beta-chat', { second: 6, subagentType: 'explore' }),
	event('afterAgentResponse', 'beta-chat', { second: 7 }),
	event('sessionEnd', 'gamma-chat', { second: 8 }),
];

const assignments = new Map([['gamma-chat', { role: 'gamma', highlighted: false }]]);
const result = reduceSessions(events, roleMap, assignments, {
	role: 'beta',
	afterEventCount: 1,
});
const byId = new Map(result.sessions.map((session) => [session.conversationId, session]));

assert.equal(result.claimedPending, true, 'the next sessionStart claims the pending role');
assert.equal(byId.get('existing').role, null, 'a chat nobody assigned belongs to no persona');
assert.equal(byId.get('beta-chat').role, 'beta');
assert.equal(byId.get('beta-chat').status, 'idle', 'response completion returns to idle');
assert.equal(byId.get('beta-chat').highlighted, false, 'completed work clears click focus');
assert.equal(byId.get('beta-chat').subagents[0].status, 'stopped');
assert.equal(byId.get('gamma-chat').role, 'gamma', 'concurrent sessions keep independent roles');
assert.equal(byId.get('gamma-chat').status, 'closed', 'sessionEnd closes only its session');

const justOpened = reduceSessions([event('sessionStart', 'new-chat')], roleMap, new Map(), {
	role: 'delta',
	afterEventCount: 0,
}).sessions[0];
assert.equal(justOpened.highlighted, true, 'click focus survives until the first response completes');

const typedElsewhere = reduceSessions(
	[event('sessionStart', 'other-chat'), event('beforeSubmitPrompt', 'other-chat', { second: 1 })],
	roleMap,
	new Map(),
	{ role: 'gamma', afterEventCount: 1 }
);
assert.equal(
	typedElsewhere.claimedPending,
	false,
	'typing in a chat that already existed must not steal the clicked role'
);
assert.equal(typedElsewhere.sessions[0].role, null);
assert.equal(typedElsewhere.sessions[0].status, 'working');

// The board writes the clicked role onto its own sessionStart; a recompute must not undo it.
const boardClick = reduceSessions(
	[event('sessionStart', 'clicked', { reason: 'board_click', role: 'clicked' })],
	roleMap,
	new Map([['clicked', { role: 'alpha', highlighted: false }]]),
	null
).sessions[0];
assert.equal(boardClick.role, 'clicked', 'the role on the event outranks the previous state file');

const failed = reduceSessions(
	[
		event('sessionStart', 'boom'),
		event('beforeSubmitPrompt', 'boom', { second: 1 }),
		event('postToolUseFailure', 'boom', { second: 2, tool_name: 'Shell' }),
	],
	roleMap,
	new Map(),
	null
).sessions[0];
assert.equal(failed.status, 'failed', 'a failed tool call is a distinct session state');

const waiting = reduceSessions([event('postToolUse', 'unrelated', { tool_name: 'Read' })], roleMap, new Map(), {
	role: 'epsilon',
	afterEventCount: 0,
});
assert.equal(waiting.claimedPending, false, 'tool events cannot consume a pending role');

const many = [
	{
		conversationId: 'open-a',
		role: 'beta',
		status: 'working',
		lastEventAt: '2026-08-20T10:00:00Z',
	},
	{ conversationId: 'open-b', role: 'gamma', status: 'idle', lastEventAt: '2026-08-20T09:00:00Z' },
	...Array.from({ length: 12 }, (_, index) => ({
		conversationId: `closed-${index}`,
		role: 'alpha',
		status: 'closed',
		lastEventAt: `2026-08-20T08:${String(index).padStart(2, '0')}:00Z`,
	})),
];
const pruned = pruneSessions(many, 3);
const prunedIds = pruned.map((session) => session.conversationId);

assert.deepEqual(
	prunedIds.filter((id) => id.startsWith('open')),
	['open-a', 'open-b'],
	'every live session is retained regardless of the cap'
);
assert.deepEqual(
	prunedIds.filter((id) => id.startsWith('closed')),
	['closed-11', 'closed-10', 'closed-9'],
	'only the most recent closed sessions survive'
);
assert.equal(
	pruned.find((session) => session.conversationId === 'open-a').role,
	'beta',
	'pruning preserves role assignments'
);

const keptExtras = reduceSessions(
	[event('sessionStart', 'kept', { role: 'beta' })],
	roleMap,
	new Map([['kept', { role: 'beta', highlighted: false }]]),
	null,
	new Set(['kept']),
	new Map([
		[
			'kept',
			{
				instanceIndex: 2,
				contextLimitTokens: 80000,
				autoContinueOnLimit: true,
				autoContinuedTo: 'next',
			},
		],
	])
).sessions[0];
assert.equal(keptExtras.instanceIndex, 2, "a recompute must not drop the board's session ordinal");
assert.equal(keptExtras.contextLimitTokens, 80000, 'or the per-session context cap');
assert.equal(keptExtras.autoContinueOnLimit, true, 'or the auto-continue checkbox');
assert.equal(keptExtras.autoContinuedTo, 'next', 'or the rollover once-guard');
assert.equal(isDirectRun(import.meta.url), true, 'a node argv path still counts as a direct run on this OS');
assert.equal(isDirectRun('file:///not-this-module.mjs'), false, 'a different module is not a direct run');

// Windows pipes the hook payload through PowerShell, which prefixes a UTF-8 BOM. A parse that
// chokes on it is swallowed by the hook's own catch, so the board just goes quiet: run the real
// script end to end rather than trusting the reader in isolation.
process.env.CURSOR_AGENT_VIZ_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-'));
const piped = spawnSync(process.execPath, [fileURLToPath(new URL('./log-agent-event.mjs', import.meta.url))], {
	input: `\uFEFF${JSON.stringify({ hook_event_name: 'sessionStart', conversation_id: 'bom-chat' })}`,
	env: process.env,
	encoding: 'utf8',
});
assert.equal(piped.status, 0, piped.stderr);
assert.ok(
	fs.readFileSync(path.join(runtimeDir(), 'events.jsonl'), 'utf8').includes('"conversation_id":"bom-chat"'),
	'a BOM-prefixed payload is still logged'
);
fs.rmSync(process.env.CURSOR_AGENT_VIZ_HOME, { recursive: true, force: true });
console.log('session-state checks passed');
