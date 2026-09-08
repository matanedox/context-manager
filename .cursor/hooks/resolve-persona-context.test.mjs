#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeDir } from './update-agent-state.mjs';
import { resolvePersona, sessionInstanceBrief } from './resolve-persona-context.mjs';

// Runtime state lives outside the workspace; child hook processes inherit this override.
process.env.CURSOR_AGENT_VIZ_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-home-'));

// The hooks and the extension each derive the runtime path; if the two ever disagree, a session
// writes state the board cannot find. Compiled by `npm test` before this runs.
const compiledRuntimeDir = createRequire(import.meta.url)('../../extension/out/data/runtime-dir.js').runtimeDir;
assert.equal(
	runtimeDir(process.cwd()),
	compiledRuntimeDir(process.cwd()),
	'hook and extension must resolve one runtime directory per workspace'
);

const roleMap = { bugbot: 'gamma', explore: 'beta' };

assert.equal(
	resolvePersona(
		{
			hook_event_name: 'subagentStart',
			conversation_id: 'parent-chat',
			parent_conversation_id: 'parent-chat',
			subagent_type: 'bugbot',
		},
		{
			sessions: [
				{
					conversationId: 'parent-chat',
					role: 'alpha',
					subagents: [],
				},
			],
		},
		roleMap,
		null
	).persona,
	'gamma',
	'bugbot maps to gamma even before subagent row exists in state'
);

assert.equal(
	resolvePersona(
		{ hook_event_name: 'beforeSubmitPrompt', conversation_id: 'sub-chat' },
		{
			subagentConversations: {
				'sub-chat': {
					type: 'bugbot',
					role: 'gamma',
					parentConversationId: 'parent-chat',
					status: 'working',
				},
			},
			sessions: [{ conversationId: 'parent-chat', role: 'alpha', subagents: [] }],
		},
		roleMap,
		null
	).persona,
	'gamma',
	'subagent conversation id resolves to mapped persona'
);

assert.equal(
	resolvePersona(
		{ hook_event_name: 'beforeSubmitPrompt', conversation_id: 'parent-chat' },
		{
			sessions: [
				{
					conversationId: 'parent-chat',
					role: 'alpha',
					subagents: [{ type: 'bugbot', role: 'gamma', status: 'working' }],
				},
			],
		},
		roleMap,
		null
	).persona,
	'alpha',
	'parent chat keeps its own persona while a subagent runs'
);

assert.equal(
	resolvePersona({ hook_event_name: 'beforeSubmitPrompt', conversation_id: 'unknown-chat' }, {}, roleMap, null)
		.persona,
	'',
	'a chat the board never started wears no persona, so nothing is injected into it'
);

assert.equal(
	resolvePersona(
		{
			hook_event_name: 'subagentStart',
			conversation_id: 'unknown-chat',
			parent_conversation_id: 'unknown-chat',
			subagent_type: 'bugbot',
		},
		{ sessions: [{ conversationId: 'unknown-chat', role: null, subagents: [] }] },
		roleMap,
		null
	).persona,
	'',
	'and neither do the subagents it launches'
);

assert.equal(
	sessionInstanceBrief({ conversationId: 'one', role: 'beta', instanceIndex: 1, status: 'idle' }, [
		{ conversationId: 'one', role: 'beta', instanceIndex: 1, status: 'idle' },
	]),
	'',
	'a lone first session does not claim a number in identity'
);
assert.match(
	sessionInstanceBrief({ conversationId: 'two', role: 'beta', instanceIndex: 2, status: 'idle' }, [
		{ conversationId: 'one', role: 'beta', instanceIndex: 1, status: 'idle' },
		{ conversationId: 'two', role: 'beta', instanceIndex: 2, status: 'idle' },
	]),
	/You are session 2 of this persona/,
	'a sibling session names its ordinal without conversation ids'
);

