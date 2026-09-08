import type { Role } from './roles';
import type { SessionState } from './types';

type Indexed = Pick<SessionState, 'conversationId' | 'role' | 'status' | 'instanceIndex'>;

/**
 * Give every chat of this persona a sticky ordinal, newest last. Chats that predate the ordinal
 * (or that the board never started) have none, and numbering only the new one made a second
 * session call itself "1" while the first showed no number at all.
 */
export function assignInstanceIndexes(sessions: Indexed[], role: Role): void {
	let max = 0;
	for (const session of sessions) {
		if (session.role === role && (session.instanceIndex ?? 0) > max) {
			max = session.instanceIndex ?? 0;
		}
	}
	for (const session of sessions) {
		if (session.role !== role || session.instanceIndex != null) continue;
		session.instanceIndex = ++max;
	}
}

/** Show ·N when this chat is not the only open one, or its index is already past 1. */
export function showSessionInstance(session: Indexed, sessions: Indexed[]): boolean {
	const n = session.instanceIndex;
	if (!n || !session.role) return false;
	if (n > 1) return true;
	return sessions.some(
		(other) =>
			other.conversationId !== session.conversationId && other.role === session.role && other.status !== 'closed'
	);
}

/** Open chats already wearing this persona, so a repeat click can ask before opening another. */
export function openSessionsForRole(sessions: Indexed[], role: Role): Indexed[] {
	return sessions.filter((session) => session.role === role && session.status !== 'closed');
}
