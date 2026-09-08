/** Persona writes: add, remove, and locate the roster file this workspace already uses. */
import * as fs from "fs";
import * as path from "path";
import { markdownFiles, slugify } from "./md";
import {
  discoverPersonas,
  dismissGuide,
  isGuide,
  personasFromCharter,
  roleIndex,
  sections,
  type Persona,
} from "./personas";
import { isRole, roleLabel, type Role } from "../model/roles";

export type CreatePersonaInput = {
  role: string;
  description?: string;
  name?: string;
};

type JsonEntry = { id: string; title: string; description: string; name?: string };

function personaFileBody(id: Role, title: string, description: string, name?: string): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    ...(name ? [`name: ${name}`] : []),
    `description: ${description}`,
    "---",
    "",
    `- Use when: ${description}.`,
    `- Owns: ${description}.`,
    "",
  ].join("\n");
}

function charterFile(root: string): string | undefined {
  const dir = path.join(root, ".cursor", "personas");
  return markdownFiles(dir).find((file) => personasFromCharter(fs.readFileSync(file, "utf8")).length > 0);
}

function appendToCharter(file: string, id: Role, description: string, name?: string): void {
  const text = fs.readFileSync(file, "utf8");
  if (roleIndex(text).has(id) || sections(text).some((section) => section.id === id)) return;
  const bullet = `- ${id} — ${description}.`;
  const nameLine = name ? `- Display name: ${name}\n` : "";
  const section = `\n\n## ${id}\n\n${nameLine}- Use when: ${description}.\n- Owns: ${description}.\n`;
  const lines = text.replace(/\s+$/, "").split("\n");
  const indexLine = lines.findIndex((line) => /^##\s+Role Index/i.test(line));
  if (indexLine >= 0) {
    let insertAt = lines.length;
    for (let i = indexLine + 1; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i])) {
        insertAt = i;
        break;
      }
    }
    lines.splice(insertAt, 0, bullet);
    fs.writeFileSync(file, `${lines.join("\n")}${section}`);
    return;
  }
  fs.writeFileSync(file, `${lines.join("\n")}\n\n## Role Index\n\n${bullet}${section}`);
}

function appendToPersonasJson(file: string, entries: JsonEntry[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
}

function jsonEntry(persona: Persona): JsonEntry {
  return {
    id: persona.id,
    title: persona.title,
    description: persona.description,
    ...(persona.name ? { name: persona.name } : {}),
  };
}

/** Add a persona using the roster source already in the workspace (charter, files, or json). */
export function createPersona(root: string | undefined, input: CreatePersonaInput): string | null {
  if (!root) return null;
  const id = slugify(input.role.trim());
  if (!isRole(id)) return null;
  const customName = input.name?.trim();
  if (!customName) return null;
  const title = roleLabel(id);
  const description = input.description?.trim() || title;
  const { personas, source } = discoverPersonas(root);
  if (personas.some((persona) => persona.id === id)) return null;

  if (source === "charter") {
    const file = charterFile(root);
    if (!file) return null;
    appendToCharter(file, id, description, customName);
    return path.relative(root, file).split(path.sep).join("/");
  }

  if (source === "personas") {
    const rel = `.cursor/personas/${id}.md`;
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) return null;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, personaFileBody(id, title, description, customName));
    return rel;
  }

  const jsonRel = ".cursor/agent-viz/personas.json";
  // Onboarding belongs to the extension, so it is never written into the project's roster: from the
  // fallback the file starts with what the user added and nothing else.
  const base = source === "json" ? owned(personas).map(jsonEntry) : [];
  appendToPersonasJson(path.join(root, jsonRel), [
    ...base,
    { id, title, description, ...(customName ? { name: customName } : {}) },
  ]);
  return jsonRel;
}

/** The project's own personas: Onboarding is injected by the extension and owns no file. */
function owned(personas: Persona[]): Persona[] {
  return personas.filter((persona) => !isGuide(persona.id));
}

/** Path to open for this persona's charter (file, charter doc, or personas.json). */
export function personaCharterPath(root: string | undefined, id: Role): string | null {
  if (!root || !isRole(id) || isGuide(id)) return null;
  const { source } = discoverPersonas(root);
  if (source === "fallback") return null;
  if (source === "personas") {
    const rel = `.cursor/personas/${id}.md`;
    return fs.existsSync(path.join(root, rel)) ? rel : null;
  }
  if (source === "charter") {
    const file = charterFile(root);
    return file ? path.relative(root, file).split(path.sep).join("/") : null;
  }
  return ".cursor/agent-viz/personas.json";
}

function removeFromCharter(file: string, id: Role): void {
  const lines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => {
      const match = line.match(/^\s*[-*]\s+[`*]*([a-z][a-z0-9-]{1,40})[`*]*/);
      return !(match && match[1] === id);
    });
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (heading) {
      skipping = slugify(heading[1].replace(/[`*]/g, "")) === id;
      if (skipping) continue;
    }
    if (!skipping) kept.push(line);
  }
  fs.writeFileSync(
    file,
    `${kept
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()}\n`,
  );
}

/**
 * Drop a persona from the roster source in this workspace. No card is permanent, Onboarding
 * included: an empty board is a state the user asked for, and `+ Add persona` is always there.
 */
export function removePersona(root: string | undefined, id: Role): boolean {
  if (!root || !isRole(id)) return false;
  const { personas, source } = discoverPersonas(root);
  const mine = owned(personas);
  // Onboarding owns no file, so sending it away is a preference; restoreGuide brings it back.
  if (isGuide(id)) return dismissGuide(root);
  if (!mine.some((persona) => persona.id === id)) return false;
  // Nothing to remove from: the fallback roster is a preview, not a file this project wrote.
  if (source === "fallback") return false;

  if (source === "charter") {
    const file = charterFile(root);
    if (!file) return false;
    removeFromCharter(file, id);
    return true;
  }

  if (source === "personas") {
    const abs = path.join(root, ".cursor/personas", `${id}.md`);
    if (!fs.existsSync(abs)) return false;
    fs.unlinkSync(abs);
    return true;
  }

  const jsonAbs = path.join(root, ".cursor/agent-viz/personas.json");
  const remaining = mine.filter((persona) => persona.id !== id).map(jsonEntry);
  if (!remaining.length) {
    fs.unlinkSync(jsonAbs);
    return true;
  }
  appendToPersonasJson(jsonAbs, remaining);
  return true;
}