// The stop lane: a note for a chat that just finished a turn comes back as a real message there,
// and only once — the note is marked read as it is spoken.
const script = fileURLToPath(new URL('./resolve-persona-context.mjs', import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-stop-'));
fs.mkdirSync(runtimeDir(cwd), { recursive: true });
fs.mkdirSync(path.join(cwd, '.cursor', 'personas'), { recursive: true });
fs.writeFileSync(
	path.join(cwd, '.cursor', 'personas', 'project-manager.md'),
	'---\nid: project-manager\ntitle: Project Manager\nname: Wendy\n---\n'
);
fs.writeFileSync(
	path.join(runtimeDir(cwd), 'current-state.json'),
	JSON.stringify({
		sessions: [
			{ conversationId: 'named-chat', role: 'project-manager', subagents: [] },
			{ conversationId: 'walk-in', role: 'guide', subagents: [] },
			{ conversationId: 'target-chat', role: 'alpha', subagents: [] },
		],
	})
);
const named = JSON.parse(
	execFileSync('node', [script], {
		cwd,
		input: JSON.stringify({
			hook_event_name: 'beforeSubmitPrompt',
			conversation_id: 'named-chat',
			prompt: 'Who are you?',
		}),
		encoding: 'utf8',
	})
);
assert.match(
	named.additional_context,
	/Your name is Wendy\./,
	'the chat receives the stable name shown on its roster card'
);

// The guide must not offer a team the project already has, so its identity carries the roster.
const guided = JSON.parse(
	execFileSync('node', [script], {
		cwd,
		input: JSON.stringify({
			hook_event_name: 'beforeSubmitPrompt',
			conversation_id: 'walk-in',
			prompt: 'Who are you?',
		}),
		encoding: 'utf8',
	})
);
assert.match(guided.additional_context, /already has a roster/);
assert.match(guided.additional_context, /Project Manager \(Wendy\)/, 'named as the roster names him');
assert.doesNotMatch(
	guided.additional_context,
	/propose the Project Manager/,
	'so the guide points at the manager instead of offering a second one'
);

const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-bare-'));
fs.mkdirSync(runtimeDir(bare), { recursive: true });
fs.writeFileSync(
	path.join(runtimeDir(bare), 'current-state.json'),
	JSON.stringify({ sessions: [{ conversationId: 'walk-in', role: 'guide', subagents: [] }] })
);
const bareGuide = JSON.parse(
	execFileSync('node', [script], {
		cwd: bare,
		input: JSON.stringify({ hook_event_name: 'beforeSubmitPrompt', conversation_id: 'walk-in' }),
		encoding: 'utf8',
	})
);
assert.match(
	bareGuide.additional_context,
	/declares no personas yet/,
	'a project with no roster still hears the offer of its first persona'
);
fs.rmSync(bare, { recursive: true, force: true });
fs.writeFileSync(
	path.join(runtimeDir(cwd), 'context-handoffs.jsonl'),
	`${JSON.stringify({
		id: 'n1',
		fromRole: 'beta',
		to: { kind: 'session', role: 'alpha', conversationId: 'target-chat' },
		text: 'ship the form',
		read: false,
	})}\n${JSON.stringify({
		id: 'n2',
		fromRole: 'beta',
		to: { kind: 'subagent', role: 'gamma', conversationId: 'target-chat', subagentType: 'bugbot' },
		text: 'regress login',
		read: false,
	})}\n${JSON.stringify({
		id: 'n3',
		fromConversationId: 'target-chat',
		fromRole: 'alpha',
		to: { kind: 'session', role: 'alpha', conversationId: 'target-chat' },
		text: 'Launch a subagent wearing the Gamma persona',
		read: false,
	})}\n`
);

const stop = () =>
	JSON.parse(
		execFileSync('node', [script], {
			cwd,
			input: JSON.stringify({ hook_event_name: 'stop', conversation_id: 'target-chat' }),
			encoding: 'utf8',
		})
	);

const spoken = stop();
assert.match(spoken.followup_message, /Handoff from the beta: ship the form/);
assert.doesNotMatch(spoken.followup_message, /regress login/, "a subagent's note is not spoken in its parent chat");
assert.match(
	spoken.followup_message,
	/Board request: Launch a subagent wearing the Gamma persona/,
	'a note this chat sent itself reads as a board request, not a handoff from a peer'
);
assert.equal(stop().followup_message, undefined, 'a note is spoken once, so stop cannot loop on it');

// A chat Cursor opened by itself, in a workspace the board is running in: it gets nothing at all.
for (const hook_event_name of ['beforeSubmitPrompt', 'stop']) {
	assert.deepEqual(
		JSON.parse(
			execFileSync('node', [script], {
				cwd,
				input: JSON.stringify({ hook_event_name, conversation_id: 'cursors-own-chat' }),
				encoding: 'utf8',
			})
		),
		{},
		`${hook_event_name} adds no scrum context to a chat the board never started`
	);
}
fs.rmSync(cwd, { recursive: true, force: true });

console.log('resolve-persona-context checks passed');
