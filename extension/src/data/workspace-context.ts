import * as fs from 'fs';
import * as path from 'path';
import { readContextTabs, type ContextCategory } from './context-tabs';
import { frontmatter, markdownFiles, metaList, metaValue, relativePath, slugify } from './md';
import {
	discoverPersonas,
	GUIDE_PERSONA,
	isGuide,
	personaDisplayName,
	restoreGuide,
	type Persona,
	type PersonaSource,
} from './personas';
import { createPersona, personaCharterPath, removePersona, type CreatePersonaInput } from './persona-store';
import { isRole, type Role } from '../model/roles';

export type ContextKind = 'instruction' | 'rule' | 'skill' | 'workflow';

export type ContextItem = {
	id: string;
	label: string;
	path: string;
	type: ContextKind;
	readonly: boolean;
	favorite: boolean;
	categoryIds: string[];
	detail: string;
	alwaysApply: boolean;
	/** From frontmatter `personas:` / `persona:` / `role:`. */
	personas: string[];
	/** Persona ids whose charter lists this file under `- Rules:`. */
	referencedBy: string[];
};

export type WorkspaceContext = {
	alwaysOn: ContextItem[];
	available: ContextItem[];
	personas: Persona[];
	personaSource: PersonaSource;
	categories: ContextCategory[];
};

export type CreateContextInput = {
	kind: 'rule' | 'skill' | 'workflow' | 'persona';
	name: string;
	description: string;
	alwaysOn?: boolean;
	personas?: string[];
	categoryId?: string;
};

export {
	createPersona,
	discoverPersonas,
	GUIDE_PERSONA,
	isGuide,
	personaCharterPath,
	personaDisplayName,
	removePersona,
	restoreGuide,
	slugify,
};
export type { CreatePersonaInput, Persona, PersonaSource };

const CONTEXT_ROOTS = ['.cursor/rules/', '.cursor/skills/', '.cursor/workflows/', '.cursor/personas/'];

export function isWorkspaceContextPath(relPath: string): boolean {
	const normalized = relPath.replaceAll('\\', '/');
	return (
		normalized === 'AGENTS.md' ||
		normalized === '.cursor/agent-viz/personas.json' ||
		(CONTEXT_ROOTS.some((prefix) => normalized.startsWith(prefix)) && !normalized.split('/').includes('..'))
	);
}

/**
 * Resolve a path a tool reported, for opening it. The log is written by hooks and holds whatever
 * argument the tool was given — absolute or relative, either slash — so this is a trust boundary:
 * anything that lands outside the workspace, or does not exist, resolves to nothing.
 */
export function workspaceFilePath(root: string | undefined, filePath: string): string | null {
	if (!root || !filePath) return null;
	const abs = path.resolve(root, filePath);
	const rel = path.relative(root, abs);
	if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
	return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
}

/** Skill folders keep their entry point plus supporting docs; label by folder for `SKILL.md`. */
function skillLabel(root: string, file: string): string {
	const base = path.basename(file);
	if (base.toLowerCase() !== 'skill.md') return base;
	const folder = path.basename(path.dirname(file));
	return folder && path.dirname(file) !== path.join(root, '.cursor', 'skills') ? folder : base;
}

function item(root: string, file: string, type: ContextKind): ContextItem {
	const text = fs.readFileSync(file, 'utf8');
	const metadata = frontmatter(text);
	const description = metaValue(metadata, 'description');
	const globs = metaValue(metadata, 'globs');
	const always = /^alwaysApply:\s*true\s*$/m.test(metadata);
	return {
		id: `workspace:${relativePath(root, file)}`,
		label: type === 'skill' ? skillLabel(root, file) : path.basename(file),
		path: relativePath(root, file),
		type,
		readonly: type === 'instruction',
		favorite: false,
		categoryIds: [],
		alwaysApply: always,
		personas: metaList(metadata, ['personas', 'persona', 'role']),
		referencedBy: [],
		detail: always
			? 'Always applied'
			: globs
				? `Matching files: ${globs}`
				: (description ?? (type === 'rule' ? 'Available rule' : `Available ${type}`)),
	};
}

export function workspaceContext(root: string | undefined): WorkspaceContext {
	const { personas, source } = discoverPersonas(root);
	if (!root) {
		return { alwaysOn: [], available: [], personas, personaSource: source, categories: [] };
	}
	const scan = (dir: string, type: ContextKind) =>
		markdownFiles(path.join(root, '.cursor', dir)).map((file) => item(root, file, type));
	const rules = scan('rules', 'rule');
	const skills = scan('skills', 'skill');
	const workflows = scan('workflows', 'workflow');
	const instructions = fs.existsSync(path.join(root, 'AGENTS.md'))
		? [
				{
					id: 'workspace:AGENTS.md',
					label: 'AGENTS.md',
					path: 'AGENTS.md',
					type: 'instruction' as const,
					readonly: true,
					favorite: false,
					categoryIds: [],
					detail: 'Always applied',
					alwaysApply: true,
					personas: [],
					referencedBy: [],
				},
			]
		: [];
	const raw = withReferencedBy({
		alwaysOn: [...instructions, ...rules.filter((entry) => entry.alwaysApply)],
		available: [...rules.filter((entry) => !entry.alwaysApply), ...skills, ...workflows],
		personas,
		personaSource: source,
		categories: [],
	});
	const all = [...raw.alwaysOn, ...raw.available];
	const tabs = readContextTabs(root, new Set(all.map((entry) => entry.id)));
	const decorate = (entries: ContextItem[]) =>
		entries.map((entry) => ({
			...entry,
			favorite: tabs.favorites.includes(entry.id),
			categoryIds: tabs.categories
				.filter((category) => tabs.assignments[category.id]?.includes(entry.id))
				.map((category) => category.id),
		}));
	return {
		...raw,
		alwaysOn: decorate(raw.alwaysOn),
		available: decorate(raw.available),
		categories: tabs.categories,
	};
}

