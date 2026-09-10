/** Archiving acts on the focused chat, so command order and the success check are what matter. */
const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

// Runtime state lives outside the workspace; redirect the whole tree so tests own it.
process.env.CURSOR_AGENT_VIZ_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-home-'));
const { runtimeDir, runtimeFile } = require('../out/data/runtime-dir');

const LIST = 'composer.getOrderedSelectedComposerIds';
const calls = [];
let registry = [];
// Chats Cursor still lists as open; archiving is only believed once the id leaves this list.
let open = [];
// Chats Cursor opens into an editor tab: the pane list never reports them, so no open is confirmed.
let unlisted = new Set();
let focused;
// Whether Cursor's archive command really archives, or resolves without doing anything.
let archives = true;
// Registered commands that throw, like a create that fires its hooks and then fails to store.
let failing = new Set();
// The chat a create makes, when the case needs Cursor to really produce one.
let created;
const stub = {
	Uri: { file: (fsPath) => ({ fsPath }) },
	env: { clipboard: { writeText: async () => {} } },
	window: {
		showInformationMessage: () => {},
		showWarningMessage: () => {},
		showErrorMessage: () => {},
	},
	commands: {
		getCommands: async () => registry,
		executeCommand: async (command, ...args) => {
			if (!registry.includes(command)) throw new Error(`command not found: ${command}`);
			calls.push([command, ...args]);
			if (failing.has(command)) throw new Error(`command failed: ${command}`);
			if (command === 'composer.createNew' && created) open = [created, ...open];
			if (command === 'composer.openComposer') {
				const id = args[0];
				const opts = args[1];
				focused = id;
				if (unlisted.has(id)) {
					/* opened, but into an editor tab the pane list cannot see */
				} else if (opts?.openInNewTab || open.includes(id)) {
					open = [id, ...open.filter((entry) => entry !== id)];
				} else {
					// Default openComposer swaps the previous chat out of the tab strip.
					open = [id];
				}
			}
			const target = command === 'composer.archiveComposer' ? args[0] : focused;
			const archiving = command === 'composer.archiveComposer' || command === 'glass.archiveActiveAgent';
			if (archiving && archives) open = open.filter((id) => id !== target);
			if (command === 'composer.closeComposerTab') open = open.filter((id) => id !== args[0]);
			return command === LIST ? open : undefined;
		},
	},
};

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = (request, ...rest) =>
	request === 'vscode' ? 'vscode-stub' : resolveFilename(request, ...rest);
require.cache['vscode-stub'] = {
	id: 'vscode-stub',
	filename: 'vscode-stub',
	loaded: true,
	exports: stub,
};

const {
	archiveChat,
	attachFileToChat,
	focusChat,
	newChat,
	openChat,
	resetChatQueueForTests,
	runChatTask,
	scheduleOpenChat,
} = require('../out/host/cursor-chat');
const { reapClosedSessions, resetClosingForTests } = require('../out/host/commands/close');
const { waitForCreatedChat } = require('../out/host/session-ready');
const { leftoverTabs, startRoleSession } = require('../out/host/commands/session-start');
const { hooksInstalled, installHooks } = require('../out/data/hooks-install');
const { InlineLoading } = require('../out/host/inline-loading');

const attempted = () => calls.filter(([command]) => command !== LIST);

function scenario(commands, openChats, reallyArchives = true, failingCommands = []) {
	resetChatQueueForTests();
	calls.length = 0;
	registry = [LIST, ...commands];
	open = openChats;
	archives = reallyArchives;
	focused = undefined;
	failing = new Set(failingCommands);
	unlisted = new Set();
	created = undefined;
}

const GLASS = ['composer.openComposer', 'glass.archiveActiveAgent', 'composer.closeComposerTab'];

