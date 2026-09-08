/** What a persona click opens, and what a chat that filled up hands to its replacement. */
import * as vscode from "vscode";
import { personaDisplayName } from "../../data/personas";
import type { BoardSnapshot } from "../../data/snapshot";
import { continuationNote } from "../../data/sibling-sessions";
import { roleLabel, type Role } from "../../model/roles";
import { openSessionsForRole } from "../../model/session-label";
import { contextMeter, contextSummary } from "../../present/copy";
import { personaName } from "../../present/persona";

export type OpenChoice =
  { open: "new"; note?: string } | { open: "existing"; conversationId: string } | { open: "cancel" };

function personaLabel(snapshot: BoardSnapshot, role: Role): string {
  const persona = snapshot.context.personas.find((entry) => entry.id === role);
  return personaName(role, persona ? personaDisplayName(persona) : undefined) ?? roleLabel(role, persona?.title);
}

/**
 * A second click on a persona is ambiguous — go back to that chat, or run a twin beside it — so it
 * asks instead of quietly opening a session the user then has to find and close.
 */
export async function confirmSecondSession(
  snapshot: BoardSnapshot,
  role: Role,
  usingDemo: boolean,
): Promise<OpenChoice> {
  const open = usingDemo ? [] : openSessionsForRole(snapshot.state.sessions, role);
  if (!open.length) return { open: "new" };
  const label = personaLabel(snapshot, role);
  const briefed = "Start a briefed session";
  const clean = "Start a clean session";
  const existing = "Open the current one";
  const pick = await vscode.window.showInformationMessage(
    `${label} already has ${open.length === 1 ? "a session open" : `${open.length} sessions open`}.`,
    {
      modal: true,
      detail: `A chat is already open for ${label}. Open an additional chat with its own context, either briefed with a catch-up or as a clean session.`,
    },
    briefed,
    clean,
    existing,
  );
  if (pick === briefed) {
    return {
      open: "new",
      note: continuationBrief(snapshot, open[0].conversationId, "sibling")?.text,
    };
  }
  if (pick === clean) return { open: "new" };
  if (pick === existing) return { open: "existing", conversationId: open[0].conversationId };
  return { open: "cancel" };
}

/** The brief for a replacement chat: what the filled session was doing, as far as the log saw it. */
export function continuationBrief(
  snapshot: BoardSnapshot,
  conversationId: string,
  kind: "full" | "sibling",
  recap?: string,
): { role: Role; text: string } | undefined {
  const session = snapshot.state.sessions.find((row) => row.conversationId === conversationId);
  if (!session?.role) return undefined;
  const summary = contextSummary(snapshot.state.eventsByConversation.get(conversationId) ?? []);
  return {
    role: session.role,
    text: continuationNote({
      personaLabel: personaLabel(snapshot, session.role),
      previousIndex: session.instanceIndex,
      reading: contextMeter(summary, session.contextLimitTokens)?.short,
      files: summary.files,
      toolCalls: summary.toolCalls,
      kind,
      recap,
    }),
  };
}