function withReferencedBy(context: WorkspaceContext): WorkspaceContext {
	const byBasename = new Map<string, string[]>();
	for (const persona of context.personas) {
		for (const ref of persona.references) {
			const list = byBasename.get(ref) ?? [];
			if (!list.includes(persona.id)) list.push(persona.id);
			byBasename.set(ref, list);
		}
	}
	const tag = (items: ContextItem[]) =>
		items.map((entry) => ({
			...entry,
			referencedBy: byBasename.get(path.posix.basename(entry.path)) ?? [],
		}));
	return { ...context, alwaysOn: tag(context.alwaysOn), available: tag(context.available) };
}

function matchesPersona(entry: ContextItem, persona: Persona): boolean {
	if (entry.personas.includes(persona.id)) return true;
	if (persona.references.includes(path.posix.basename(entry.path))) return true;
	return entry.path.toLowerCase().includes(persona.id.toLowerCase());
}

/** Always-on files plus items tagged for or referenced by this persona; other roles' files sink. */
export function contextForPersona(context: WorkspaceContext, personaId: Role): WorkspaceContext {
	const persona =
		context.personas.find((entry) => entry.id === personaId) ??
		({ id: personaId, title: personaId, description: '', references: [] } satisfies Persona);
	const rest = context.available.filter((entry) => entry.personas.length === 0 || matchesPersona(entry, persona));
	const mine = rest.filter((entry) => matchesPersona(entry, persona));
	const shared = rest.filter((entry) => !matchesPersona(entry, persona));
	return { ...context, available: [...mine, ...shared] };
}

export function linkedContextForPersona(context: WorkspaceContext, personaId: Role): ContextItem[] {
	const persona =
		context.personas.find((entry) => entry.id === personaId) ??
		({ id: personaId, title: personaId, description: '', references: [] } satisfies Persona);
	return [...context.alwaysOn, ...context.available].filter((entry) => matchesPersona(entry, persona));
}

export function createContextFile(root: string | undefined, input: CreateContextInput): string | null {
	if (!root) return null;
	const slug = slugify(input.name);
	if (!slug) return null;
	const personas = (input.personas ?? []).filter(isRole);
	const description = input.description.trim() || input.name.trim();
	const validCategory = input.categoryId && slugify(input.categoryId) === input.categoryId;
	const category = input.kind === 'rule' && validCategory ? input.categoryId : undefined;
	const rel =
		input.kind === 'rule'
			? `.cursor/rules/${category ? `${category}/` : ''}${slug}.mdc`
			: input.kind === 'skill'
				? `.cursor/skills/${slug}/SKILL.md`
				: input.kind === 'workflow'
					? `.cursor/workflows/${slug}.md`
					: `.cursor/personas/${slug}.md`;
	if (!isWorkspaceContextPath(rel)) return null;
	const abs = path.join(root, rel);
	if (fs.existsSync(abs)) return rel;
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	const personaLine = personas.length ? `personas: ${personas.join(', ')}\n` : '';
	const body =
		input.kind === 'persona'
			? `---\nid: ${slug}\ntitle: ${input.name.trim()}\ndescription: ${description}\n---\n\n${description}\n`
			: input.kind === 'skill'
				? `---\nname: ${input.name.trim()}\ndescription: ${description}\n${personaLine}---\n\n# ${input.name.trim()}\n\n${description}\n`
				: `---\ndescription: ${description}\nalwaysApply: ${input.alwaysOn ? 'true' : 'false'}\n${personaLine}---\n\n${description}\n`;
	fs.writeFileSync(abs, body);
	return rel;
}

/** Remove a workspace context file (skill folders delete entirely). */
export function deleteContextFile(root: string | undefined, relPath: string): boolean {
	if (!root || !isWorkspaceContextPath(relPath) || relPath === 'AGENTS.md') return false;
	const abs = path.join(root, relPath);
	if (!fs.existsSync(abs)) return false;
	try {
		if (relPath.includes('/skills/') && path.basename(abs).toLowerCase() === 'skill.md') {
			fs.rmSync(path.dirname(abs), { recursive: true, force: true });
		} else {
			fs.unlinkSync(abs);
		}
		return true;
	} catch {
		return false;
	}
}
/** Resolve a context id without letting it escape the workspace context roots. */
export function contextItemFile(root: string | undefined, itemId: string): { absPath: string; relPath: string } | null {
	if (!itemId.startsWith('workspace:')) return null;
	const relPath = itemId.slice('workspace:'.length);
	if (!root || !isWorkspaceContextPath(relPath)) return null;
	return { absPath: path.join(root, relPath), relPath };
}
