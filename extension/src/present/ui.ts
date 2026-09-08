/** Host-owned view state. Adding a screen starts here: add its id to PAGES. */
export const PAGES = ["team", "agent"] as const;

export type Page = (typeof PAGES)[number];

/** Inline "opening session…" state: the host owns the machine, the board renders this shape. */
export type LoadingView = {
  token: number;
  label: string;
  conversationId?: string;
  startedAt: number;
};

/** Cursor account quota on the Team screen; host-owned, not the per-chat token meter. */
export type AccountUsageView =
  | { kind: "loading" }
  | { kind: "needsAuth" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      label: string;
      included?: string;
      onDemand?: string;
      exhausted: boolean;
      details: string[];
    };

/** What disk knows nothing about: which screen, which chat, when, and whether one is opening. */
export type BoardUi = {
  page: Page;
  selectedConversationId?: string;
  now: number;
  loading?: LoadingView;
  accountUsage?: AccountUsageView;
};
