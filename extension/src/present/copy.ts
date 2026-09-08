import { eventType, subagentType } from '../model/events';
import { mapRole, roleLabel } from '../model/roles';
import type { HookEvent, Role } from '../model/types';

export function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
	return String(count);
}

export function relativeTime(ts: string | undefined, now: number): string {
	if (!ts) return '';
	const then = Date.parse(ts);
	if (Number.isNaN(then)) return '';
	const seconds = Math.max(0, Math.round((now - then) / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
	if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
	return `${Math.round(seconds / 86_400)}d ago`;
}

/** Pull the file path out of a tool call without assuming any single tool's schema. */
export function touchedFile(event: HookEvent): string | undefined {
	const input = event.raw?.tool_input;
	if (!input) return undefined;
	for (const key of ['path', 'file_path', 'target_file', 'notebook_path']) {
		const value = input[key];
		if (typeof value === 'string' && value) return value.split('/').pop();
	}
	return undefined;
}

export type ContextSummary = {
	model?: string;
	composerMode?: string;
	inputTokens?: number;
	cachedShare?: number;
	outputTokens?: number;
	toolCalls: number;
	files: string[];
	endReason?: string;
};

export type ContextMeter = {
	/** Agent card: size, cap when set, and the cached share. */
	label: string;
	/** Session rail: the same reading with no room for the cached share. */
	short: string;
	overLimit: boolean;
	fill?: number;
};

export function contextMeter(summary: ContextSummary, limitTokens?: number): ContextMeter | undefined {
	if (summary.inputTokens === undefined) return undefined;
	const cached = summary.cachedShare !== undefined ? ` · ${Math.round(summary.cachedShare * 100)}% cached` : '';
	const size = formatTokens(summary.inputTokens);
	if (limitTokens == null || limitTokens <= 0) {
		return { label: `${size}${cached}`, short: size, overLimit: false };
	}
	const short = `${size} / ${formatTokens(limitTokens)}`;
	return {
		label: `${short}${cached}`,
		short,
		overLimit: summary.inputTokens >= limitTokens,
		fill: Math.min(1, summary.inputTokens / limitTokens),
	};
}

export function contextSummary(events: HookEvent[]): ContextSummary {
	const summary: ContextSummary = { toolCalls: 0, files: [] };
	const files = new Set<string>();
	let cacheRead = 0;
	for (const event of events) {
		const kind = eventType(event);
		const raw = event.raw ?? {};
		if (raw.model) summary.model = raw.model;
		if (raw.composer_mode) summary.composerMode = raw.composer_mode;
		if (kind === 'postToolUse' || kind === 'preToolUse') {
			summary.toolCalls += 1;
			const file = touchedFile(event);
			if (file) files.add(file);
		}
		// Summed, not last-wins: the reading is what this chat has spent, so a chat that answered ten
		// times has paid its prompt ten times. Cursor reports each turn separately and never a running
		// total, so reading one turn made a long chat look as cheap as its cheapest answer.
		if (kind === 'afterAgentResponse' && typeof raw.input_tokens === 'number') {
			summary.inputTokens = (summary.inputTokens ?? 0) + raw.input_tokens;
			if (typeof raw.output_tokens === 'number') {
				summary.outputTokens = (summary.outputTokens ?? 0) + raw.output_tokens;
			}
			if (typeof raw.cache_read_tokens === 'number') cacheRead += raw.cache_read_tokens;
		}
		if (kind === 'sessionEnd') {
			summary.endReason = raw.final_status && raw.final_status !== 'none' ? raw.final_status : raw.reason;
		}
	}
	summary.files = [...files].slice(-6);
	if (summary.inputTokens) summary.cachedShare = cacheRead / summary.inputTokens;
	return summary;
}

/** ponytail: coarse tool→phase map; extend when new high-signal tools show up in the log. */
export function toolPhase(tool: string): string | undefined {
	switch (tool) {
		case 'TodoWrite':
		case 'CreateGoal':
		case 'UpdateGoal':
			return 'planning';
		case 'Task':
			return 'delegating';
		case 'Read':
		case 'Grep':
		case 'Glob':
		case 'WebFetch':
		case 'WebSearch':
			return 'researching';
		case 'Write':
		case 'StrReplace':
		case 'EditNotebook':
		case 'Delete':
			return 'implementing';
		case 'Shell':
			return 'running';
		default:
			return undefined;
	}
}

function promptStarted(composerMode?: string): string {
	if (composerMode === 'ask') return 'started answering';
	if (composerMode === 'agent') return 'started working';
	return 'started responding';
}

export function activityDescription(
	event: HookEvent,
	parent: Role,
	roleMap: Record<string, string>,
	names: Partial<Record<Role, string>> = {}
): string {
	const kind = eventType(event);
	const type = subagentType(event);
	const child = mapRole(type, roleMap);
	const actor = child ?? parent;
	const actorName = (role: Role) => names[role] ?? roleLabel(role);
	const tool = event.raw?.tool_name;
	const task = event.raw?.description;

	if (kind === 'sessionStart') return `New ${actorName(parent)} session started`;
	if (kind === 'beforeSubmitPrompt') {
		return `${actorName(parent)} ${promptStarted(event.raw?.composer_mode)}`;
	}
	if (kind === 'subagentStart' && child) {
		return `${actorName(parent)} delegated to ${actorName(child)} (${type})`;
	}
	if (kind === 'subagentStop' && child) {
		return `${actorName(child)} finished${task ? `: ${task}` : ' delegated work'}`;
	}
	if (kind === 'afterAgentResponse') return `${actorName(parent)} finished responding`;
	if (kind === 'sessionEnd') {
		const reason = event.raw?.reason;
		return `${actorName(parent)} session ended${reason ? ` (${reason.replace(/_/g, ' ')})` : ''}`;
	}
	if ((kind === 'postToolUse' || kind === 'preToolUse') && tool) {
		const file = touchedFile(event);
		const suffix = file ? ` on ${file}` : '';
		const phase = toolPhase(tool);
		if (phase) return `${actorName(actor)} ${phase} — ${tool}${suffix}`;
		return `${actorName(actor)} used ${tool}${suffix}`;
	}
	return `${actorName(actor)}: ${kind}${tool ? ` ${tool}` : ''}`;
}
