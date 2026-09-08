/**
 * The board payload: shared shell (banner, session rail, hook state) plus every screen's slice.
 * Pure — the host hands it a snapshot, so nothing here reads disk.
 */
import type { HookCheck } from "../data/hooks-install";
import { GUIDE_PERSONA, personaDisplayName } from "../data/personas";
import type { BoardSnapshot } from "../data/snapshot";
import { contextMeter, contextSummary, relativeTime } from "./copy";
import { personaDisplay, personaName, personaNote } from "./persona";
import { buildScreens, type ScreenPayload } from "./screens";
import { selectionOf } from "./selection";
import { showSessionInstance } from "../model/session-label";
import type { AccountUsageView, BoardUi, LoadingView, Page } from "./ui";
import type { Role } from "../model/roles";

export type { AccountUsageView, BoardUi, LoadingView, Page } from "./ui";
export { personaDisplay } from "./persona";

export type SessionRow = {
  conversationId: string;
  roleLabel: string;
  name?: string;
  status: string;
  shortId: string;
  when: string;
  active: boolean;
  working: boolean;
  pending: boolean;
  instanceIndex?: number;
  showInstance?: boolean;
  /** Read-only context reading for the rail; the cap itself is set on the agent screen. */
  context?: string;
  contextOver?: boolean;
};

/** The shell every screen sits inside. Screen-specific fields come from `ScreenPayload`. */
export type BoardShell = {
  banner: string;
  edges: Array<{ from: string; to: string; label: string }>;
  sessions: SessionRow[];
  page: Page;
  hookCheck: HookCheck;
  loading?: LoadingView;
  accountUsage?: AccountUsageView;
};

export type ViewModel = BoardShell & ScreenPayload;

export function viewModel(snapshot: BoardSnapshot, ui: BoardUi): ViewModel {
  const { state, usingDemo, context } = snapshot;
  const selection = selectionOf(snapshot, ui);
  const { openSessions, selected } = selection;
  // A chat the board never assigned still runs as Onboarding: that is the persona the
  // hooks inject when a session claims none, so the rail names it instead of showing a blank row.
  const labeled = (id: Role | null) => {
    const role = id ?? GUIDE_PERSONA.id;
    const entry = context.personas.find((persona) => persona.id === role);
    return personaDisplay(role, personaName(role, entry ? personaDisplayName(entry) : undefined), entry?.title);
  };
  const pendingRow: SessionRow[] =
    state.pendingRole && !openSessions.some((session) => session.role === state.pendingRole)
      ? [
          {
            conversationId: "",
            ...labeled(state.pendingRole),
            status: "starting",
            shortId: "Starting…",
            when: "",
            active: false,
            working: false,
            pending: true,
          },
        ]
      : [];

  return {
    banner: usingDemo
      ? "Seeded board (demo). Live hooks replace this when events.jsonl has data."
      : `Live hook log · ${personaNote(context)}${
          snapshot.hookCheck.ready ? "" : " · hooks not installed: chats cannot see their persona"
        }`,
    edges: [],
    // The seeded log names no chat Cursor can open or archive, so its rows are left out entirely:
    // a row that answers neither a click nor its own × is worse than an empty rail.
    sessions: usingDemo
      ? []
      : [
          ...pendingRow,
          ...openSessions.map((session) => {
            const events = state.eventsByConversation.get(session.conversationId) ?? [];
            const meter = contextMeter(contextSummary(events), session.contextLimitTokens);
            return {
              conversationId: session.conversationId,
              ...labeled(session.role),
              status: session.status,
              shortId: session.conversationId.slice(0, 6),
              when: relativeTime(events[events.length - 1]?.ts, ui.now),
              active: session.conversationId === selected?.conversationId,
              working: session.status === "working",
              pending: false,
              instanceIndex: session.instanceIndex,
              showInstance: showSessionInstance(session, openSessions),
              context: meter?.short,
              contextOver: meter?.overLimit,
            };
          }),
        ],
    page: ui.page,
    hookCheck: snapshot.hookCheck,
    loading: ui.loading,
    accountUsage: ui.accountUsage,
    ...buildScreens(snapshot, selection),
  };
}
