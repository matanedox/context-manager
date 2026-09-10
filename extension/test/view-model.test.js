#!/usr/bin/env node
/** The payload the webview renders: npm run compile && node test/view-model.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boardState } = require('../out/model/board-state');
const { personaDisplay } = require('../out/present/view-model');
const { personaName } = require('../out/present/persona');
const { personaDisplayName } = require('../out/data/personas');
const { event, payloadFor, repoContext, repoRoot, roleMap, sampleState } = require('./fixtures');

const payload = payloadFor(
	sampleState,
	false,
	roleMap,
	'conv-a',
	repoContext,
	Date.parse('2026-08-20T13:00:30Z'),
	true,
	repoRoot
);
assert.equal(payload.eventsByConversation, undefined, 'view model must not include Maps');
JSON.stringify(payload);
assert.equal(payload.log.length, 3, 'selected session log is the conv-a events');
assert.equal(
	payloadFor(
		boardState(
			[
				event('sessionStart', 'conv-a', 0),
				event('sessionStart', 'conv-a', 1),
				event('beforeSubmitPrompt', 'conv-a', 2),
			],
			roleMap,
			{},
			false
		),
		false,
		roleMap,
		'conv-a',
		repoContext,
		Date.now()
	).log.filter((row) => row.text.includes('session started')).length,
	1,
	'duplicate sessionStart events collapse to one activity row'
);
// The project manager leads the project roster; the Extension Assistant stays available for extension support at the end.
assert.equal(payload.roster[0].role, 'project-manager');
assert.equal(payload.roster.at(-1).role, 'guide');
assert.equal(payload.roster.at(-1).dimmed, true);
assert.equal(typeof payload.needsSetup, 'boolean');
assert.ok(payload.selectedPersona?.id);
assert.equal(payload.sessions.length, 1, 'closed sessions are hidden');
// A chat closed in Cursor is only reported by its hook, so the row has to survive that report
// long enough to show the closing spinner instead of popping out of the rail.
assert.ok(
	payloadFor(sampleState, false, roleMap, undefined, repoContext, Date.now(), true, undefined, {
		token: 1,
		label: 'Closing session…',
		conversationId: 'conv-b',
		startedAt: Date.now(),
	}).sessions.some((session) => session.conversationId === 'conv-b'),
	'the chat being closed keeps its row while the loader is on it'
);
assert.equal(payload.sessions[0].working, true, 'only a working session gets the pulse flag');
assert.deepEqual(
	Object.keys(payload.roster[0]),
	['role', 'roleLabel', 'name', 'removable', 'dimmed'],
	'roster cards carry no live state, so hook refreshes cannot make them flash'
);
assert.equal(
	payload.roster.at(-1).name,
	undefined,
	'the Extension Assistant has a role title, not a baked-in first name'
);
assert.equal(personaName('project-manager'), undefined, 'the project manager has no default first name');
assert.equal(personaName('project-manager', 'Wendy'), 'Wendy', 'and the persona source is how a project names it');
assert.equal(personaName('beta'), undefined, 'other personas stay unnamed until their source names them');
assert.equal(
	payload.roster.at(-1).roleLabel,
	'Extension Assistant',
	'a card names the role the persona declares, not the capitalised slug of its id'
);
assert.ok(
	payload.collaborators.some((item) => item.kind === 'subagent' && item.subagentType === 'bugbot'),
	'agent detail lists running subagents as talk targets'
);

// The board renders from the payload, so the markup has to keep reading these fields.
const webviewDir = path.resolve(__dirname, '../webview');
const webviewScript = fs
	.readdirSync(webviewDir, { recursive: true })
	.filter((file) => String(file).endsWith('.js'))
	.map((file) => fs.readFileSync(path.join(webviewDir, String(file)), 'utf8'))
	.join('\n');
assert.match(
	webviewScript,
	/aria-busy="true"/,
	'slow chat switching renders its loader inside the affected session row'
);
assert.match(webviewScript, /payload\.contextTabs/, 'context tabs render from the view model');
assert.match(webviewScript, /data-favorite-item/, 'context rows expose favorite controls');
assert.match(webviewScript, /openCursorRules/, "the board can open Cursor's own user rules");
assert.match(webviewScript, /payload\.globalRules/, 'global rules render outside the context tabs');
assert.match(webviewScript, /data-session-limit/, 'the agent screen can set a context cap');
assert.match(webviewScript, /payload\.contextMeter/, 'agent detail renders the context meter');
assert.match(webviewScript, /data-continue-session/, 'a full session offers a fresh one');
assert.match(webviewScript, /data-auto-continue/, 'the budget can opt into auto-continue');
assert.match(
	webviewScript,
	/payload\.contextLimitField/,
	'the budget field carries its own unit: the reading is spend across the chat, not window size'
);
assert.match(webviewScript, /data-toggle-context-help/, 'the meter explains itself in a panel');
assert.match(
	webviewScript,
	/context-meter-kicker">Tokens spent</,
	'the reading is labelled as spend: calling it the context window read as how full the window is'
);
assert.match(
	webviewScript,
	/class="context-meter-copy" data-toggle-context-help/,
	'the reading opens the same explanation as the help button'
);
assert.match(webviewScript, /data-connect-usage/, 'unsigned usage offers a connect button');
assert.match(webviewScript, /data-refresh-usage/, 'usage has a refresh control next to the info button');
assert.match(
	webviewScript,
	/account-usage-actions/,
	'refresh and info share one control cluster at the end of the usage row'
);
assert.match(webviewScript, /data-toggle-usage-help/, 'the usage reading explains itself in a panel');
assert.match(webviewScript, /usage-lead/, 'the spending half of the usage reading leads, the other dims');
assert.equal(payload.accountUsage, undefined, 'usage is host-owned and absent until the board attaches it');
assert.doesNotMatch(
	webviewScript,
	/style="/,
	"the webview CSP has no 'unsafe-inline', so painted html cannot size anything with a style attribute"
);

// persona display copy
assert.equal(personaDisplayName({ id: 'code-reviewer', title: 'Code Reviewer', name: 'SecOps' }), 'SecOps');
const namedPersona = personaDisplay('code-reviewer', 'SecOps');
assert.equal(namedPersona.roleLabel, 'Code Reviewer');
assert.equal(namedPersona.name, 'SecOps');
assert.equal(personaDisplay('security').name, undefined);
assert.equal(
	personaDisplay('guide', 'Extension Assistant', 'Extension Assistant').name,
	undefined,
	'a name that only repeats the role label is not printed twice'
);

// nothing selected: no session is active and no other chat's context leaks in
const initial = payloadFor(sampleState, false, roleMap, undefined, repoContext, Date.parse('2026-08-20T13:00:30Z'));
assert.equal(
	initial.sessions.some((session) => session.active),
	false,
	'initial screen selects no session'
);
assert.equal(initial.log.length, 0, "initial screen does not borrow another session's context");

const pendingState = boardState([], roleMap, { pendingRole: 'delta' }, false);
const pendingPayload = payloadFor(pendingState, false, roleMap, undefined, repoContext, Date.now());
assert.equal(pendingPayload.sessions[0].pending, true, 'a clicked role immediately adds a pending row');
assert.equal(pendingPayload.sessions[0].status, 'starting');
assert.equal(pendingPayload.sessions[0].roleLabel, 'Delta', 'the starting row names the clicked role');

// pending row converts into the real session once the reducer claims the role
const claimed = boardState(
	[event('sessionStart', 'fresh-chat', 0)],
	roleMap,
	{ pendingRole: null, sessions: [{ conversationId: 'fresh-chat', role: 'delta', subagents: [] }] },
	false
);
const claimedPayload = payloadFor(claimed, false, roleMap, undefined, repoContext, Date.now());
assert.equal(claimedPayload.sessions.length, 1, 'the pending row is replaced, not duplicated');
assert.equal(claimedPayload.sessions[0].pending, false);
assert.equal(claimedPayload.sessions[0].roleLabel, 'Delta', 'the new session keeps the clicked role');

// a chat nobody assigned is the one the hooks inject as the guide, so the rail names that role
const unassigned = boardState([event('sessionStart', 'walk-in', 0)], roleMap, {}, false);
const unassignedPayload = payloadFor(unassigned, false, roleMap, 'walk-in', repoContext, Date.now());
assert.equal(unassignedPayload.sessions[0].roleLabel, 'Extension Assistant');
assert.equal(unassignedPayload.sessions[0].name, undefined);
assert.equal(unassignedPayload.selectedRole, 'guide', 'the detail pane agrees with the rail');

// the seeded log's rows name no real chat, so the rail stays empty until hooks fire
const seeded = payloadFor(sampleState, true, roleMap, 'conv-a', repoContext, Date.now());
assert.deepEqual(seeded.sessions, [], 'demo rows would answer neither a click nor their own close');

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
const failedPayload = payloadFor(failed, false, roleMap, 'boom', repoContext, Date.now());
assert.equal(failedPayload.sessions[0].working, false, 'a failed session stops pulsing');
assert.ok(failedPayload.facts.includes('Status: Failed'), 'the agent screen names the failed state');

// activity heat comes from the selected conversation only, never from another chat
const otherChatBusy = payloadFor(sampleState, false, roleMap, 'conv-b', repoContext, Date.now());
assert.equal(
	otherChatBusy.log.some((row) => row.hot),
	false,
	"a subagent running in conv-a must not light up conv-b's log"
);

// every page in the registry produces a payload the board can render
const { PAGES } = require('../out/present/ui');
for (const page of PAGES) {
	const { viewModel } = require('../out/present/view-model');
	const forPage = viewModel(
		{
			root: repoRoot,
			state: sampleState,
			usingDemo: false,
			roleMap,
			context: repoContext,
			handoffs: [],
			globalRules: [],
			hookCheck: { ready: true, missing: [] },
			charterPaths: {},
		},
		{ page, selectedConversationId: 'conv-a', now: Date.now() }
	);
	assert.equal(forPage.page, page, `${page} is reported back to the webview`);
	assert.ok(Array.isArray(forPage.roster), `${page} still carries the shared roster`);
	assert.ok(Array.isArray(forPage.facts), `${page} still carries the agent facts`);
}

const twinA = {
	conversationId: 'twin-a',
	role: 'beta',
	status: 'idle',
	instanceIndex: 1,
	subagents: [],
};
const twinB = {
	conversationId: 'twin-b',
	role: 'beta',
	status: 'idle',
	instanceIndex: 2,
	subagents: [],
};
const twins = payloadFor(
	boardState([], roleMap, { sessions: [twinA, twinB] }, false),
	false,
	roleMap,
	'twin-a',
	repoContext,
	Date.now()
);
assert.equal(twins.sessions.find((row) => row.conversationId === 'twin-a').showInstance, true);
assert.equal(twins.sessions.find((row) => row.conversationId === 'twin-b').showInstance, true);
// The rail only reports: rows carry no editor, and no reading before the first turn.
assert.equal(twins.sessions.find((row) => row.conversationId === 'twin-a').context, undefined);
assert.equal(
	twins.sessions.every((row) => row.canSetLimit === undefined),
	true
);

const loneFirst = payloadFor(
	boardState([], roleMap, { sessions: [twinA] }, false),
	false,
	roleMap,
	'twin-a',
	repoContext,
	Date.now()
);
assert.equal(loneFirst.sessions[0].showInstance, false, 'a lone first session stays unnumbered');

const leftoverSecond = payloadFor(
	boardState([], roleMap, { sessions: [twinB] }, false),
	false,
	roleMap,
	'twin-b',
	repoContext,
	Date.now()
);
assert.equal(leftoverSecond.sessions[0].showInstance, true, 'a leftover ·2 stays numbered after ·1 closes');

console.log('view-model checks passed');
