/** Decide what a Talk → Send does: reject it, or record it and switch to the target chat. */
import type { BoardState } from "../../model/board-state";
import { contextSummary } from "../../present/copy";
import { appendHandoff, type HandoffTargetKind } from "../../data/handoffs";
import type { Role } from "../../model/roles";

export type HandoffInput = {
  kind: HandoffTargetKind;
  role: Role;
  conversationId?: string;
  subagentType?: string;
  text: string;
};

/**
 * `openConversationId` is the chat to switch to; the note reaches it through the persona hook.
 * `nudge` means that chat is idle, so it needs a turn before its stop hook can speak the note.
 */
export type HandoffPlan = { warning?: string; openConversationId?: string; nudge?: boolean };

function reject(input: HandoffInput): string | undefined {
  if (input.kind === "session" && !input.conversationId) return "That session is no longer open.";
  if (input.kind === "subagent" && (!input.conversationId || !input.subagentType)) {
    return "That subagent is not running.";
  }
  if (input.kind === "role") return "Open a session for that persona first.";
  return undefined;
}

export function planHandoff(
  root: string | undefined,
  state: BoardState,
  fromId: string | undefined,
  input: HandoffInput,
): HandoffPlan {
  if (!root || !fromId) return { warning: "Select a session before sending context." };
  const fromSession = state.sessions.find((session) => session.conversationId === fromId);
  if (!fromSession) return { warning: "Select a session before sending context." };
  const warning = reject(input);
  if (warning) return { warning };

  // ponytail: no Cursor command types into a chat that already exists, so the note rides the
  // persona hook and reaches the target with its next message instead of opening a second chat.
  appendHandoff(root, {
    fromConversationId: fromId,
    fromRole: fromSession.role,
    to: {
      kind: input.kind,
      role: input.role,
      conversationId: input.conversationId,
      subagentType: input.subagentType,
    },
    text: input.text,
    files: contextSummary(state.eventsByConversation?.get(fromId) ?? []).files,
  });
  if (input.kind !== "session") return {};
  const target = state.sessions.find((row) => row.conversationId === input.conversationId);
  return { openConversationId: input.conversationId, nudge: target?.status !== "working" };
}
