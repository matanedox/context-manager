#!/usr/bin/env node
/**
 * Without hooks a chat cannot know its persona, so the board must detect and install them.
 * node test/hooks-install.test.js
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
	checkHooks,
	hookSource,
	hooksInstalled,
	installHooks,
	resolveNodeCommand,
	uninstallHooks,
} = require('../out/data/hooks-install');
const { workspaceSlug } = require('../out/data/runtime-dir');

// A build with no bundled scripts installs nothing, so repairHooks reports that instead of
// writing an empty hooks folder and leaving the board's warning up.
assert.equal(
	hookSource(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-nosource-'))),
	undefined,
	'a build with no bundled hook scripts is detectable before anything is written'
);

// The board hides its warning for this exact result: no folder open is nothing to repair.
assert.deepEqual(
	checkHooks(undefined).missing,
	['workspace'],
	'a window with no workspace folder is reported as that alone, never as a broken install'
);

const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-hooks-'));
assert.equal(hooksInstalled(bare), false, 'a workspace with no hooks is reported as missing');
assert.ok(checkHooks(bare).missing.includes('.cursor/hooks.json'), 'the check explains that hooks.json is missing');
const extensionPath = path.resolve(__dirname, '..');
const installed = installHooks(bare, extensionPath);
assert.ok(installed.includes('.cursor/hooks.json'), 'installing wires up hooks.json');
assert.ok(installed.includes('.gitignore'), 'install lists the ignore file it wrote');
const ignore = fs.readFileSync(path.join(bare, '.gitignore'), 'utf8');
assert.match(ignore, /\.cursor\/hooks\.json/, 'hooks.json is ignored so it never hits git status');
assert.match(ignore, /\.cursor\/hooks\/log-agent-event\.mjs/, 'copied scripts are ignored, not the whole hooks folder');
installHooks(bare, extensionPath);
assert.equal(
	fs.readFileSync(path.join(bare, '.gitignore'), 'utf8'),
	ignore,
	'a second install does not duplicate ignore lines'
);
assert.equal(hooksInstalled(bare), true, 'the installed workspace passes the check');
assert.deepEqual(
	fs.readdirSync(path.join(bare, '.cursor')).sort(),
	['hooks', 'hooks.json'],
	'installing adds hooks only: no personas, roles or role map are seeded into the project'
);

const wiring = JSON.parse(fs.readFileSync(path.join(bare, '.cursor', 'hooks.json'), 'utf8'));
assert.ok(
	wiring.hooks.beforeSubmitPrompt.some((entry) => entry.command.endsWith('resolve-persona-context.mjs')),
	'every prompt re-injects the persona identity'
);
const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-hook-runtime-'));
execFileSync('node', [path.join(bare, '.cursor', 'hooks', 'log-agent-event.mjs')], {
	cwd: bare,
	env: { ...process.env, CURSOR_AGENT_VIZ_HOME: runtimeHome },
	input: JSON.stringify({
		hook_event_name: 'afterAgentResponse',
		conversation_id: 'windows-safe-chat',
		input_tokens: 42,
	}),
});
assert.match(
	fs.readFileSync(path.join(runtimeHome, workspaceSlug(bare), 'events.jsonl'), 'utf8'),
	/"input_tokens":42/,
	'the Node hook logs usage without bash, jq, or platform-specific commands'
);
fs.rmSync(runtimeHome, { recursive: true, force: true });
fs.rmSync(path.join(bare, '.cursor', 'hooks', 'update-agent-state.mjs'));
assert.equal(checkHooks(bare).ready, false, 'one missing helper makes an otherwise wired installation incomplete');
installHooks(bare, extensionPath);
const incomplete = JSON.parse(fs.readFileSync(path.join(bare, '.cursor', 'hooks.json'), 'utf8'));
incomplete.hooks.subagentStart = [];
fs.writeFileSync(path.join(bare, '.cursor', 'hooks.json'), JSON.stringify(incomplete));
assert.ok(
	checkHooks(bare).missing.some((entry) => entry.startsWith('subagentStart →')),
	'missing event wiring is named for repair'
);
fs.writeFileSync(
	path.join(bare, '.cursor', 'hooks.json'),
	JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: './mine.sh' }] } })
);
installHooks(bare, extensionPath);
const merged = JSON.parse(fs.readFileSync(path.join(bare, '.cursor', 'hooks.json'), 'utf8'));
assert.ok(
	merged.hooks.sessionStart.some((entry) => entry.command === './mine.sh'),
	'installing keeps hooks the project already had'
);

// Uninstalling has to leave the workspace as the project had it, not as the board found it.
uninstallHooks(bare);
assert.equal(hooksInstalled(bare), false, 'uninstall removes the wiring the board added');
assert.equal(fs.existsSync(path.join(bare, '.cursor', 'hooks')), false, 'no empty hooks folder is left behind');
const afterRemove = JSON.parse(fs.readFileSync(path.join(bare, '.cursor', 'hooks.json'), 'utf8'));
assert.deepEqual(
	afterRemove.hooks,
	{ sessionStart: [{ command: './mine.sh' }] },
	'a hook the project wired itself survives uninstall'
);

assert.equal(
	fs.existsSync(path.join(bare, '.gitignore')),
	false,
	'uninstall removes a gitignore that only held the ignore lines we added'
);

fs.writeFileSync(path.join(bare, '.gitignore'), 'dist/\n');
installHooks(bare, extensionPath);
assert.match(
	fs.readFileSync(path.join(bare, '.gitignore'), 'utf8'),
	/^dist\/\n/,
	'install appends ignore lines and keeps what the project already had'
);
fs.writeFileSync(
	path.join(bare, '.cursor', 'hooks.json'),
	JSON.stringify({
		version: 1,
		hooks: { sessionStart: [{ command: 'node .cursor/hooks/log-agent-event.mjs' }] },
	})
);
uninstallHooks(bare);
assert.equal(
	fs.existsSync(path.join(bare, '.cursor', 'hooks.json')),
	false,
	'a hooks.json holding only our commands is removed outright'
);
assert.equal(
	fs.readFileSync(path.join(bare, '.gitignore'), 'utf8'),
	'dist/\n',
	'uninstall strips our ignore lines and leaves the rest'
);

const ownSource = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-hook-src-'));
const ownHooks = path.join(ownSource, '.cursor', 'hooks');
fs.mkdirSync(ownHooks, { recursive: true });
const realHooks = path.join(extensionPath, '..', '.cursor', 'hooks');
for (const name of fs.readdirSync(realHooks)) {
	fs.copyFileSync(path.join(realHooks, name), path.join(ownHooks, name));
}
installHooks(ownSource, path.join(ownSource, 'extension'));
assert.equal(
	fs.existsSync(path.join(ownSource, '.gitignore')),
	false,
	'installing into the bundled hook source does not gitignore the files the extension ships'
);
fs.rmSync(ownSource, { recursive: true, force: true });
fs.rmSync(bare, { recursive: true, force: true });

// Cursor runs hooks through the environment it was launched with, and a Start-menu or Dock launch
// often has no `node` on it at all. The interpreter is resolved at install time so the wiring works
// there, and a workspace pinned to an absolute path still has to read as installed, not as broken.
const pinned = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-pinned-'));
installHooks(pinned, extensionPath);
const wiredWith = JSON.parse(fs.readFileSync(path.join(pinned, '.cursor', 'hooks.json'), 'utf8'));
const started = wiredWith.hooks.sessionStart.map((entry) => entry.command);
assert.ok(
	started.some((command) => command.endsWith('.cursor/hooks/log-agent-event.mjs')),
	'the wiring still names the script, whatever interpreter was resolved for it'
);
assert.equal(
	resolveNodeCommand(),
	'node',
	'a host that can already run `node` keeps the portable wiring instead of pinning a path'
);
const custom = { command: '"C:\\Program Files\\nodejs\\node.exe" .cursor/hooks/log-agent-event.mjs' };
fs.writeFileSync(
	path.join(pinned, '.cursor', 'hooks.json'),
	JSON.stringify({ version: 1, hooks: { ...wiredWith.hooks, sessionEnd: [custom] } })
);
assert.equal(
	checkHooks(pinned).ready,
	true,
	'a hook pinned to an absolute node path is installed, not missing: repair must not loop on it'
);
uninstallHooks(pinned);
assert.equal(
	fs.existsSync(path.join(pinned, '.cursor', 'hooks.json')),
	false,
	'and uninstall removes a pinned command too, rather than leaving it behind'
);
fs.rmSync(pinned, { recursive: true, force: true });

// `extension/hooks/` is what ships and `.cursor/hooks/` is what this repo runs, and nothing at
// package time copies one to the other: a fix landing in only one tree ships or tests the old hook.
for (const name of ['log-agent-event.mjs', 'update-agent-state.mjs', 'resolve-persona-context.mjs']) {
	assert.equal(
		fs.readFileSync(path.join(extensionPath, 'hooks', name), 'utf8'),
		fs.readFileSync(path.join(extensionPath, '..', '.cursor', 'hooks', name), 'utf8'),
		`extension/hooks/${name} has drifted from .cursor/hooks/${name}: copy the source over before shipping`
	);
}

console.log('hooks-install checks passed');
