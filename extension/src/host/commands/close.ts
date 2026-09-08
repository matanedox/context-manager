/** Ending a chat: the board's own ×, and the chats Cursor closes behind the board's back. */
import { archiveChat, runChatTask } from "../cursor-chat";
import { purgeConversation } from "../../data/purge";
import type { InlineLoading } from "../inline-loading";

export type CloseHost = {
  root: string | undefined;
  loading: InlineLoading;
  refresh: () => void;
  /** Drop the chat from the board's selection when it was the one on screen. */
  deselect: (conversationId: string) => void;
};

const CLOSING = "Closing session…";

/** A close the board does no waiting for still has to read as one, so its loader outlives the work. */
const VISIBLE_MS = 700;

/** How long a sessionEnd hook may take to land its event after the board has purged the chat. */
const LATE_HOOK_MS = 2000;

/** Chats already on their way out, so the reaper never doubles up on the board's own ×. */
const closing = new Set<string>();

/** Chats the board has painted as open, so only a close it actually witnessed spins a row. */
const seenOpen = new Set<string>();

/** Hold the loader where it can be seen, then wipe the chat's saved state and repaint. */
async function settle(host: CloseHost, conversationId: string, token: number): Promise<void> {
  try {
    // The purge belongs under the loader: before it, a repaint inside the hold dropped the row the
    // spinner was on, and after it, the row came back as a live chat for the moment between the
    // spinner going and its state going. Held, purged, then cleared — the row leaves once.
    await host.loading.hold(token, VISIBLE_MS);
  } finally {
    purgeConversation(host.root, conversationId);
    // ponytail: the sessionEnd hook appends its own event after the purge has read the log, and the
    // reducer then rebuilds the row from that one event, so a closed chat came back. One late sweep
    // takes it. Ceiling: a hook slower than this leaves a hidden closed row for the reaper.
    setTimeout(() => purgeConversation(host.root, conversationId), LATE_HOOK_MS).unref();
    host.deselect(conversationId);
    await host.loading.finish(token, 0);
    host.refresh();
  }
}

/** The board's ×: archiving in Cursor is the slow part, so the row spins from the click. */
export function closeSession(host: CloseHost, conversationId: string): void {
  closing.add(conversationId);
  const token = host.loading.begin(CLOSING, conversationId);
  void runChatTask(async () => {
    await archiveChat(conversationId);
    await settle(host, conversationId, token);
  });
}

/**
 * Chats the user closed in Cursor itself. The sessionEnd hook is the only notice the board gets, so
 * the row spins from that notice until its state is gone rather than vanishing mid-refresh.
 */
export function reapClosedSessions(
  host: CloseHost,
  sessions: Array<{ conversationId: string; status: string }>
): void {
  for (const { conversationId, status } of sessions) {
    if (!conversationId) continue;
    if (status !== "closed") {
      seenOpen.add(conversationId);
      continue;
    }
    if (closing.has(conversationId)) continue;
    closing.add(conversationId);
    // A row already closed the first time the board sees it was closed while the board was not
    // watching, so there is no close to report: spinning it put a chat the user had already closed
    // back on the rail for a beat before taking it away again. Take it quietly instead.
    if (!seenOpen.has(conversationId)) {
      purgeConversation(host.root, conversationId);
      host.refresh();
      continue;
    }
    void settle(host, conversationId, host.loading.begin(CLOSING, conversationId));
  }
}

/** Test hook: the closing set is module state, like the chat queue's. */
export function resetClosingForTests(): void {
  closing.clear();
  seenOpen.clear();
}
