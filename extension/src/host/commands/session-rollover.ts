/** Request a recap from a full chat, then start its replacement. */
import {
  claimAutoContinue,
  ensureRecapDir,
  recapPath,
  recapRequestText,
  shouldAutoContinue,
  unclaimAutoContinue,
  waitForRecap,
} from "../../data/auto-continue";
import { appendHandoff } from "../../data/handoffs";
import { readSnapshot, type BoardSnapshot } from "../../data/snapshot";
import type { Role } from "../../model/roles";
import { contextMeter, contextSummary } from "../../present/copy";
import { nudgeChat, runChatTask } from "../cursor-chat";
import { continuationBrief } from "./session-open";

export type RolloverHost = {
  usingDemo: boolean;
  autoContinuing: boolean;
  extensionPath: string;
  markRunning: (running: boolean) => void;
  startSession: (role: Role, note?: string, from?: string) => void;
};

export function queueAutoContinue(
  host: RolloverHost,
  snapshot: BoardSnapshot,
  root: string | undefined
): void {
  if (host.usingDemo || host.autoContinuing || !root) return;
  const hit = snapshot.state.sessions.find((session) => {
    const events = snapshot.state.eventsByConversation.get(session.conversationId) ?? [];
    const summary = contextSummary(events);
    const over = Boolean(contextMeter(summary, session.contextLimitTokens)?.overLimit);
    return shouldAutoContinue(session, over, Boolean(summary.toolCalls || summary.files.length));
  });
  if (!hit?.role) return;
  if (!claimAutoContinue(root, hit.conversationId)) return;
  host.markRunning(true);
  const fromId = hit.conversationId;
  const fromRole = hit.role;
  // An Ask-mode chat is read-only, so it cannot write the recap it would be asked for. Skipping the
  // round trip costs nothing it could have delivered and saves stalling the rollover for the whole
  // recap timeout; the replacement falls back to the brief built from the activity log.
  const asking =
    contextSummary(snapshot.state.eventsByConversation.get(fromId) ?? []).composerMode === "ask";
  void runChatTask(async () => {
    try {
      let recap: string | undefined;
      if (!asking) {
        const file = recapPath(root, fromId);
        ensureRecapDir(file);
        appendHandoff(root, {
          fromConversationId: fromId,
          fromRole,
          to: { kind: "session", role: fromRole, conversationId: fromId },
          text: recapRequestText(file),
        });
        await nudgeChat(fromId);
        recap = await waitForRecap(file);
      }
      const brief = continuationBrief(readSnapshot(root, host.extensionPath), fromId, "full", recap);
      if (brief) host.startSession(brief.role, brief.text, fromId);
      else unclaimAutoContinue(root, fromId);
    } catch {
      unclaimAutoContinue(root, fromId);
    } finally {
      host.markRunning(false);
    }
  });
}
