/** Persona copy shared by the shell and every screen, so labels read the same everywhere. */
import type { WorkspaceContext } from "../data/workspace-context";
import { roleLabel } from "../model/roles";
import type { Role } from "../model/roles";

/**
 * Role is always shown; name is the optional display title when it differs from the role label. A
 * persona's own title wins over the label derived from its id, so a roster reads the way the
 * persona declares itself rather than as a capitalised slug.
 */
export function personaDisplay(id: Role, name?: string, title?: string): { roleLabel: string; name?: string } {
  const roleLabelText = roleLabel(id, title);
  const trimmed = name?.trim();
  return trimmed && trimmed !== roleLabelText
    ? { roleLabel: roleLabelText, name: trimmed }
    : { roleLabel: roleLabelText };
}

/** Names belong in the persona source, never in the extension. */
export function personaName(_id: Role, declared?: string): string | undefined {
  return declared?.trim() || undefined;
}

/** Says where the roster came from so a fallback roster is never mistaken for the project's own. */
export function personaNote(context: WorkspaceContext): string {
  const where =
    context.personaSource === "json"
      ? ".cursor/agent-viz/personas.json"
      : context.personaSource === "fallback"
        ? ""
        : ".cursor/personas";
  return where ? `${context.personas.length} personas from ${where}` : "no persona files found — default roster";
}

export function personaTitle(context: WorkspaceContext, role: Role): string {
  const persona = context.personas.find((item) => item.id === role);
  if (!persona) return `${roleLabel(role)}`;
  return persona.description ? `${persona.title} — ${persona.description}` : persona.title;
}
