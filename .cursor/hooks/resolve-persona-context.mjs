#!/usr/bin/env node
/** One hook process: resolve the scrum persona and deliver unread handoffs as additional_context. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PERSONA,
  isRoleId,
  mapRole,
  personaTitle,
  readJson,
  readText,
  runtimeDir,
} from "./update-agent-state.mjs";

const DIR = runtimeDir();
const STATE_FILE = path.join(DIR, "current-state.json");
const HANDOFFS_FILE = path.join(DIR, "context-handoffs.jsonl");
const PENDING_FILE = path.join(DIR, "pending-role.json");
/** The only role map: user-owned, in the workspace. The extension never seeds one. */
const ROLE_MAP_FILE = path.join(".cursor", "agent-viz", "role-map.json");

/**
 * The guide has no project charter to read, so its brief travels with the identity: without it the
 * chat introduced itself as whatever implementer role the old built-in roster listed first.
 */
const GUIDE_BRIEF =
  "Your role is Onboarding. You are Context Manager's introduction guide, not an implementer: explain the board and help the user get a team started. Mapping this repo into personas is the Project Manager's job, not yours — that persona reads the declared context (.cursor/rules, .cursor/skills, .cursor/workflows, .cursor/personas, AGENTS.md) against how the repo is actually laid out and proposes a roster. If the user would rather you looked yourself, read both with the file and terminal tools rather than assuming, and say where the declared context no longer matches the code. Never describe yourself as building components or features, and ask before writing any file.";

/**
 * What the project already declares, so the guide never offers a team it can see. Coarse on
 * purpose: a file per persona or one charter listing several both count as a roster.
 *
 * ponytail: presence, not a parsed roster — the guide only needs to know whether to offer the
 * Project Manager or point at that card. The upgrade path is the extension's own persona discovery.
 */
function rosterBrief() {
  const dir = path.join(".cursor", "personas");
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => /\.(md|mdc)$/i.test(name))
    : [];
  if (!files.length) {
    return " This project declares no personas yet, so the team you offer is its first: propose the Project Manager and ask before writing the file.";
  }
  const text = files.map((name) => readText(path.join(dir, name))).join("\n");
  const hasManager =
    files.some((name) => /^project-manager\.(md|mdc)$/i.test(name)) ||
    /^id:\s*project-manager\s*$/im.test(text) ||
    /^#{2,4}\s+project[-\s]manager\s*$/im.test(text) ||
    /^\s*[-*]\s+`?project-manager`?[\s—–:-]/im.test(text);
  if (hasManager) {
    const name = personaName("project-manager");
    return ` This project already has a roster in .cursor/personas, including a Project Manager${
      name ? ` (${name})` : ""
    } who owns the mapping, the delegation, and the roster itself. Do not offer to create one and do not propose a roster of your own: point the user at that card on Team, and offer to hand that persona a note when they want roster work done.`;
  }
  return " This project already declares personas in .cursor/personas, so do not propose a roster of your own. No persona owns the mapping and delegation yet, so the Project Manager is the one addition you may offer — ask before writing the file.";
}

