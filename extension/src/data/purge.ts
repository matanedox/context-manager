/** Closing a session, and removing the extension, leave nothing on disk. */
import * as fs from "fs";
import { runtimeDir, runtimeFile, RUNTIME_FILES } from "./runtime-dir";
import type { HookEvent, PersistedState } from "../model/types";

/** Subagent chats the board tracked, so closing a session can take its subagent runs with it. */
type StateFile = PersistedState & {
  subagentConversations?: Record<string, { parentConversationId?: string }>;
};

/** Rewrite a JSONL file with only the lines to keep; returns whether any line survived. */
function filterJsonl(file: string, keep: (row: unknown) => boolean): boolean {
  if (!fs.existsSync(file)) return false;
  const kept = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .filter((line) => {
      try {
        return keep(JSON.parse(line));
      } catch {
        return false;
      }
    });
  if (!kept.length) {
    fs.rmSync(file, { force: true });
    return false;
  }
  fs.writeFileSync(file, `${kept.join("\n")}\n`);
  return true;
}

function readStateFile(root: string): StateFile {
  try {
    return JSON.parse(fs.readFileSync(runtimeFile(root, "current-state.json"), "utf8")) as StateFile;
  } catch {
    return {};
  }
}

/** Every conversation a close takes with it: the session plus the subagent chats it spawned. */
function conversationFamily(state: StateFile, conversationId: string): Set<string> {
  const family = new Set([conversationId]);
  for (const [subId, run] of Object.entries(state.subagentConversations ?? {})) {
    if (run?.parentConversationId === conversationId) family.add(subId);
  }
  return family;
}

/** Rewrite current-state.json without these conversations; returns whether any session remains. */
function dropSessions(root: string, state: StateFile, family: Set<string>): boolean {
  const file = runtimeFile(root, "current-state.json");
  if (!fs.existsSync(file)) return false;
  const sessions = (state.sessions ?? []).filter((session) => !family.has(session.conversationId));
  if (!sessions.length) {
    fs.rmSync(file, { force: true });
    return false;
  }
  const subagentConversations = Object.fromEntries(
    Object.entries(state.subagentConversations ?? {}).filter(([subId]) => !family.has(subId))
  );
  fs.writeFileSync(file, JSON.stringify({ ...state, sessions, subagentConversations }, null, 2));
  return true;
}

/** The cap and Auto flag the user set on a chat go out with the chat. */
function dropSessionSettings(root: string, family: Set<string>): void {
  const file = runtimeFile(root, "session-settings.json");
  if (!fs.existsSync(file)) return;
  try {
    const all = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const kept = Object.fromEntries(Object.entries(all).filter(([id]) => !family.has(id)));
    if (Object.keys(kept).length) fs.writeFileSync(file, JSON.stringify(kept, null, 2));
    else fs.rmSync(file, { force: true });
  } catch {
    /* unreadable settings are not worth failing a close over */
  }
}

/** Delete the session files. Preferences (context-tabs.json) are not session state. */
export function removeRuntimeFiles(root: string | undefined): void {
  if (!root) return;
  for (const name of RUNTIME_FILES) {
    try {
      fs.rmSync(runtimeFile(root, name), { force: true });
    } catch {
      /* a file we cannot remove is still gone from the board's view */
    }
  }
}

/**
 * The chats a full reset has to archive: every session the board still shows as open. Demo rows
 * illustrate a board rather than name real chats, so a demo reset archives nothing.
 */
export function openConversationIds(
  sessions: Array<{ conversationId: string; status: string }>,
  usingDemo: boolean
): string[] {
  if (usingDemo) return [];
  return sessions
    .filter((session) => session.status !== "closed")
    .map((session) => session.conversationId);
}

/** Everything this workspace ever stored, preferences included: the uninstall path. */
export function removeRuntimeState(root: string | undefined): void {
  if (!root) return;
  try {
    fs.rmSync(runtimeDir(root), { recursive: true, force: true });
  } catch {
    /* nothing left to report: the board reads it as an empty workspace either way */
  }
}

