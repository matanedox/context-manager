/** Pure board state: no vscode or fs imports, so it can be exercised directly by node. */

import { eventType, groupByConversation, orderSessions, subagentType } from './events';
import { isRole, mapRole } from './roles';
import { assignInstanceIndexes } from './session-label';
import type { HookEvent, LiveEdge, PersistedState, Role, SessionState } from './types';

/** Sessions replayed from the log: roles come from board clicks recorded on sessionStart. */
export function deriveDemoSessions(events: HookEvent[], roleMap: Record<string, string>): SessionState[] {
	const sessions = new Map<string, SessionState>();
	for (const event of events) {
		const conversationId = event.raw?.conversation_id;
		if (!conversationId) continue;
		let session = sessions.get(conversationId);
		if (!session) {
			session = {
				conversationId,
				role: null,
				status: 'idle',
				highlighted: false,
				subagents: [],
			};
			sessions.set(conversationId, session);
		}
		session.lastEventAt = event.ts ?? session.lastEventAt;
		const claimed = event.raw?.role;
		if (isRole(claimed)) session.role = claimed;
		const kind = eventType(event);
		if (kind === 'beforeSubmitPrompt') session.status = 'working';
		if (kind === 'postToolUseFailure') session.status = 'failed';
		// A failure the agent recovered from is not the chat's state: the next tool that succeeds puts
		// the row back to working, and only an unrecovered one survives the turn. Without both halves
		// a retried Read hid the working pulse for the rest of the turn, then the turn end wiped the
		// failure that actually stopped the agent.
		if (kind === 'postToolUse' && session.status === 'failed') session.status = 'working';
		if (kind === 'afterAgentResponse' && session.status !== 'failed') session.status = 'idle';
		if (kind === 'sessionEnd') session.status = 'closed';
		const type = subagentType(event);
		const role = mapRole(type, roleMap);
		if (!type || !role) continue;
		let child = session.subagents.find((item) => item.type === type);
		if (!child) {
			child = { type, role, status: 'stopped' };
			session.subagents.push(child);
		}
		if (kind === 'subagentStart') child.status = 'working';
		if (kind === 'subagentStop' || kind === 'sessionEnd') child.status = 'stopped';
	}
	return [...sessions.values()];
}

export function boardState(
	events: HookEvent[],
	roleMap: Record<string, string>,
	persisted: PersistedState,
	usingDemo: boolean
) {
	const replayed = deriveDemoSessions(events, roleMap);
	const replayedById = new Map(replayed.map((session) => [session.conversationId, session]));
	// A role clicked on the board is recorded in the log, so it outranks whatever the hook
	// reducer last computed for that chat.
	const clicked = new Map<string, Role>();
	for (const event of events) {
		const id = event.raw?.conversation_id;
		const role = event.raw?.role;
		if (id && isRole(role)) clicked.set(id, role);
	}
	const sessions =
		!usingDemo && persisted.sessions
			? persisted.sessions.map((session) => {
					const role = clicked.get(session.conversationId) ?? session.role;
					const current = replayedById.get(session.conversationId);
					if (!current) return { ...session, role };
					const childStatus = new Map(current.subagents.map((child) => [child.type, child.status]));
					return {
						...session,
						role,
						status: current.status,
						lastEventAt: current.lastEventAt ?? session.lastEventAt,
						subagents: session.subagents.map((child) => ({
							...child,
							status: childStatus.get(child.type) ?? child.status,
						})),
					};
				})
			: replayed;
	// The hook reducer rewrites the state file, and a workspace running an older installed copy of
	// it drops the stored ordinal, which left two chats of one persona both unnumbered. Numbering is
	// recomputed here from the file's own order — creation order — so stored numbers still win.
	for (const role of new Set(sessions.map((session) => session.role))) {
		if (role) assignInstanceIndexes(sessions, role);
	}
	const pendingRole = !usingDemo ? (persisted.pendingRole ?? null) : null;
	const working = new Set<Role>();
	const focused = new Set<Role>();
	const liveEdges = new Map<string, LiveEdge>();

	if (pendingRole) focused.add(pendingRole);
	for (const session of sessions) {
		if (session.role && session.highlighted) focused.add(session.role);
		if (session.role && session.status === 'working') {
			working.add(session.role);
			focused.add(session.role);
		}
		for (const child of session.subagents) {
			if (child.status !== 'working') continue;
			working.add(child.role);
			focused.add(child.role);
			if (!session.role) continue;
			const edge = { from: session.role, to: child.role, label: child.type };
			liveEdges.set(`${edge.from}:${edge.to}:${edge.label}`, edge);
		}
	}

	const eventsByConversation = groupByConversation(events);
	return {
		active: pendingRole ?? [...focused][0] ?? null,
		working: [...working],
		focused: [...focused],
		pendingRole,
		sessions: orderSessions(sessions, eventsByConversation),
		liveEdges: [...liveEdges.values()],
		eventsByConversation,
	};
}

export type BoardState = ReturnType<typeof boardState>;
