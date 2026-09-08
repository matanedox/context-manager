/** The one place the board reads disk: every refresh builds a snapshot, then transforms it. */
import { boardState, type BoardState } from "../model/board-state";
import { parseLines } from "../model/events";
import { globalRules, type GlobalRule } from "./global-rules";
import { readHandoffs, type ContextHandoff } from "./handoffs";
import { checkHooks, type HookCheck } from "./hooks-install";
import { loadEvents, readPendingRole, readPersistedState, readRoleMap, readSessionSettings, roleMapPath } from "./io";
import { purgeConversation, purgedIds } from "./purge";
import { personaCharterPath, workspaceContext, type WorkspaceContext } from "./workspace-context";

export type BoardSnapshot = {
  root: string | undefined;
  state: BoardState;
  usingDemo: boolean;
  roleMap: Record<string, string>;
  context: WorkspaceContext;
  handoffs: ContextHandoff[];
  globalRules: GlobalRule[];
  hookCheck: HookCheck;
  /** Charter file per persona, resolved here so the view model never stats the disk itself. */
  charterPaths: Record<string, string | null>;
};

const swept = new Set<string>();

/**
 * A tombstoned row still on disk is a hook write that landed after the purge. The row is hidden
 * either way, but its events stay in the log every refresh reparses, so take them now.
 * ponytail: once per id per window, so a purge that cannot write does not rewrite the log on a loop.
 */
function sweepGhosts(root: string | undefined, conversationIds: string[]): void {
  for (const conversationId of conversationIds) {
    if (swept.has(conversationId)) continue;
    swept.add(conversationId);
    purgeConversation(root, conversationId);
  }
}

export function readSnapshot(root: string | undefined, extensionPath: string): BoardSnapshot {
  const roleMap = readRoleMap(roleMapPath(root));
  const { text, usingDemo } = loadEvents(root, extensionPath);
  const persisted = readPersistedState(root);
  // The user's own settings win over whatever the hook last wrote into the state file: the values
  // still in there are only a legacy copy from before they moved to their own file.
  const settings = readSessionSettings(root);
  persisted.sessions = persisted.sessions?.map((session) => ({
    ...session,
    ...settings[session.conversationId],
  }));
  persisted.pendingRole = readPendingRole(root);
  const context = workspaceContext(root);
  const state = boardState(parseLines(text), roleMap, persisted, usingDemo);
  // The tombstone has to outlive current-state.json. Closing the last chat deletes that file, so
  // the rows are replayed from the log instead, and a late hook write there brought the closed chat
  // back — role-less, which the rail names after the fallback guide. Filtering the built rows
  // covers the replayed path as well as the persisted one.
  const purged = purgedIds(root);
  const ghosts = state.sessions.filter((session) => purged.has(session.conversationId));
  state.sessions = state.sessions.filter((session) => !purged.has(session.conversationId));
  sweepGhosts(
    root,
    ghosts.map((session) => session.conversationId),
  );
  return {
    root,
    state,
    usingDemo,
    roleMap,
    context,
    handoffs: readHandoffs(root),
    globalRules: globalRules(),
    hookCheck: checkHooks(root),
    // ponytail: one lookup per persona, so a roster of a few dozen is fine; cache per root if a
    // workspace ever grows a roster large enough for the stat calls to show up on a refresh.
    charterPaths: Object.fromEntries(
      context.personas.map((persona) => [persona.id, personaCharterPath(root, persona.id)]),
    ),
  };
}
