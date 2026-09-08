/** Persona discovery: one file per persona, a multi-role charter, JSON, then Onboarding. */
import * as fs from "fs";
import * as path from "path";
import { frontmatter, markdownFiles, metaValue, slugify } from "./md";
import { runtimeDir } from "./runtime-dir";
import { isRole, roleLabel, type Role } from "../model/roles";

export type Persona = {
  id: Role;
  title: string;
  /** Optional roster display name shown under the role. */
  name?: string;
  description: string;
  /** Context file basenames the persona charter points at, used to filter its context tabs. */
  references: string[];
};

export type PersonaSource = "personas" | "charter" | "json" | "fallback";

/**
 * The one persona the extension brings itself, first in every roster and never written to disk: it
 * walks the user through the extension and offers the Project Manager that turns the rules, skills
 * and instructions already in the repo into real personas. A project with no roster has only this.
 */
export const GUIDE_PERSONA: Persona = {
  id: "guide",
  title: "Onboarding",
  description: "guides you through the extension and helps you start a team",
  references: [],
};

/** Dismissing Onboarding is a board preference, so it lives with the runtime state, not in the repo. */
function dismissalMarker(root: string): string {
  return path.join(runtimeDir(root), "guide-dismissed");
}

export function guideDismissed(root: string | undefined): boolean {
  return !!root && fs.existsSync(dismissalMarker(root));
}

/** Onboarding is initial guidance: it can be sent away at any point, roster or not. */
export function dismissGuide(root: string): boolean {
  try {
    fs.mkdirSync(runtimeDir(root), { recursive: true });
    fs.writeFileSync(dismissalMarker(root), `${new Date().toISOString()}\n`);
    return true;
  } catch {
    return false;
  }
}

