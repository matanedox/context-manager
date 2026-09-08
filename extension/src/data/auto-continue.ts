/** When a chat passes its token budget, start a briefed replacement once. */
import * as fs from "fs";
import * as path from "path";
import { patchSessionSettings, readSessionSettings, sessionContextLimit } from "./io";
import { runtimeFile } from "./runtime-dir";

export function shouldAutoContinue(
  session: {
    autoContinueOnLimit?: boolean;
    autoContinuedTo?: string;
    contextLimitTokens?: number;
    status: string;
  },
  overLimit: boolean,
  /**
   * Whether the session did anything a brief can carry. A chat that ran no tool and touched no file
   * spent its budget on setup and handoffs, so rolling it bought a recap turn, an empty brief and a
   * sibling note for nothing.
   *
   * ponytail: such a chat simply stays over its cap. Ceiling: work that lived only in the
   * conversation is never rolled, because the board cannot read a conversation — the user rolls
   * that one by hand.
   */
  didWork = true,
): boolean {
  if (!didWork) return false;
  if (!session.autoContinueOnLimit) return false;
  if (session.autoContinuedTo) return false;
  if (session.contextLimitTokens == null || session.contextLimitTokens <= 0) return false;
  if (session.status === "working" || session.status === "closed") return false;
  return overLimit;
}

export function recapPath(root: string, conversationId: string): string {
  return runtimeFile(root, path.join("briefs", `${conversationId}.md`));
}

export function ensureRecapDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function recapRequestText(filePath: string): string {
  // Spelled out as a file write: "Path: …" read as a reference, and the chat answered in the
  // composer instead, so the replacement waited out the poll and continued on the log brief alone.
  return (
    `This session reached its token budget. Create the file ${filePath} and write a short recap ` +
    `into it covering the goal, what is done, what is left, and the files that matter, then stop. ` +
    `Write the file — an answer in chat is not read. Do not continue the original task.`
  );
}

export function readRecap(filePath: string): string | undefined {
  try {
    const text = fs.readFileSync(filePath, "utf8").trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ponytail: bounded poll; a slow recap is dropped and the log brief still continues. */
export async function waitForRecap(filePath: string, timeoutMs = 8000): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = readRecap(filePath);
    if (text) return text;
    await sleep(200);
  }
  return readRecap(filePath);
}

export const AUTO_CONTINUE_PENDING = "pending";

/** Checkbox beside the cap. A session with no cap cannot auto-continue. */
export function setSessionAutoContinue(root: string | undefined, conversationId: string, enabled: boolean): boolean {
  const limit = sessionContextLimit(root, conversationId);
  return patchSessionSettings(root, conversationId, (settings) => {
    if (!enabled || limit == null || limit <= 0) delete settings.autoContinueOnLimit;
    else settings.autoContinueOnLimit = true;
  });
}

/** Claim this chat so a refresh cannot open a second replacement. */
export function claimAutoContinue(root: string | undefined, conversationId: string): boolean {
  if (!root || !conversationId) return false;
  if (readSessionSettings(root)[conversationId]?.autoContinuedTo) return false;
  return patchSessionSettings(root, conversationId, (settings) => {
    settings.autoContinuedTo = AUTO_CONTINUE_PENDING;
  });
}

/** Start failed: allow another attempt. */
export function unclaimAutoContinue(root: string | undefined, conversationId: string): boolean {
  return patchSessionSettings(root, conversationId, (settings) => {
    if (settings.autoContinuedTo === AUTO_CONTINUE_PENDING) delete settings.autoContinuedTo;
  });
}

/**
 * Point the full session at its replacement and carry the cap onto the new chat.
 *
 * The checkbox is deliberately not carried. A limit smaller than one turn costs — 48k against
 * turns billing 150k and up — puts the replacement over the moment it answers, so copying the flag
 * rolled the same persona over once a minute in an unbounded chain. One tick buys one replacement,
 * which is what the help panel has always claimed.
 */
export function finishAutoContinue(
  root: string | undefined,
  fromConversationId: string,
  toConversationId: string,
): boolean {
  if (!root || !fromConversationId || !toConversationId) return false;
  const from = readSessionSettings(root)[fromConversationId];
  if (!from) return false;
  const carried = patchSessionSettings(root, toConversationId, (settings) => {
    if (from.contextLimitTokens != null && from.contextLimitTokens > 0) {
      settings.contextLimitTokens = from.contextLimitTokens;
    }
  });
  return (
    carried &&
    patchSessionSettings(root, fromConversationId, (settings) => {
      settings.autoContinuedTo = toConversationId;
    })
  );
}
