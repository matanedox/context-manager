/** Fixtures shared by the split test files, so each one only sets up what it varies. */
const path = require('node:path');
const { boardState } = require('../out/model/board-state');
const { groupByConversation } = require('../out/model/events');
const { readHandoffs } = require('../out/data/handoffs');
const { workspaceContext } = require('../out/data/workspace-context');
const { viewModel } = require('../out/present/view-model');

const roleMap = { explore: 'beta', bugbot: 'gamma' };

const event = (type, conversationId, second, extra = {}) => ({
	ts: `2026-08-20T13:00:${String(second).padStart(2, '0')}Z`,
	type,
	raw: { hook_event_name: type, conversation_id: conversationId, ...extra },
});

/** Two chats plus one event with no conversation id, which must be dropped. */
const sampleEvents = [
	event('sessionStart', 'conv-a', 0),
	event('beforeSubmitPrompt', 'conv-a', 1),
	event('postToolUse', 'conv-a', 2, { tool_name: 'Read', tool_input: { path: 'a/one.ts' } }),
	event('sessionStart', 'conv-b', 3),
	event('postToolUse', 'conv-b', 4, { tool_name: 'Shell', tool_input: { path: 'b/two.ts' } }),
	event('afterAgentResponse', 'conv-b', 5, {
		model: 'auto-smart',
		input_tokens: 1000,
		output_tokens: 20,
		cache_read_tokens: 750,
	}),
	event('sessionEnd', 'conv-b', 6, { reason: 'user_close', final_status: 'completed' }),
	{ ts: '2026-08-20T13:00:07Z', type: 'postToolUse', raw: { hook_event_name: 'postToolUse' } },
];

const grouped = groupByConversation(sampleEvents);

/** conv-a working with one running subagent; conv-b closed. */
const sampleState = boardState(
	sampleEvents,
	roleMap,
	{
		sessions: [
			{
				conversationId: 'conv-a',
				role: 'beta',
				status: 'working',
				subagents: [
					{ type: 'bugbot', role: 'gamma', status: 'working' },
					{ type: 'explore', role: 'beta', status: 'stopped' },
				],
			},
			{ conversationId: 'conv-b', role: 'gamma', status: 'closed', subagents: [] },
		],
	},
	false
);

const repoRoot = path.resolve(__dirname, '../..');
const repoContext = workspaceContext(repoRoot);

/** Builds the snapshot viewModel takes, so each assertion names only what it varies. */
const payloadFor = (state, usingDemo, map, selectedId, context, now, hooksReady = true, root, loading) =>
	viewModel(
		{
			root,
			state,
			usingDemo,
			roleMap: map,
			context,
			handoffs: readHandoffs(root),
			globalRules: [],
			hookCheck: { ready: hooksReady, missing: [] },
			charterPaths: {},
		},
		{ page: 'agent', selectedConversationId: selectedId, now, loading }
	);

module.exports = {
	event,
	grouped,
	payloadFor,
	repoContext,
	repoRoot,
	roleMap,
	sampleEvents,
	sampleState,
};
