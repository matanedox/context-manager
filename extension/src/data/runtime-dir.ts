/**
 * Where the board keeps throwaway session state. Outside the workspace on purpose: a repo should
 * gain no untracked board files, so there is nothing to gitignore and nothing to leave behind.
 * `.cursor/agent-viz/` in the workspace stays for files the user owns (role-map.json, personas.json).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Runtime files a session leaves behind; user-owned files under `.cursor/agent-viz/` are not here. */
export const RUNTIME_FILES = [
	'events.jsonl',
	'current-state.json',
	'session-settings.json',
	'pending-role.json',
	'context-handoffs.jsonl',
];

/** Overridable so tests can redirect the whole tree instead of touching a real home directory. */
export function runtimeHome(): string {
	return process.env.CURSOR_AGENT_VIZ_HOME || path.join(os.homedir(), '.cursor', 'agent-viz');
}

/**
 * One directory per workspace, named after its path with separators flattened rather than hashed:
 * the hook scripts must derive the identical name in plain node, and two hash implementations
 * would drift into two state directories for one workspace. Resolved through symlinks for the
 * same reason — hooks see the physical cwd, so a linked workspace must not split in two.
 */
export function workspaceSlug(root: string): string {
	return realPath(root)
		.replaceAll('\\', '/')
		.replace(/\/+$/, '')
		.replace(/^\/+/, '')
		.replaceAll(':', '_')
		.replaceAll('/', '_');
}

function realPath(root: string): string {
	try {
		return fs.realpathSync(root);
	} catch {
		return root;
	}
}

export function runtimeDir(root: string): string {
	return path.join(runtimeHome(), workspaceSlug(root));
}

export function runtimeFile(root: string, name: string): string {
	return path.join(runtimeDir(root), name);
}