/** The way back, since a removed Onboarding card leaves nothing to click: it is a preference, not a file. */
export function restoreGuide(root: string | undefined): boolean {
  if (!root || !guideDismissed(root)) return false;
  try {
    fs.rmSync(dismissalMarker(root), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Charter headings that name the document, not a role. */
const GENERIC_HEADINGS = new Set([
  "role-index",
  "roles",
  "index",
  "team-roles",
  "handoff-table",
  "handoffs",
  "overview",
  "notes",
  "usage",
  "escalation",
]);

type Section = { id: Role; body: string };

/** Exported for the roster writer, which must not duplicate charter parsing. */
export function sections(text: string): Section[] {
  const found: Section[] = [];
  let current: Section | undefined;
  for (const line of text.split("\n")) {
    const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (!heading) {
      if (current) current.body += `${line}\n`;
      continue;
    }
    const id = slugify(heading[1].replace(/[`*]/g, ""));
    current = isRole(id) ? { id, body: "" } : undefined;
    if (current) found.push(current);
  }
  return found;
}

/** `- alpha — implement components…` bullets, the authoritative role list when present. */
export function roleIndex(text: string): Map<Role, string> {
  const index = new Map<Role, string>();
  for (const line of text.split("\n")) {
    const bullet = line.match(/^\s*[-*]\s+[`*]*([a-z][a-z0-9-]{1,40})[`*]*\s*[—–:-]\s+(\S.*?)\s*$/);
    if (!bullet) continue;
    const id = bullet[1];
    if (isRole(id) && !GENERIC_HEADINGS.has(id)) index.set(id, bullet[2]);
  }
  return index;
}

function references(body: string): string[] {
  return [...new Set([...body.matchAll(/[\w./-]+\.(?:mdc|md)/g)].map((m) => path.basename(m[0])))];
}

function summary(body: string): string {
  const line = body
    .split("\n")
    .map((entry) => entry.replace(/^\s*[-*]\s*/, "").trim())
    .find((entry) => entry.length > 0 && !entry.startsWith("|") && !entry.startsWith("#"));
  return line?.replace(/^\*\*(.+?)\*\*:?\s*/, "").slice(0, 120) ?? "";
}

function displayName(body: string): string | undefined {
  const match = body.match(/^\s*[-*]\s+Display name:\s*(.+?)\s*$/im);
  return match?.[1]?.trim() || undefined;
}

/** A single file listing several roles, e.g. `personas/team-roles.md`. */
export function personasFromCharter(text: string): Persona[] {
  const index = roleIndex(text);
  const bodies = new Map(sections(text).map((section) => [section.id, section.body]));
  const ids = index.size
    ? [...index.keys()]
    : [...bodies.keys()].filter((id) => !GENERIC_HEADINGS.has(id));
  if (ids.length < 2) return [];
  return ids.map((id) => {
    const body = bodies.get(id) ?? "";
    return {
      id,
      title: roleLabel(id),
      name: displayName(body),
      description: index.get(id) ?? summary(body),
      references: references(body),
    };
  });
}

function personaFromFile(file: string, text: string): Persona | null {
  const metadata = frontmatter(text);
  const fromName = path.basename(file).replace(/\.(md|mdc)$/i, "");
  const id = slugify(metaValue(metadata, "id") ?? fromName);
  if (!isRole(id)) return null;
  const body = text.replace(/^---[\s\S]*?---/, "");
  return {
    id,
    title: metaValue(metadata, "title") ?? roleLabel(id),
    name: metaValue(metadata, "name")?.trim() || undefined,
    description: metaValue(metadata, "description") ?? summary(body),
    references: references(body),
  };
}

function personasFromJson(file: string): Persona[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Array<{
      id?: string;
      title?: string;
      name?: string;
      description?: string;
    }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const id = slugify(entry.id ?? "");
      return isRole(id)
        ? [{
            id,
            title: entry.title ?? roleLabel(id),
            name: entry.name?.trim() || undefined,
            description: entry.description ?? "",
            references: [],
          }]
        : [];
    });
  } catch {
    return [];
  }
}

/**
 * Frontmatter naming the persona means the file is that one role. Without this its `##` sections
 * read as a role list, so a charter written the way a persona file should be written — "How you
 * work", "What you deliver" — put a card on the board per heading instead of one for the persona.
 */
function declaresPersona(text: string): boolean {
  const meta = frontmatter(text);
  return !!(metaValue(meta, "id") ?? metaValue(meta, "title"));
}

export function discoverPersonas(root: string | undefined): {
  personas: Persona[];
  source: PersonaSource;
} {
  if (!root) return { personas: [GUIDE_PERSONA], source: "fallback" };
  const guided = (personas: Persona[]) =>
    guideDismissed(root) ? dedupe(personas) : dedupe([GUIDE_PERSONA, ...personas]);
  const files = markdownFiles(path.join(root, ".cursor", "personas")).map((file) => ({
    file,
    text: fs.readFileSync(file, "utf8"),
  }));
  const own = (entries: typeof files) =>
    entries.flatMap(({ file, text }) => {
      const persona = personaFromFile(file, text);
      return persona ? [persona] : [];
    });
  const declared = files.filter(({ text }) => declaresPersona(text));
  const charter = files
    .filter((entry) => !declared.includes(entry))
    .flatMap(({ text }) => personasFromCharter(text));
  // A persona that names itself is listed alongside the charter rather than dropped: the roster
  // source stays the charter, which is still where a new persona is written.
  if (charter.length) return { personas: guided([...charter, ...own(declared)]), source: "charter" };
  const single = own(files);
  if (single.length) return { personas: guided(single), source: "personas" };
  const json = path.join(root, ".cursor", "agent-viz", "personas.json");
  if (fs.existsSync(json)) {
    const listed = personasFromJson(json);
    if (listed.length) return { personas: guided(listed), source: "json" };
  }
  return { personas: guided([]), source: "fallback" };
}

/** Whether this persona came from the extension rather than the project's own roster. */
export function isGuide(id: string): boolean {
  return id === GUIDE_PERSONA.id;
}

/** Optional roster name; legacy files may still store a custom title instead. */
export function personaDisplayName(persona: Pick<Persona, "id" | "title" | "name">): string | undefined {
  if (persona.name?.trim()) return persona.name.trim();
  const title = persona.title.trim();
  const role = roleLabel(persona.id);
  return title && title !== role ? title : undefined;
}

/**
 * Keeps the first position but the last definition, which is what puts Onboarding at the
 * head of every roster while letting a project that declares a `guide` of its own keep its wording.
 */
function dedupe(personas: Persona[]): Persona[] {
  return [...new Map(personas.map((persona) => [persona.id, persona])).values()];
}
