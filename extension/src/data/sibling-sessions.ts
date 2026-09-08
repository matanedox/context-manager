import type { Role } from '../model/roles';
import type { SessionState } from '../model/types';

export type SiblingNote = {
	conversationId: string;
	fromConversationId: string;
	text: string;
};

/**
 * Brief for a chat opened to replace one that filled up. The board only ever saw that session's
 * hook log, so the note says what it touched and leaves the intent to the user rather than
 * inventing a summary of a conversation it cannot read.
 */
export function continuationNote(input: {
	personaLabel: string;
	previousIndex?: number;
	reading?: string;
	files: string[];
	toolCalls: number;
	/** "full": the other chat hit its cap. "sibling": it is still open beside this one. */
	kind: 'full' | 'sibling';
	/** Written by the previous chat when auto-continue asked it to recap. */
	recap?: string;
}): string {
	const from = input.previousIndex
		? `${input.personaLabel} session ${input.previousIndex}`
		: `the previous ${input.personaLabel} session`;
	const reading = input.reading ? ` (context ${input.reading})` : '';
	const parts = [
		input.kind === 'full'
			? `You are continuing ${from}, which reached its token budget${reading}.`
			: `You are a second chat for ${input.personaLabel}, opened beside ${from}${reading}, which stays open.`,
		`It ran ${input.toolCalls} tool ${input.toolCalls === 1 ? 'call' : 'calls'}${
			input.files.length ? ` and worked in: ${input.files.join(', ')}` : ''
		}.`,
	];
	if (input.recap?.trim()) {
		parts.push(`Its recap: ${input.recap.trim()}`);
	} else {
		parts.push(
			'That activity log is all the board carried over, not the conversation, so confirm the goal and what is left with the user before you change anything.'
		);
	}
	return parts.join(' ');
}

/**
 * Notes for every other open chat of this persona when a sibling session binds. Nobody is woken to
 * hear them: "another session opened" is an aside, and a resume made the old chat take a turn and
 * pull Cursor's focus off the session the user had just asked for. They ride the neighbour's next
 * turn instead, which is the first moment it matters there.
 */
export function planSiblingNotes(
	sessions: SessionState[],
	newConversationId: string,
	role: Role,
	personaLabel: string
): SiblingNote[] {
	const created = sessions.find((session) => session.conversationId === newConversationId);
	const index = created?.instanceIndex;
	const siblings = sessions.filter(
		(session) =>
			session.conversationId !== newConversationId && session.role === role && session.status !== 'closed'
	);
	if (!siblings.length || !index) return [];
	const newLabel = `${personaLabel} · ${index}`;
	return siblings.map((session) => ({
		conversationId: session.conversationId,
		fromConversationId: newConversationId,
		text: `Another ${personaLabel} session opened (${newLabel}).`,
	}));
}
