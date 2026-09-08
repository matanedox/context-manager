import * as fs from 'fs';
import * as path from 'path';
import type { ContextItem, WorkspaceContext } from './workspace-context';
import { runtimeFile } from './runtime-dir';
import { slugify } from './md';

export type ContextCategory = { id: string; label: string };
export type ContextTabsState = {
	favorites: string[];
	categories: ContextCategory[];
	assignments: Record<string, string[]>;
};
export type ContextTab = {
	id: string;
	label: string;
	count: number;
	kind: 'type' | 'favorites' | 'persona' | 'category';
	itemIds: string[];
	removable: boolean;
};

const EMPTY_TABS: ContextTabsState = { favorites: [], categories: [], assignments: {} };

function contextTabsPath(root: string): string {
	return runtimeFile(root, 'context-tabs.json');
}

export function readContextTabs(root: string | undefined, validIds?: Set<string>): ContextTabsState {
	if (!root) return { ...EMPTY_TABS, assignments: {} };
	const file = contextTabsPath(root);
	let parsed: Partial<ContextTabsState>;
	try {
		parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ContextTabsState>;
	} catch {
		return { ...EMPTY_TABS, assignments: {} };
	}
	const categories = Array.isArray(parsed.categories)
		? parsed.categories.filter(
				(entry): entry is ContextCategory =>
					Boolean(entry) && typeof entry.id === 'string' && typeof entry.label === 'string'
			)
		: [];
	const favorites = Array.isArray(parsed.favorites)
		? parsed.favorites.filter((id): id is string => typeof id === 'string')
		: [];
	const rawAssignments = parsed.assignments && typeof parsed.assignments === 'object' ? parsed.assignments : {};
	const assignments = Object.fromEntries(
		categories.map((category) => [
			category.id,
			Array.isArray(rawAssignments[category.id])
				? rawAssignments[category.id].filter((id): id is string => typeof id === 'string')
				: [],
		])
	);
	const state = { favorites, categories, assignments };
	if (!validIds) return state;
	const cleaned = {
		...state,
		favorites: state.favorites.filter((id) => validIds.has(id)),
		assignments: Object.fromEntries(
			categories.map((category) => [category.id, state.assignments[category.id].filter((id) => validIds.has(id))])
		),
	};
	if (JSON.stringify(cleaned) !== JSON.stringify(state)) writeContextTabs(root, cleaned);
	return cleaned;
}

function writeContextTabs(root: string | undefined, state: ContextTabsState): boolean {
	if (!root) return false;
	try {
		const file = contextTabsPath(root);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify(state, null, 2));
		return true;
	} catch {
		return false;
	}
}

export function toggleContextFavorite(root: string | undefined, itemId: string): boolean {
	const state = readContextTabs(root);
	const favorites = state.favorites.includes(itemId)
		? state.favorites.filter((id) => id !== itemId)
		: [...state.favorites, itemId];
	return writeContextTabs(root, { ...state, favorites });
}

export function createContextCategory(root: string | undefined, label: string): string | null {
	if (!root) return null;
	const state = readContextTabs(root);
	const id = slugify(label);
	if (!id || state.categories.some((category) => category.id === id)) return null;
	try {
		fs.mkdirSync(path.join(root, '.cursor', 'rules', id), { recursive: true });
	} catch {
		return null;
	}
	return writeContextTabs(root, {
		...state,
		categories: [...state.categories, { id, label: label.trim() }],
		assignments: { ...state.assignments, [id]: [] },
	})
		? id
		: null;
}

export function removeContextCategory(root: string | undefined, categoryId: string): boolean {
	const state = readContextTabs(root);
	if (!state.categories.some((category) => category.id === categoryId)) return false;
	const assignments = { ...state.assignments };
	delete assignments[categoryId];
	return writeContextTabs(root, {
		...state,
		categories: state.categories.filter((category) => category.id !== categoryId),
		assignments,
	});
}

export function setContextCategory(
	root: string | undefined,
	itemId: string,
	categoryId: string,
	assigned: boolean
): boolean {
	const state = readContextTabs(root);
	if (!state.categories.some((category) => category.id === categoryId)) return false;
	const current = state.assignments[categoryId] ?? [];
	const next = assigned ? [...new Set([...current, itemId])] : current.filter((id) => id !== itemId);
	return writeContextTabs(root, {
		...state,
		assignments: { ...state.assignments, [categoryId]: next },
	});
}

/** `personaId` is the persona of the open session; only that persona gets a tab. */
export function buildContextTabs(context: WorkspaceContext, personaId?: string): ContextTab[] {
	const items = [...context.alwaysOn, ...context.available];
	const persona = context.personas.find((entry) => entry.id === personaId);
	const tab = (
		id: string,
		label: string,
		kind: ContextTab['kind'],
		matches: (item: ContextItem) => boolean,
		removable = false
	): ContextTab => {
		const itemIds = items.filter(matches).map((item) => item.id);
		return { id, label, kind, itemIds, count: itemIds.length, removable };
	};
	return [
		tab('rules', 'Rules', 'type', (item) => item.type === 'rule' || item.type === 'instruction'),
		tab('skills', 'Skills', 'type', (item) => item.type === 'skill'),
		tab('workflow', 'Workflow', 'type', (item) => item.type === 'workflow'),
		tab('favorites', 'Favorites', 'favorites', (item) => item.favorite),
		...(persona
			? [
					tab(
						`persona:${persona.id}`,
						persona.title,
						'persona',
						(item) => item.personas.includes(persona.id) || item.referencedBy.includes(persona.id)
					),
				]
			: []),
		...context.categories.map((category) =>
			tab(
				`category:${category.id}`,
				category.label,
				'category',
				(item) => item.categoryIds.includes(category.id),
				true
			)
		),
	];
}
