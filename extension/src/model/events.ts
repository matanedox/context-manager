import type { HookEvent, SessionState } from './types';

export function eventType(ev: HookEvent): string {
	if (ev.type && ev.type !== 'unknown') return ev.type;
	return ev.raw?.hook_event_name ?? 'unknown';
}

export function subagentType(ev: HookEvent): string | undefined {
	return ev.raw?.subagentType ?? ev.raw?.subagent_type;
}

export function parseLines(text: string): HookEvent[] {
	return text
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line) as HookEvent;
			} catch {
				return {};
			}
		});
}

/**
 * One bucket per chat, keyed on the chat itself: no session ever counts another's events.
 *
 * Everything that chat logged is kept. This used to keep only the tail, which was harmless while
 * the meter showed one turn, but the reading now sums every turn — so trimming here dropped the
 * early ones and a busy session under-reported its own spend, the total falling as it got busier.
 * The activity log trims its own copy, which is what the cap was protecting.
 */
export function groupByConversation(events: HookEvent[]): Map<string, HookEvent[]> {
	const grouped = new Map<string, HookEvent[]>();
	for (const event of events) {
		const id = event.raw?.conversation_id;
		if (!id) continue;
		const bucket = grouped.get(id);
		if (bucket) bucket.push(event);
		else grouped.set(id, [event]);
	}
	return grouped;
}

function lastActivity(session: SessionState, events: Map<string, HookEvent[]>): string {
	const bucket = events.get(session.conversationId);
	return bucket?.[bucket.length - 1]?.ts ?? session.lastEventAt ?? '';
}

/** Open sessions first, each group most recently active first. */
export function orderSessions(sessions: SessionState[], events: Map<string, HookEvent[]>): SessionState[] {
	return [...sessions].sort((a, b) => {
		const openness = Number(a.status === 'closed') - Number(b.status === 'closed');
		if (openness !== 0) return openness;
		return lastActivity(b, events).localeCompare(lastActivity(a, events));
	});
}