/** A persona has one name across its card, chats, and projects until its source changes. */
function personaName(id) {
  const dir = path.join(".cursor", "personas");
  if (!fs.existsSync(dir)) return undefined;
  for (const fileName of fs.readdirSync(dir)) {
    const text = readText(path.join(dir, fileName));
    const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? "";
    const declaredId =
      frontmatter.match(/^id:\s*(.+)$/m)?.[1]?.trim() ||
      fileName.replace(/\.(md|mdc)$/i, "");
    if (declaredId === id) {
      return frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() || undefined;
    }
    const sections = text.split(/^#{2,4}\s+/m).slice(1);
    for (const section of sections) {
      const [heading = "", ...body] = section.split("\n");
      const sectionId = heading
        .replace(/[`*]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      if (sectionId !== id) continue;
      return body.join("\n").match(/^\s*[-*]\s+Display name:\s*(.+)$/im)?.[1]?.trim() || undefined;
    }
  }
  return undefined;
}

/** Which persona owns this hook call: a subagent chat, a subagent run, or the session itself. */
export function resolvePersona(input, state, roleMap, pendingRole) {
  const conversationId = input.conversation_id ?? "";
  const subagentType = input.subagentType ?? input.subagent_type ?? "";
  const subRun = state.subagentConversations?.[conversationId];
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const parentId =
    subRun?.parentConversationId ?? input.parent_conversation_id ?? conversationId;
  const session = sessions.find((row) => row.conversationId === parentId);
  const workingWith = (session?.subagents ?? [])
    .filter((child) => child.status === "working")
    .map((child) => `${child.role} (${child.type})`)
    .join(", ");

  // Only a chat the board started wears a persona. A chat Cursor opened on its own has no role
  // here, and defaulting it to the guide made every ordinary chat in the workspace answer as the
  // board — including the subagents it launched. No role, no identity, no notes.
  const claimed = isRoleId(pendingRole) && !session;
  const role = !session?.role && !claimed
    ? ""
    : (subRun?.status === "working" ? subRun.role : "") ||
      (subagentType
        ? session?.subagents?.find((row) => row.type === subagentType)?.role ??
          mapRole(subagentType, roleMap)
        : "") ||
      session?.role ||
      (isRoleId(pendingRole) ? pendingRole : "");

  return {
    persona: role,
    title: role ? personaTitle(role) : "",
    subagent: subagentType || (subRun?.status === "working" ? subRun.type : ""),
    workingWith,
    parentId,
    session,
  };
}

/** Board ordinal for this chat; empty when it is the only open session of this persona and index is 1. */
export function sessionInstanceBrief(session, sessions) {
  const n = session?.instanceIndex;
  if (!n || !session.role) return "";
  const rows = Array.isArray(sessions) ? sessions : [];
  const openSiblings = rows.filter(
    (row) =>
      row.conversationId !== session.conversationId &&
      row.role === session.role &&
      row.status !== "closed"
  );
  if (n <= 1 && !openSiblings.length) return "";
  const others = openSiblings
    .map((row) => (row.instanceIndex ? `session ${row.instanceIndex}` : "another session"))
    .join(", ");
  let line = ` You are session ${n} of this persona (board label).`;
  if (others) line += ` Other open sessions of this persona: ${others}.`;
  return line;
}

/**
 * Unread notes addressed to this chat, marked read once handed over. `sessionOnly` is the stop
 * lane: a note waiting for a subagent must not be spoken aloud in its parent chat.
 */
export function takeHandoffs(input, state, parentId, sessionOnly = false) {
  const conversationId = input.conversation_id ?? "";
  const subagentType = input.subagentType ?? input.subagent_type ?? "";
  const subRun = state.subagentConversations?.[conversationId];
  const working = (state.sessions ?? [])
    .find((row) => row.conversationId === parentId)
    ?.subagents?.filter((row) => row.status === "working")
    .map((row) => row.type) ?? [];

  const entries = readText(HANDOFFS_FILE)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const mine = entries.filter((row) => {
    if (row.read) return false;
    const to = row.to ?? {};
    if (to.kind === "session") return to.conversationId === conversationId;
    if (to.kind !== "subagent" || sessionOnly) return false;
    if (to.conversationId !== conversationId && to.conversationId !== parentId) return false;
    return (
      to.subagentType === subagentType ||
      to.subagentType === subRun?.type ||
      (!subagentType && working.includes(to.subagentType))
    );
  });
  if (!mine.length) return [];

  const taken = new Set(mine.map((row) => row.id));
  fs.writeFileSync(
    HANDOFFS_FILE,
    `${entries
      .map((row) => JSON.stringify(taken.has(row.id) ? { ...row, read: true } : row))
      .join("\n")}\n`
  );
  return mine;
}

/** A chat writing to itself is the board asking for something (delegate a subagent), not a peer. */
function fromBoard(row, conversationId) {
  return row.to?.kind === "session" && row.fromConversationId === conversationId;
}

/** The sender already read these, so the receiver can open them directly instead of searching. */
function senderFiles(row) {
  return row.files?.length
    ? ` Sender already worked in: ${row.files.join(", ")} — start from these rather than searching the repo.`
    : "";
}

function handoffLine(row, conversationId) {
  if (fromBoard(row, conversationId)) return `Board request: ${row.text}`;
  const target = row.to?.kind === "subagent" ? ` as the ${row.to.role} subagent` : "";
  return `${row.fromRole ?? "another chat"} handed off${target}: ${row.text}${senderFiles(row)}`;
}

/** Spoken in the target chat as a real message, so it reads like one agent addressing another. */
export function followupLine(row, conversationId) {
  if (fromBoard(row, conversationId)) return `Board request: ${row.text}`;
  return `Handoff from ${row.fromRole ? `the ${row.fromRole}` : "another chat"}: ${row.text}${senderFiles(row)}`;
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  // The log hook appends this event and refreshes the state file before this hook runs, so
  // recomputing it here only re-read the whole log — and could spend a pending role click that
  // belongs to the chat the board is still creating. Anything missing has a fallback below.
  const state = readJson(STATE_FILE, {});
  const roleMap = readJson(ROLE_MAP_FILE, {});
  const pendingRole = readJson(PENDING_FILE, null)?.role;
  const { persona, title, subagent, workingWith, parentId, session } = resolvePersona(
    input,
    state,
    roleMap,
    pendingRole
  );

  const hook = input.hook_event_name ?? "";
  // A chat that just finished a turn can be spoken to: Cursor submits followup_message as a real
  // message there. Taking the note marks it read, which is also what stops a handoff ping-pong.
  if (hook === "stop") {
    // A submitOnly note had one chance to ride a real submit as hidden context. Taking it here
    // without speaking it is what keeps the walkthrough to one introduction: the turn that missed
    // it ends the note rather than repeating the introduction out loud.
    const spoken = takeHandoffs(input, state, parentId, true).filter((row) => !row.submitOnly);
    const here = input.conversation_id ?? "";
    process.stdout.write(
      spoken.length
        ? JSON.stringify({
            followup_message: spoken.map((row) => followupLine(row, here)).join("\n\n"),
          })
        : "{}"
    );
    return;
  }

  // Only turns consume notes; navigation and tool hooks must not swallow them. A resume submits no
  // text — that is the board nudging an idle chat, and it takes the note here rather than leaving it
  // for stop: waiting cost a whole turn whose only content was the target saying it would look.
  const notes =
    hook === "beforeSubmitPrompt" || hook === "subagentStart"
      ? takeHandoffs(input, state, parentId)
      : [];

  // No persona means Cursor opened this chat itself, and the scrum identity would be poison there.
  // A note the user addressed to it from the board is still delivered: that one they asked for.
  let context = "";
  if (persona) {
    context = `SCRUM IDENTITY (required): In this repo you are the **${persona}** persona — ${title}.`;
    if (persona === DEFAULT_PERSONA) context += ` ${GUIDE_BRIEF}${rosterBrief()}`;
    else {
      const name = personaName(persona);
      if (name) context += ` Your name is ${name}.`;
    }
    context += sessionInstanceBrief(session, state.sessions);
    if (subagent) context += ` Active subagent: ${subagent}.`;
    if (workingWith) context += ` Working with: ${persona} → ${workingWith}.`;
    context += ` ${persona} is the active persona. This identity is authoritative even if another chat updates the global board state. When the user asks who you are or who is working, answer from this injected identity first. Never mention internal IDs in persona answers. Do NOT lead with model vendor or model name (Grok, Claude, GPT, Auto, SpaceXAI, etc.) unless they explicitly ask which model is running.`;
  }
  if (notes.length) {
    const here = input.conversation_id ?? "";
    context += `${context ? " " : ""}SESSION HANDOFF (act on this now): ${notes
      .map((row) => handoffLine(row, here))
      .join(" | ")}`;
  }

  process.stdout.write(context ? JSON.stringify({ additional_context: context }) : "{}");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
