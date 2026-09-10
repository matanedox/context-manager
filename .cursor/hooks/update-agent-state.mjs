#!/usr/bin/env node
/** Recompute conversation-scoped scrum state from hook events. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'node:url';

/**
 * Mirrors extension/src/data/runtime-dir.ts: session state lives outside the workspace so a repo
 * gains no untracked board files. Flattened path, not a hash, so both copies derive one name.
 */
export function runtimeDir(cwd = process.cwd()) {
	const home = process.env.CURSOR_AGENT_VIZ_HOME || path.join(os.homedir(), '.cursor', 'agent-viz');
	let real = cwd;
	try {
		real = fs.realpathSync(cwd);
	} catch {
		/* a path we cannot resolve is used as given */
	}
	const slug = real
		.replaceAll('\\', '/')
		.replace(/\/+$/, '')
		.replace(/^\/+/, '')
		.replaceAll(':', '_')
		.replaceAll('/', '_');
	return path.join(home, slug);
}

const DIR = runtimeDir();
const EVENTS_PATH = path.join(DIR, 'events.jsonl');
const STATE_PATH = path.join(DIR, 'current-state.json');
const PENDING_PATH = path.join(DIR, 'pending-role.json');
/** The only role map: user-owned, in the workspace. The extension never seeds one. */
const ROLE_MAP_PATH = path.join('.cursor', 'agent-viz', 'role-map.json');

/** No project roster is ever assumed, so an unknown persona is the board's own guide. */
export const DEFAULT_PERSONA = 'guide';

/** The one title the extension ships. Project personas take theirs from files, not this map. */
export const PERSONA_TITLES = {
	guide: 'Extension Assistant — onboarding and support for the Context Manager extension',
};

export function isRoleId(value) {
	return typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
}

/**
 * The one place a hook reads its Cursor payload. Windows pipes it through PowerShell, which
 * prefixes a UTF-8 BOM that `JSON.parse` rejects at position 0 — every hook here parses, so the
 * strip belongs with the read rather than at each of the three call sites.
 */
export function readStdin() {
	try {
		return fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '');
	} catch {
		return '';
	}
}

export function readText(file) {
	try {
		return fs.readFileSync(file, 'utf8');
	} catch {
		return '';
	}
}

/** One title per persona for the board card and the injected identity, so the two cannot disagree. */
export function personaTitle(id) {
	for (const ext of ['.md', '.mdc']) {
		const file = path.join('.cursor', 'personas', `${id}${ext}`);
		if (!fs.existsSync(file)) continue;
		const block = readText(file).match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? '';
		const title = block.match(/^title:\s*(.+)$/m)?.[1]?.trim();
		const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim();
		if (title && description) return `${title} — ${description}`;
		if (title) return title;
	}
	// Most projects list every role in one charter file instead of a file per role.
	const dir = path.join('.cursor', 'personas');
	const lines = fs.existsSync(dir)
		? fs.readdirSync(dir).flatMap((name) => readText(path.join(dir, name)).split('\n'))
		: [];
	const bullet = new RegExp(`^\\s*[-*]\\s+\`?${id}\`?[\\s—–:-]+(.+)$`, 'i');
	const desc = lines.map((line) => line.match(bullet)?.[1]?.trim()).find(Boolean);
	return desc ? `${id} — ${desc.replace(/\.$/, '')}` : (PERSONA_TITLES[id] ?? id);
}

function eventType(event) {
	if (event.type && event.type !== 'unknown') return event.type;
	return event.raw?.hook_event_name ?? 'unknown';
}

function subagentType(event) {
	return event.raw?.subagentType ?? event.raw?.subagent_type;
}

export function readJson(file, fallback) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
}

function readEvents() {
	if (!fs.existsSync(EVENTS_PATH)) return [];
	return fs
		.readFileSync(EVENTS_PATH, 'utf8')
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch {
				return {};
			}
		});
}

function readRoleMap() {
	return readJson(ROLE_MAP_PATH, {});
}

export function mapRole(type, roleMap) {
	const role = roleMap[type] ?? type;
	return isRoleId(role) ? role : DEFAULT_PERSONA;
}

function previousSessions() {
	const rows = readJson(STATE_PATH, {}).sessions;
	const sessions = Array.isArray(rows) ? rows : [];
	return {
		assignments: new Map(
			sessions
				.filter((session) => session.conversationId && isRoleId(session.role))
				.map((session) => [
					session.conversationId,
					{ role: session.role, highlighted: Boolean(session.highlighted) },
				])
		),
		extras: new Map(
			sessions
				.filter((session) => session.conversationId)
				.map((session) => [
					session.conversationId,
					{
						instanceIndex: session.instanceIndex,
						contextLimitTokens: session.contextLimitTokens,
						autoContinueOnLimit: session.autoContinueOnLimit,
						autoContinuedTo: session.autoContinuedTo,
					},
				])
		),
		// Chats the board has already seen, assigned or not: only a brand new chat may take a click.
		known: new Set(sessions.map((session) => session.conversationId).filter(Boolean)),
	};
}

