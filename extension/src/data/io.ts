import * as fs from 'fs';
import * as path from 'path';
import { isRole } from '../model/roles';
import { assignInstanceIndexes } from '../model/session-label';
import { parseTokenBudget } from '../model/token-budget';
import { runtimeFile } from './runtime-dir';
import type { PersistedState, Role } from '../model/types';

/** The workspace file is the only mapping; the extension never seeds one. */
export function readRoleMap(filePath: string): Record<string, string> {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, string>;
	} catch {
		return {};
	}
}

export function readPersistedState(root: string | undefined): PersistedState {
	if (!root) return {};
	try {
		return JSON.parse(fs.readFileSync(runtimeFile(root, 'current-state.json'), 'utf8')) as PersistedState;
	} catch {
		return {};
	}
}

/**
 * A click Cursor never turned into a session must not wedge the board on "Starting…" or get
 * claimed by an unrelated chat minutes later, so an unclaimed role expires.
 */
export const PENDING_ROLE_TTL_MS = 90_000;

export function readPendingRole(root: string | undefined, now = Date.now()): Role | null {
	if (!root) return null;
	const file = runtimeFile(root, 'pending-role.json');
	try {
		const pending = JSON.parse(fs.readFileSync(file, 'utf8')) as {
			role?: string;
			createdAt?: string;
		};
		if (!isRole(pending.role)) return null;
		const createdAt = Date.parse(pending.createdAt ?? '');
		if (!Number.isNaN(createdAt) && now - createdAt > PENDING_ROLE_TTL_MS) {
			fs.rmSync(file, { force: true });
			return null;
		}
		return pending.role;
	} catch {
		return null;
	}
}

/** The next sessionStart after this event offset claims the role exactly once. */
export function writePendingRole(root: string | undefined, role: Role, afterEventCount: number): void {
	if (!root) return;
	const file = runtimeFile(root, 'pending-role.json');
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify({ role, afterEventCount, createdAt: new Date().toISOString() }, null, 2));
	} catch {
		/* opening chat still works if assignment persistence fails */
	}
}

export function clearPendingRole(root: string | undefined): void {
	if (!root) return;
	try {
		fs.rmSync(runtimeFile(root, 'pending-role.json'), { force: true });
	} catch {
		/* the TTL clears it on the next read */
	}
}

/**
 * The board saw Cursor create this chat, so it records the session itself rather than waiting
 * for a sessionStart hook that may never arrive. The clicked role rides along on the event: the
 * event log is the one store neither the hook reducer nor a missing state file can undo.
 */
export function appendSessionStart(root: string | undefined, conversationId: string, role: Role): void {
	if (!root) return;
	const file = runtimeFile(root, 'events.jsonl');
	const event = {
		ts: new Date().toISOString(),
		type: 'sessionStart',
		raw: {
			hook_event_name: 'sessionStart',
			conversation_id: conversationId,
			reason: 'board_click',
			role,
		},
	};
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, `${JSON.stringify(event)}\n`);
}

