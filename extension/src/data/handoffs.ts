/** Cross-session context handoffs for Working with (pilot). */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { runtimeFile } from "./runtime-dir";
import { roleLabel, type Role } from "../model/roles";

export type HandoffTargetKind = "session" | "role" | "subagent";

export type HandoffTarget = {
  kind: HandoffTargetKind;
  role: Role;
  conversationId?: string;
  subagentType?: string;
};

export type ContextHandoff = {
  id: string;
  ts: string;
  fromConversationId: string;
  /** null when the sending chat has no persona assigned. */
  fromRole: Role | null;
  to: HandoffTarget;
  text: string;
  /** Files the sender already had open, so the receiver need not rediscover them. */
  files?: string[];
  /**
   * Rides a real submit as hidden context or not at all: the end of a turn consumes it in silence
   * rather than speaking it. The walkthrough uses this, so a hello sent before the note was written
   * cannot turn one introduction into two.
   */
  submitOnly?: boolean;
  read: boolean;
};

export type Collaborator = {
  id: string;
  kind: "session" | "subagent";
  role: Role;
  roleLabel: string;
  detail: string;
  conversationId?: string;
  subagentType?: string;
  lastNote?: string;
  /** The note has not reached the target yet: it waits for their next turn. */
  lastNotePending?: boolean;
  /** The note came from them to this chat, rather than the other way round. */
  lastNoteIncoming?: boolean;
};

export function handoffsPath(root: string): string {
  return runtimeFile(root, "context-handoffs.jsonl");
}

export function readHandoffs(root: string | undefined): ContextHandoff[] {
  if (!root) return [];
  const file = handoffsPath(root);
  if (!fs.existsSync(file)) return [];
  const out: ContextHandoff[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as ContextHandoff;
      if (row.id && row.to?.kind && row.text) out.push(row);
    } catch {
      /* skip corrupt lines */
    }
  }
  return out;
}

/** A note is written unread; the persona hook marks it read once it reaches the target chat. */
export function appendHandoff(
  root: string | undefined,
  entry: Omit<ContextHandoff, "id" | "ts" | "read">,
): ContextHandoff | null {
  if (!root || !entry.text.trim()) return null;
  const row: ContextHandoff = {
    ...entry,
    id: crypto.randomBytes(8).toString("hex"),
    ts: new Date().toISOString(),
    read: false,
  };
  const file = handoffsPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  return row;
}

function targetsMatch(a: HandoffTarget, b: HandoffTarget): boolean {
  if (a.kind !== b.kind || a.role !== b.role) return false;
  if (a.kind === "session") return a.conversationId === b.conversationId;
  if (a.kind === "subagent") {
    return a.conversationId === b.conversationId && a.subagentType === b.subagentType;
  }
  return true;
}

/**
 * The last note exchanged with this collaborator in either direction: the chat that received a
 * handoff should still see what it was handed, not an empty row.
 */
function lastNoteBetween(
  handoffs: ContextHandoff[],
  fromConversationId: string,
  to: HandoffTarget,
): { note: ContextHandoff; incoming: boolean } | undefined {
  for (let i = handoffs.length - 1; i >= 0; i--) {
    const row = handoffs[i];
    if (row.fromConversationId === fromConversationId && targetsMatch(row.to, to)) {
      return { note: row, incoming: false };
    }
    const from = row.to.kind === "session" && row.to.conversationId === fromConversationId;
    if (from && to.kind === "session" && row.fromConversationId === to.conversationId) {
      return { note: row, incoming: true };
    }
  }
  return undefined;
}

type SessionSlice = {
  conversationId: string;
  role: Role | null;
  subagents: Array<{ type: string; role: Role; status: string }>;
};

/** Talk targets: running subagents in this chat + every other open session with a persona. */
export function collaboratorsFor(
  selected: SessionSlice,
  openSessions: Array<{ conversationId: string; role: Role | null; status: string }>,
  handoffs: ContextHandoff[],
  labels: Record<Role, string>,
): Collaborator[] {
  const out: Collaborator[] = [];
  const seen = new Set<string>();

  for (const child of selected.subagents.filter((item) => item.status === "working")) {
    const id = `subagent:${child.type}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const target: HandoffTarget = {
      kind: "subagent",
      role: child.role,
      conversationId: selected.conversationId,
      subagentType: child.type,
    };
    const last = lastNoteBetween(handoffs, selected.conversationId, target);
    out.push({
      id,
      kind: "subagent",
      role: child.role,
      roleLabel: labels[child.role] ?? roleLabel(child.role),
      detail: `subagent · ${child.type}`,
      conversationId: selected.conversationId,
      subagentType: child.type,
      lastNote: last?.note.text,
      lastNotePending: last ? !last.note.read : undefined,
      lastNoteIncoming: last?.incoming,
    });
  }

  for (const session of openSessions) {
    if (session.conversationId === selected.conversationId || session.status === "closed") {
      continue;
    }
    if (!session.role) continue;
    const role = session.role;
    const id = `session:${session.conversationId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const target: HandoffTarget = {
      kind: "session",
      role,
      conversationId: session.conversationId,
    };
    const last = lastNoteBetween(handoffs, selected.conversationId, target);
    out.push({
      id,
      kind: "session",
      role,
      roleLabel: labels[role] ?? roleLabel(role),
      detail: "open session",
      conversationId: session.conversationId,
      lastNote: last?.note.text,
      lastNotePending: last ? !last.note.read : undefined,
      lastNoteIncoming: last?.incoming,
    });
  }

  return out;
}