function applyExtras(session, extras) {
	const extra = extras.get(session.conversationId);
	if (!extra) return;
	if (Number.isInteger(extra.instanceIndex) && extra.instanceIndex > 0) {
		session.instanceIndex = extra.instanceIndex;
	}
	if (Number.isInteger(extra.contextLimitTokens) && extra.contextLimitTokens > 0) {
		session.contextLimitTokens = extra.contextLimitTokens;
	}
	if (extra.autoContinueOnLimit === true) session.autoContinueOnLimit = true;
	if (typeof extra.autoContinuedTo === 'string' && extra.autoContinuedTo) {
		session.autoContinuedTo = extra.autoContinuedTo;
	}
}

/** Matches the extension's TTL: a click Cursor never turned into a session expires unclaimed. */
const PENDING_TTL_MS = 90_000;

function readPending() {
	const pending = readJson(PENDING_PATH, null);
	const createdAt = Date.parse(pending?.createdAt ?? '');
	if (!Number.isNaN(createdAt) && Date.now() - createdAt > PENDING_TTL_MS) {
		fs.rmSync(PENDING_PATH, { force: true });
		return null;
	}
	return pending &&
		isRoleId(pending.role) &&
		Number.isInteger(pending.afterEventCount) &&
		pending.afterEventCount >= 0
		? pending
		: null;
}

export function reduceSessions(events, roleMap, assignments, pending, known = new Set(), extras = new Map()) {
	const sessions = new Map();
	let claimedPending = false;
	let awaitingSubagentSession = null;
	const subagentConversations = {};

	function getSession(conversationId, index, canClaimPending) {
		const id = conversationId || 'unknown';
		const existing = sessions.get(id);
		if (existing) return existing;

		let assignment = assignments.get(id);
		if (
			!assignment &&
			!known.has(id) &&
			pending &&
			!claimedPending &&
			canClaimPending &&
			index >= pending.afterEventCount
		) {
			assignment = { role: pending.role, highlighted: true };
			assignments.set(id, assignment);
			claimedPending = true;
		}
		const session = {
			conversationId: id,
			// A chat nobody assigned belongs to no persona; inventing one made every stray chat
			// outrank the pending click.
			role: assignment?.role ?? null,
			status: 'idle',
			highlighted: assignment?.highlighted ?? false,
			startedAt: null,
			lastEventAt: null,
			subagents: [],
		};
		applyExtras(session, extras);
		sessions.set(id, session);
		return session;
	}

	events.forEach((event, index) => {
		const kind = eventType(event);
		const conversationId = event.raw?.conversation_id;
		const parentConversationId = event.raw?.parent_conversation_id;
		const sessionConversationId =
			kind === 'subagentStart' || kind === 'subagentStop'
				? parentConversationId || conversationId
				: conversationId;
		if (!sessionConversationId) return;
		// Only a brand new session may claim a clicked role. Letting a prompt claim it let whichever
		// chat the user typed in next steal the role, which is how personas ended up on the wrong chat.
		const session = getSession(sessionConversationId, index, kind === 'sessionStart');
		session.lastEventAt = event.ts ?? session.lastEventAt;
		// The board records the clicked role on the session's own event, which outranks both the
		// previous state file and the pending click.
		if (isRoleId(event.raw?.role)) {
			session.role = event.raw.role;
			assignments.set(session.conversationId, { role: session.role, highlighted: true });
		}
		if (kind === 'sessionStart') {
			session.startedAt = event.ts ?? session.startedAt;
			session.status = 'idle';
			if (
				awaitingSubagentSession &&
				conversationId &&
				conversationId !== awaitingSubagentSession.parentConversationId
			) {
				subagentConversations[conversationId] = { ...awaitingSubagentSession, status: 'working' };
				awaitingSubagentSession = null;
			}
		} else if (kind === 'beforeSubmitPrompt') {
			session.status = 'working';
		} else if (kind === 'postToolUseFailure') {
			session.status = 'failed';
		} else if (kind === 'afterAgentResponse') {
			session.status = 'idle';
			session.highlighted = false;
		} else if (kind === 'sessionEnd') {
			session.status = 'closed';
			session.highlighted = false;
			for (const child of session.subagents) child.status = 'stopped';
		}

		const type = subagentType(event);
		if (!type) return;
		let child = session.subagents.find((item) => item.type === type);
		if (!child) {
			child = { type, role: mapRole(type, roleMap), status: 'stopped' };
			session.subagents.push(child);
		}
		if (kind === 'subagentStart') {
			child.status = 'working';
			awaitingSubagentSession = {
				subagentId: event.raw?.subagent_id ?? null,
				type,
				role: child.role,
				parentConversationId: sessionConversationId,
				status: 'working',
			};
		}
		if (kind === 'subagentStop') {
			child.status = 'stopped';
			awaitingSubagentSession = null;
			for (const [subId, run] of Object.entries(subagentConversations)) {
				if (run.type === type && run.parentConversationId === sessionConversationId) {
					subagentConversations[subId] = { ...run, status: 'stopped' };
				}
			}
		}
	});

	return { sessions: [...sessions.values()], claimedPending, subagentConversations };
}