export function writePersistedState(root: string, state: PersistedState): void {
	const file = runtimeFile(root, 'current-state.json');
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

/** What the user set on a chat, as opposed to what the log says about it. */
export type SessionSettings = {
	contextLimitTokens?: number;
	autoContinueOnLimit?: boolean;
	/** Replacement conversation id, or `"pending"` while that chat is still opening. */
	autoContinuedTo?: string;
};

/**
 * These live apart from current-state.json because the hook owns that file: it rebuilds every row
 * from the event log on every event and writes the whole thing back. It carried these fields
 * forward, but its read and its write sit a full rebuild apart, so a click that landed in between
 * was overwritten — ticking Auto and then sending a message lost the tick. Nothing but the
 * extension writes this file, so there is no window to lose it in.
 */
export function readSessionSettings(root: string | undefined): Record<string, SessionSettings> {
	if (!root) return {};
	try {
		return JSON.parse(fs.readFileSync(runtimeFile(root, 'session-settings.json'), 'utf8')) as Record<
			string,
			SessionSettings
		>;
	} catch {
		return {};
	}
}

/**
 * The cap in force for a chat. Boards written before the settings file still carry theirs in the
 * state file, so a limit set back then keeps working instead of reading as "no cap set".
 */
export function sessionContextLimit(root: string | undefined, conversationId: string): number | undefined {
	const stored = readSessionSettings(root)[conversationId]?.contextLimitTokens;
	if (stored != null) return stored;
	return readPersistedState(root).sessions?.find((row) => row.conversationId === conversationId)?.contextLimitTokens;
}

export function patchSessionSettings(
	root: string | undefined,
	conversationId: string,
	patch: (settings: SessionSettings) => void
): boolean {
	if (!root || !conversationId) return false;
	try {
		const all = readSessionSettings(root);
		const settings = { ...all[conversationId] };
		patch(settings);
		const file = runtimeFile(root, 'session-settings.json');
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const next = { ...all, [conversationId]: settings };
		if (!Object.keys(settings).length) delete next[conversationId];
		fs.writeFileSync(file, JSON.stringify(next, null, 2));
		return true;
	} catch {
		return false;
	}
}

/** Persist the clicked persona before revealing its chat, so prompt hooks can resolve identity. */
export function bindSessionRole(root: string | undefined, conversationId: string, role: Role): boolean {
	if (!root) return false;
	try {
		const state = readPersistedState(root);
		const sessions = Array.isArray(state.sessions) ? [...state.sessions] : [];
		const existing = sessions.find((session) => session.conversationId === conversationId);
		if (existing) existing.role = role;
		else {
			sessions.push({
				conversationId,
				role,
				status: 'idle',
				highlighted: true,
				lastEventAt: new Date().toISOString(),
				subagents: [],
			});
		}
		// The new row is last, so it takes the highest number and the older chats keep theirs.
		assignInstanceIndexes(sessions, role);
		writePersistedState(root, { ...state, sessions, pendingRole: null });
		return true;
	} catch {
		return false;
	}
}

/** Store a per-session awareness cap in tokens; `undefined` clears it. Does not touch the event log. */
export function setSessionContextLimit(
	root: string | undefined,
	conversationId: string,
	tokens: number | undefined
): boolean {
	return patchSessionSettings(root, conversationId, (settings) => {
		if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) {
			delete settings.contextLimitTokens;
			delete settings.autoContinueOnLimit;
		} else {
			settings.contextLimitTokens = Math.floor(tokens);
		}
	});
}

/**
 * The budget field, in either unit (`80k`, `5M`). Cursor reports `input_tokens` per turn summed
 * over every request that turn made, so the reading is spend and not window occupancy — which is
 * why a bare number reads as millions. Empty string clears the budget.
 */
export function setSessionContextLimitField(root: string | undefined, conversationId: string, value: string): boolean {
	if (value.trim() === '') return setSessionContextLimit(root, conversationId, undefined);
	const tokens = parseTokenBudget(value);
	if (tokens == null) return false;
	return setSessionContextLimit(root, conversationId, tokens);
}

export function loadEvents(root: string | undefined, extensionPath: string): { text: string; usingDemo: boolean } {
	const live = root ? runtimeFile(root, 'events.jsonl') : '';
	// A log that exists but is empty is an empty board, not a board with nothing to show: reading it
	// as the latter put the bundled demo rows in the rail the moment a workspace closed its last chat.
	if (live && fs.existsSync(live)) {
		return { text: fs.readFileSync(live, 'utf8').trim(), usingDemo: false };
	}
	const seed = path.join(extensionPath, 'demo', 'demo-events.jsonl');
	return { text: fs.existsSync(seed) ? fs.readFileSync(seed, 'utf8') : '', usingDemo: true };
}

/** User-owned, so it stays in the workspace where it can be committed and shared. */
export function roleMapPath(root: string | undefined): string {
	return root ? path.join(root, '.cursor', 'agent-viz', 'role-map.json') : '';
}
