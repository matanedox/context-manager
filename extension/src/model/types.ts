import type { Role } from './roles';

export type { Role };

export type HookEvent = {
	ts?: string;
	type?: string;
	raw?: {
		hook_event_name?: string;
		tool_name?: string;
		subagentType?: string;
		subagent_type?: string;
		conversation_id?: string;
		parent_conversation_id?: string;
		model?: string;
		composer_mode?: string;
		input_tokens?: number;
		output_tokens?: number;
		cache_read_tokens?: number;
		cache_write_tokens?: number;
		tool_input?: Record<string, unknown>;
		description?: string;
		tool_call_count?: number;
		reason?: string;
		final_status?: string;
		/** Role the board clicked, recorded on its own sessionStart so the assignment is durable. */
		role?: string;
	};
};

export type SessionState = {
	conversationId: string;
	/** null until a persona is assigned: a chat the board did not start belongs to no persona. */
	role: Role | null;
	status: 'idle' | 'working' | 'failed' | 'closed';
	highlighted?: boolean;
	lastEventAt?: string | null;
	/** Sticky ordinal among this persona's chats, assigned when the board starts the session. */
	instanceIndex?: number;
	/** Optional awareness cap; omitted means no fill and no "tight" state. */
	contextLimitTokens?: number;
	/** When set, a turn that ends over the cap starts a briefed replacement chat. */
	autoContinueOnLimit?: boolean;
	/** Replacement conversation id, or `"pending"` while that chat is still opening. */
	autoContinuedTo?: string;
	subagents: Array<{
		type: string;
		role: Role;
		status: 'working' | 'stopped';
	}>;
};

export type LiveEdge = { from: Role; to: Role; label: string };

export type PersistedState = {
	pendingRole?: Role | null;
	sessions?: SessionState[];
	liveEdges?: LiveEdge[];
};