/** Clear one open session's visible activity without closing it or deleting its saved role. */
export function clearConversationActivity(
  root: string | undefined,
  conversationId: string
): void {
  if (!root) return;
  const family = conversationFamily(readStateFile(root), conversationId);
  filterJsonl(runtimeFile(root, "events.jsonl"), (row) => {
    const raw = (row as HookEvent).raw ?? {};
    // The clicked persona rides on this one event, and the hook rebuilds every session row from the
    // log: clearing it unbound a live chat, which then introduced itself as the fallback guide while
    // still receiving its own handoffs. Clearing the last line also deleted the log, which took the
    // other chats' rows with it.
    if (raw.role) return true;
    return !family.has(raw.conversation_id ?? "") && !family.has(raw.parent_conversation_id ?? "");
  });
}

/**
 * Chats the board has purged. On disk because the hook that writes a closed row back is a separate
 * process the board cannot wait for: a grace period lost the race whenever a hook ran slow, and a
 * chat Cursor only untabbed kept reporting turns for minutes, which put the row back for good. A
 * conversation id is never reused, so a purged chat can stay purged.
 * ponytail: newest ids only, which is many boards' worth of closes. Ceiling: closing more than this
 * between resets can let the oldest ghost back; upgrade path is pruning by the log's own contents.
 */
const TOMBSTONE_CAP = 200;

/** Kept beside the disk list so a workspace whose write fails is still covered for this session. */
const purgedHere = new Set<string>();

function readTombstones(root: string): string[] {
  try {
    const rows: unknown = JSON.parse(fs.readFileSync(runtimeFile(root, "purged.json"), "utf8"));
    return Array.isArray(rows) ? rows.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Not in RUNTIME_FILES: closing the last chat clears those, and that is when a ghost is likeliest. */
function rememberPurged(root: string, family: Set<string>): void {
  const kept = [...new Set([...readTombstones(root), ...family])].slice(-TOMBSTONE_CAP);
  try {
    fs.mkdirSync(runtimeDir(root), { recursive: true });
    fs.writeFileSync(runtimeFile(root, "purged.json"), JSON.stringify(kept, null, 2));
  } catch {
    /* the in-process set still hides the row until the window reloads */
  }
}

/** Every chat the board has closed, so no writer can put one back on the rail. */
export function purgedIds(root: string | undefined): Set<string> {
  return new Set([...purgedHere, ...(root ? readTombstones(root) : [])]);
}

/**
 * A closed session leaves nothing behind: its events, its notes and its state row go, and the last
 * session out removes the files. The board hides closed sessions anyway, so dropping the rows reads
 * the same on screen as marking them closed — without the shared log growing forever.
 */
export function purgeConversation(root: string | undefined, conversationId: string): void {
  if (!root) return;
  try {
    const state = readStateFile(root);
    const family = conversationFamily(state, conversationId);
    for (const id of family) purgedHere.add(id);
    rememberPurged(root, family);
    const eventsLeft = filterJsonl(runtimeFile(root, "events.jsonl"), (row) => {
      const raw = (row as HookEvent).raw ?? {};
      return !family.has(raw.conversation_id ?? "") && !family.has(raw.parent_conversation_id ?? "");
    });
    filterJsonl(runtimeFile(root, "context-handoffs.jsonl"), (row) => {
      const note = row as { fromConversationId?: string; to?: { conversationId?: string } };
      return !family.has(note.fromConversationId ?? "") && !family.has(note.to?.conversationId ?? "");
    });
    dropSessionSettings(root, family);
    if (!dropSessions(root, state, family) && !eventsLeft) {
      removeRuntimeFiles(root);
      // An empty log, not a missing one: a workspace with no log at all is a first run, and the
      // board answers a first run with the demo rail. Closing the last chat is not a first run.
      fs.writeFileSync(runtimeFile(root, "events.jsonl"), "");
    }
  } catch {
    /* the board still hides the session; the files are cleaned up on the next close */
  }
}