/**
 * Keep every live session plus the most recent closed ones. Without this the state file grows
 * without bound and the board renders a tab per long-dead conversation.
 */
export function pruneSessions(sessions, closedCap = 8) {
	const open = sessions.filter((session) => session.status !== 'closed');
	const closed = sessions
		.filter((session) => session.status === 'closed')
		.sort((a, b) => String(b.lastEventAt ?? '').localeCompare(String(a.lastEventAt ?? '')))
		.slice(0, closedCap);
	return [...open, ...closed];
}

/** Recompute current-state.json from the event log. */
export function refreshState() {
	fs.mkdirSync(DIR, { recursive: true });
	const events = readEvents();
	const roleMap = readRoleMap();
	const { assignments, known, extras } = previousSessions();
	const pending = readPending();
	const reduced = reduceSessions(events, roleMap, assignments, pending, known, extras);
	const claimedPending = reduced.claimedPending;
	const sessions = pruneSessions(reduced.sessions);
	const previous = readJson(STATE_PATH, {});
	const subagentConversations = { ...reduced.subagentConversations };
	if (claimedPending) fs.rmSync(PENDING_PATH, { force: true });

	const lastEvent = events[events.length - 1];
	const lastConversationId = lastEvent?.raw?.conversation_id;
	const current = sessions.find((session) => session.conversationId === lastConversationId);
	const lastSubagent = subagentType(lastEvent);
	const child = lastSubagent ? current?.subagents.find((item) => item.type === lastSubagent) : undefined;
	const active = child?.role ?? current?.role ?? pending?.role ?? DEFAULT_PERSONA;
	const activeTitle = personaTitle(active);
	const liveEdges = sessions.flatMap((session) =>
		session.role
			? session.subagents
					.filter((item) => item.status === 'working')
					.map((item) => ({ from: session.role, to: item.role, label: item.type }))
			: []
	);
	const openSessions = sessions.filter((session) => session.status !== 'closed');

	const state = {
		updatedAt: new Date().toISOString(),
		activePersona: active,
		activePersonaTitle: activeTitle,
		activeSubagent: child?.status === 'working' ? child.type : null,
		workingWith: liveEdges[0] ? `${liveEdges[0].from} → ${liveEdges[0].to} (${liveEdges[0].label})` : null,
		source: 'live',
		pendingRole: claimedPending ? null : (pending?.role ?? null),
		subagentConversations,
		sessions,
		liveEdges,
		lastEvent: lastEvent
			? {
					ts: lastEvent.ts,
					type: eventType(lastEvent),
					tool: lastEvent.raw?.tool_name ?? null,
					conversationId: lastConversationId ?? null,
				}
			: null,
		conversationId: lastConversationId ?? null,
		sessionSummary: `${openSessions.length} open session${openSessions.length === 1 ? '' : 's'}; ${active} is the current persona. Role: ${activeTitle}`,
	};

	fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/** The log hook pipes one trimmed event in, so the shell side needs no copy of the log path. */
function appendPipedEvent() {
	if (process.stdin.isTTY) return;
	const line = readStdin().trim();
	if (!line) return;
	fs.mkdirSync(DIR, { recursive: true });
	fs.appendFileSync(EVENTS_PATH, `${line}\n`);
}

/** argv and import.meta.url disagree on Windows drive-letter case; URL compare is the portable check. */
export function isDirectRun(metaUrl) {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		const href = pathToFileURL(path.resolve(entry)).href;
		return process.platform === 'win32' ? href.toLowerCase() === metaUrl.toLowerCase() : href === metaUrl;
	} catch {
		return false;
	}
}

if (isDirectRun(import.meta.url)) {
	appendPipedEvent();
	refreshState();
}
