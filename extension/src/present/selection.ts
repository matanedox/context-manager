/** Which chat the board is looking at, resolved once so the shell and screens agree on it. */
import type { BoardSnapshot } from "../data/snapshot";
import type { Role } from "../model/roles";
import type { HookEvent, SessionState } from "../model/types";
import type { BoardUi } from "./ui";

export type Selection = {
  openSessions: SessionState[];
  selected?: SessionState;
  /** Hook events of the selected chat only: activity heat must never leak between chats. */
  events: HookEvent[];
  busyRoles: Set<Role>;
};

export function selectionOf(snapshot: BoardSnapshot, ui: BoardUi): Selection {
  // A chat on its way out keeps its row until its state is gone, so the rail can spin on it.
  const closing = ui.loading?.conversationId;
  const openSessions = snapshot.state.sessions.filter(
    (session) => session.status !== "closed" || session.conversationId === closing,
  );
  const selected = openSessions.find((session) => session.conversationId === ui.selectedConversationId);
  return {
    openSessions,
    selected,
    events: selected ? (snapshot.state.eventsByConversation.get(selected.conversationId) ?? []) : [],
    busyRoles: new Set<Role>(
      selected
        ? [
            ...(selected.status === "working" && selected.role ? [selected.role] : []),
            ...selected.subagents.filter((c) => c.status === "working").map((c) => c.role),
          ]
        : [],
    ),
  };
}