async function main() {
	// Cursor archives the active chat, so the chat is focused first and then archived.
	scenario(GLASS, ['chat-1']);
	assert.equal(await archiveChat('chat-1'), true);
	assert.deepEqual(attempted(), [['composer.openComposer', 'chat-1'], ['glass.archiveActiveAgent']]);

	// An archive command that names the chat needs no focus dance.
	scenario(['composer.openComposer', 'composer.archiveComposer'], ['chat-2']);
	assert.equal(await archiveChat('chat-2'), true);
	assert.deepEqual(attempted(), [['composer.archiveComposer', 'chat-2']]);

	// A Cursor build with no archive command still closes the chat.
	scenario(['composer.closeComposerTab'], ['chat-3']);
	assert.equal(await archiveChat('chat-3'), true);
	assert.deepEqual(attempted(), [['composer.closeComposerTab', 'chat-3']]);

	// The archive command resolves without archiving (scope gate): close the chat instead.
	scenario(GLASS, ['chat-4'], false);
	assert.equal(await archiveChat('chat-4'), true);
	assert.deepEqual(attempted(), [
		['composer.openComposer', 'chat-4'],
		['glass.archiveActiveAgent'],
		['composer.closeComposerTab', 'chat-4'],
	]);

	scenario([], []);
	assert.equal(await archiveChat('chat-5'), false, 'nothing available is reported, not thrown');

	// Rapid session picks coalesce: only the last chat is opened, not every click in order.
	scenario(['composer.openComposer'], ['chat-a']);
	scheduleOpenChat('chat-a');
	scheduleOpenChat('chat-b');
	scheduleOpenChat('chat-c');
	await runChatTask(async () => {});
	assert.deepEqual(
		attempted().filter(([command]) => command === 'composer.openComposer'),
		[['composer.openComposer', 'chat-c', { openInNewTab: true }]],
		'an in-flight open for an older session must not win after the user picked another'
	);

	// Switching sessions must not swap the previous chat out of Cursor's open list.
	scenario(['composer.openComposer'], ['chat-a']);
	assert.equal(await openChat('chat-b'), true);
	assert.deepEqual(open, ['chat-b', 'chat-a'], 'openInNewTab keeps the prior session open');
	assert.deepEqual(attempted()[0], ['composer.openComposer', 'chat-b', { openInNewTab: true }]);

	// A persona chat is created off-screen, so Cursor's pane list cannot confirm the open. The retry
	// must not ask for a tab a second time, or one click on a persona leaves two tabs of one chat.
	scenario(['composer.openComposer'], ['chat-a']);
	unlisted = new Set(['chat-b']);
	assert.equal(await openChat('chat-b'), true);
	assert.deepEqual(
		attempted().filter(([, , opts]) => opts?.openInNewTab),
		[['composer.openComposer', 'chat-b', { openInNewTab: true }]],
		'only the first open may ask for a new tab'
	);

	// Cursor attaches to the focused composer, so Add has to move focus to the chat it names.
	scenario(['composer.openComposer', 'composer.focusComposer', 'composer.addfilestocomposer'], ['chat-a', 'chat-b']);
	focused = 'chat-a';
	assert.equal(await attachFileToChat('chat-b', '/tmp/rule.md'), true);
	assert.deepEqual(attempted(), [
		['composer.openComposer', 'chat-b'],
		['composer.focusComposer', 'chat-b'],
		['composer.addfilestocomposer', { fsPath: '/tmp/rule.md' }, { useExactResource: true }],
	]);
	assert.equal(focused, 'chat-b', 'the file lands in the chat the board named, not the last one');

	// Bare focusComposer falls back to Cursor's own selected chat, so Focus has to name the chat.
	scenario(['composer.openComposer', 'composer.focusComposer'], ['chat-a', 'chat-b']);
	assert.equal(await focusChat('chat-b'), true);
	assert.deepEqual(attempted(), [
		['composer.openComposer', 'chat-b'],
		['composer.focusComposer', 'chat-b'],
	]);

	// Starting another persona must not replace or end the currently working chat.
	scenario(['composer.createNew'], ['working-chat']);
	assert.equal(await newChat(), true);
	assert.deepEqual(attempted(), [['composer.createNew', { openInNewTab: true }]]);
	assert.deepEqual(open, ['working-chat'], 'creating a tab does not close the working session');

	// Cursor fires sessionStart before it finishes storing the composer, so a create that rejects has
	// already made a chat. Falling back to another create command is what opened a second tab.
	scenario(['composer.createNew', 'aichat.newchataction'], ['working-chat'], true, ['composer.createNew']);
	assert.equal(await newChat(true), false, 'a failed create is reported, not retried elsewhere');
	assert.deepEqual(
		attempted().map(([command]) => command),
		['composer.createNew'],
		'only one create command may run, or one persona click opens two chats'
	);

	// A build without Cursor's own create command still falls back to the chat panel action, and the
	// fallback is given the same options: without them the walkthrough opened with an empty composer.
	scenario(['aichat.newchataction'], ['working-chat']);
	assert.equal(await newChat(false, 'Hi', true), true);
	assert.deepEqual(attempted(), [['aichat.newchataction', { partialState: { text: 'Hi', richText: 'Hi' } }]]);

	scenario(['composer.createNew'], ['working-chat']);
	assert.equal(await newChat(true), true);
	assert.deepEqual(
		attempted(),
		[['composer.createNew', { openInNewTab: true, skipSelect: true, skipShowAndFocus: true }]],
		'hook-backed chats stay hidden while persona context is bound'
	);

	// The hello waits in the composer for the user to send: a create that submits by itself would
	// make the board speak in the user's voice.
	scenario(['composer.createNew'], ['working-chat']);
	assert.equal(await newChat(false, 'Hi', true), true);
	assert.deepEqual(
		attempted(),
		[['composer.createNew', { partialState: { text: 'Hi', richText: 'Hi' } }]],
		'the walkthrough carries the text, no autoSubmit, and takes the empty tab it was created from'
	);

	const background = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-background-'));
	fs.mkdirSync(runtimeDir(background), { recursive: true });
	fs.writeFileSync(
		runtimeFile(background, 'events.jsonl'),
		`${JSON.stringify({
			type: 'sessionStart',
			raw: { hook_event_name: 'sessionStart', conversation_id: 'hidden-chat' },
		})}\n`
	);
	assert.equal(
		await waitForCreatedChat(background, path.resolve(__dirname, '..'), new Set(), 0, 50),
		'hidden-chat',
		'the hook event identifies a background chat before it is focused'
	);

	fs.appendFileSync(
		runtimeFile(background, 'events.jsonl'),
		`${JSON.stringify({
			type: 'sessionStart',
			raw: { hook_event_name: 'sessionStart', conversation_id: 'new-chat' },
		})}\n`
	);
	open = ['old-chat'];
	assert.equal(
		await waitForCreatedChat(background, path.resolve(__dirname, '..'), new Set(['old-chat']), 1, 50),
		'new-chat',
		'hook wins when the tab baseline is known'
	);

	open = ['old-chat', 'brand-new'];
	assert.equal(
		await waitForCreatedChat(background, path.resolve(__dirname, '..'), new Set(['old-chat']), 0, 50),
		'brand-new',
		'foreground picks the new tab when the baseline is known'
	);

	// A workspace with no session log falls back to the bundled demo, whose events carry
	// sessionStart ids of their own. Binding one opened the demo id as a second, empty chat.
	const demoOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-demo-only-'));
	open = ['real-chat'];
	assert.equal(
		await waitForCreatedChat(demoOnly, path.resolve(__dirname, '..'), new Set(), 0, 50),
		undefined,
		'demo events never identify a chat Cursor created'
	);
	assert.equal(
		await waitForCreatedChat(demoOnly, path.resolve(__dirname, '..'), new Set(['old-chat']), 0, 50),
		'real-chat',
		'the real new tab still wins over the demo log'
	);
	fs.rmSync(demoOnly, { recursive: true, force: true });

	const noHook = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-no-hook-'));
	fs.mkdirSync(runtimeDir(noHook), { recursive: true });
	fs.writeFileSync(
		runtimeFile(noHook, 'events.jsonl'),
		`${JSON.stringify({ type: 'beforeSubmitPrompt', raw: { conversation_id: 'old-chat' } })}\n`
	);
	open = ['old-chat'];
	assert.equal(
		await waitForCreatedChat(noHook, path.resolve(__dirname, '..'), new Set(), 0, 50),
		undefined,
		'an empty tab baseline does not treat an existing chat as newly created'
	);
	fs.rmSync(noHook, { recursive: true, force: true });
	fs.rmSync(background, { recursive: true, force: true });

	// Cursor leaves one empty chat in a window and a persona start opens beside it, so that tab is
	// tidied up — but only when nothing has happened in it and no persona owns it.
	const strays = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-strays-'));
	fs.mkdirSync(runtimeDir(strays), { recursive: true });
	fs.writeFileSync(
		runtimeFile(strays, 'events.jsonl'),
		[
			{ type: 'sessionStart', raw: { conversation_id: 'idle-chat' } },
			{ type: 'sessionStart', raw: { conversation_id: 'persona-chat', role: 'beta' } },
			{ type: 'sessionStart', raw: { conversation_id: 'working-chat' } },
			{ type: 'beforeSubmitPrompt', raw: { conversation_id: 'working-chat' } },
		]
			.map((event) => JSON.stringify(event))
			.join('\n')
	);
	assert.deepEqual(
		leftoverTabs(
			strays,
			path.resolve(__dirname, '..'),
			new Set(['idle-chat', 'persona-chat', 'working-chat', 'new-chat']),
			'new-chat'
		),
		['idle-chat'],
		"only an untouched, unassigned chat loses its tab: never the new one, a persona's, or a busy one"
	);
	assert.deepEqual(
		leftoverTabs(strays, path.resolve(__dirname, '..'), new Set(), 'new-chat'),
		[],
		"a chat that was not already open is not Cursor's leftover"
	);
	// A window opening lists its empty composer only after the board took its baseline, so the
	// cleanup passes the tabs open at that point too and the walkthrough stops leaving one behind.
	assert.deepEqual(
		leftoverTabs(strays, path.resolve(__dirname, '..'), new Set(['idle-chat', 'new-chat']), 'new-chat'),
		['idle-chat'],
		'an empty tab Cursor listed late is still a leftover'
	);
	fs.rmSync(strays, { recursive: true, force: true });

	const phases = [];
	let loading;
	loading = new InlineLoading(() => phases.push(loading.current ? 'loading' : 'done'));
	const token = loading.begin('Loading context…');
	assert.equal(await loading.finish(token, 0), true);
	phases.push('open');
	assert.deepEqual(phases, ['loading', 'done', 'open'], 'the inline loader is painted done before the chat may open');

	// A chat closed in Cursor is reaped, and its loader has to outlive the state it spins on: purging
	// first let a repaint inside the hold drop the row, so the close showed no loader at all.
	const closing = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-closing-'));
	fs.mkdirSync(runtimeDir(closing), { recursive: true });
	fs.writeFileSync(
		runtimeFile(closing, 'events.jsonl'),
		`${JSON.stringify({ type: 'sessionEnd', raw: { conversation_id: 'gone-chat' } })}\n`
	);
	resetClosingForTests();
	// The last purge leaves the log in place but empty, so the chat's own lines are the probe.
	const log = () => {
		const file = runtimeFile(closing, 'events.jsonl');
		return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
	};
	const stillThere = () => log().includes('gone-chat');
	const phase = [];
	const reapHost = {
		root: closing,
		loading: {
			begin: () => 7,
			hold: async () => phase.push(['hold', stillThere()]),
			finish: async () => {
				phase.push(['finish', stillThere()]);
				return true;
			},
		},
		refresh: () => {},
		deselect: () => {},
	};
	// The board watched this chat while it was open, so its close is one the rail has to report.
	reapClosedSessions(reapHost, [{ conversationId: 'gone-chat', status: 'idle' }]);
	reapClosedSessions(reapHost, [{ conversationId: 'gone-chat', status: 'closed' }]);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(
		phase,
		[
			['hold', true],
			['finish', false],
		],
		'the chat is on the board for the whole hold and purged before the loader clears, so its row never comes back'
	);
	fs.rmSync(closing, { recursive: true, force: true });

	// A row the board finds already closed at startup was closed while it was not watching: spinning
	// it showed a chat the user had already closed, which then closed a second time on its own.
	const stale = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-stale-'));
	fs.mkdirSync(runtimeDir(stale), { recursive: true });
	fs.writeFileSync(
		runtimeFile(stale, 'events.jsonl'),
		`${JSON.stringify({ type: 'sessionEnd', raw: { conversation_id: 'stale-chat' } })}\n`
	);
	resetClosingForTests();
	const quiet = [];
	reapClosedSessions(
		{
			root: stale,
			loading: { begin: () => quiet.push('begin'), hold: async () => {}, finish: async () => true },
			refresh: () => {},
			deselect: () => {},
		},
		[{ conversationId: 'stale-chat', status: 'closed' }]
	);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(quiet, [], 'a row already closed when the board starts never reaches the rail');
	assert.equal(
		fs.readFileSync(runtimeFile(stale, 'events.jsonl'), 'utf8').includes('stale-chat'),
		false,
		'and it is purged all the same'
	);
	fs.rmSync(stale, { recursive: true, force: true });

	// A session opened beside another one of the same persona must end with the caret in the new
	// chat: waking the neighbour to tell it a sibling exists made that chat take a turn and pulled
	// Cursor back to it, and an open without a focus left the next thing typed in the old composer.
	// The new chat is the one resumed, so it acts on the brief without waiting to be sent.
	const beside = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-beside-'));
	fs.mkdirSync(path.join(beside, '.cursor', 'personas'), { recursive: true });
	fs.writeFileSync(
		path.join(beside, '.cursor', 'personas', 'alpha.md'),
		'---\nid: alpha\ntitle: Alpha\ndescription: Owns alpha.\n---\n\nOwns alpha.\n'
	);
	fs.mkdirSync(runtimeDir(beside), { recursive: true });
	fs.writeFileSync(
		runtimeFile(beside, 'events.jsonl'),
		`${JSON.stringify({
			type: 'sessionStart',
			raw: { hook_event_name: 'sessionStart', conversation_id: 'old-chat', role: 'alpha' },
		})}\n`
	);
	fs.writeFileSync(
		runtimeFile(beside, 'current-state.json'),
		JSON.stringify({
			sessions: [{ conversationId: 'old-chat', role: 'alpha', status: 'idle', subagents: [] }],
		})
	);
	scenario(
		['composer.createNew', 'composer.openComposer', 'composer.focusComposer', 'composer.resumeCurrentChat'],
		['old-chat']
	);
	created = 'new-chat';
	startRoleSession(
		{
			root: beside,
			extensionPath: path.resolve(__dirname, '..'),
			loading: new InlineLoading(() => {}),
			refresh: () => {},
			pin: () => {},
			release: () => {},
			showAgentPage: () => {},
		},
		'alpha',
		'You are a second chat for Alpha, opened beside Alpha session 1.'
	);
	await runChatTask(async () => {});
	const order = attempted().map(([command, id]) => `${command} ${id ?? ''}`.trim());
	// resumeCurrentChat takes no id and acts on the selected composer, so the focus right before it
	// is the whole guarantee about which chat wakes up.
	assert.ok(
		!order.includes('composer.focusComposer old-chat'),
		'the session it was opened beside is never focused, so no resume can land in it'
	);
	assert.deepEqual(
		order.slice(-2),
		['composer.focusComposer new-chat', 'composer.resumeCurrentChat'],
		'the caret ends up in the new chat and the resume there delivers the brief without a user send'
	);
	assert.equal(focused, 'new-chat', 'the new chat is the one on screen');
	const note = fs
		.readFileSync(runtimeFile(beside, 'context-handoffs.jsonl'), 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.find((row) => row.to.conversationId === 'old-chat');
	assert.match(
		note.text,
		/Another Alpha session opened/,
		'the neighbour is still told, it just reads the note on its own next turn'
	);
	fs.rmSync(beside, { recursive: true, force: true });

	// Hooks wired on disk are not hooks that run: with no `node` on Cursor's PATH every one of them
	// dies silently. Creating the chat off-screen for them then loses it for good, so a workspace
	// whose log is still empty gets a chat it can see.
	const dead = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-dead-hooks-'));
	fs.mkdirSync(path.join(dead, '.cursor', 'personas'), { recursive: true });
	fs.writeFileSync(
		path.join(dead, '.cursor', 'personas', 'alpha.md'),
		'---\nid: alpha\ntitle: Alpha\ndescription: Owns alpha.\n---\n\nOwns alpha.\n'
	);
	installHooks(dead, path.resolve(__dirname, '..'));
	assert.equal(hooksInstalled(dead), true, 'the workspace is fully wired, so only the empty log says they are dead');
	scenario(['composer.createNew', 'composer.openComposer', 'composer.focusComposer'], ['old-chat']);
	created = 'new-chat';
	startRoleSession(
		{
			root: dead,
			extensionPath: path.resolve(__dirname, '..'),
			loading: new InlineLoading(() => {}),
			refresh: () => {},
			pin: () => {},
			release: () => {},
			showAgentPage: () => {},
		},
		'alpha'
	);
	await runChatTask(async () => {});
	assert.deepEqual(
		attempted()[0],
		['composer.createNew', { openInNewTab: true }],
		'a chat is never hidden behind hooks that have never fired, or nothing can reveal it again'
	);
	assert.equal(focused, 'new-chat', 'and the session still starts: the persona chat is on screen');
	fs.rmSync(dead, { recursive: true, force: true });

	console.log('cursor-chat checks passed');
}

main();
