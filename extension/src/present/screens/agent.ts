/** Agent screen: one chat in detail — its facts, files, activity log, and talk targets. */
import { buildContextTabs } from "../../data/context-tabs";
import type { ContextTab } from "../../data/context-tabs";
import type { GlobalRule } from "../../data/global-rules";
import { collaboratorsFor } from "../../data/handoffs";
import type { Collaborator } from "../../data/handoffs";
import { personaDisplayName } from "../../data/personas";
import { GUIDE_PERSONA, linkedContextForPersona } from "../../data/workspace-context";
import type { WorkspaceContext } from "../../data/workspace-context";
import type { BoardSnapshot } from "../../data/snapshot";
import { eventType, subagentType } from "../../model/events";
import { mapRole, roleLabel } from "../../model/roles";
import { tokenBudgetField } from "../../model/token-budget";
import type { Role } from "../../model/roles";
import type { HookEvent } from "../../model/types";
import { activityDescription, contextMeter, contextSummary, type ContextMeter } from "../copy";
import { personaName, personaTitle } from "../persona";
import type { Selection } from "../selection";

export type AgentScreen = {
  collaborators: Collaborator[];
  facts: string[];
  contextMeter?: ContextMeter;
  /** The spend cap for this chat as the field shows it (`80k`, `5M`), or absent for no cap. */
  contextLimitField?: string;
  /** When set, auto-continue into a fresh session when this chat hits the cap. */
  autoContinueOnLimit?: boolean;
  canSetLimit: boolean;
  selectedConversationId?: string;
  files: string[];
  log: Array<{ ts: string; text: string; hot: boolean }>;
  selectedRole: Role;
  roleTitle: string;
  selectedPersona: {
    id: string;
    roleLabel: string;
    name?: string;
    title: string;
    description: string;
    charterPath: string | null;
    linked: Array<{ label: string; path: string; type: string }>;
  };
  context: WorkspaceContext;
  contextTabs: ContextTab[];
  globalRules: GlobalRule[];
};

/** Only the tail is painted, so one busy session cannot grow the rendered HTML without bound. */
const LOG_EVENTS = 120;

/** Board + hook both emit sessionStart; show one line in the activity log. */
function activityLog(
  events: HookEvent[],
  parent: Role,
  roleMap: Record<string, string>,
  busyRoles: Set<Role>,
  names: Partial<Record<Role, string>>,
) {
  const seenStart = new Set<string>();
  return events.slice(-LOG_EVENTS).flatMap((ev) => {
    const id = ev.raw?.conversation_id;
    if (eventType(ev) === "sessionStart" && id) {
      if (seenStart.has(id)) return [];
      seenStart.add(id);
    }
    const mapped = mapRole(subagentType(ev), roleMap) ?? parent;
    return {
      ts: ev.ts ?? "?",
      text: activityDescription(ev, parent, roleMap, names),
      hot: busyRoles.has(mapped),
    };
  });
}

function statusLabel(status: string | undefined): string {
  if (!status) return "";
  if (status === "working") return "Working";
  if (status === "failed") return "Failed";
  if (status === "closed") return "Closed";
  return "Idle";
}

export function buildAgent(snapshot: BoardSnapshot, selection: Selection): AgentScreen {
  const { context, roleMap, handoffs } = snapshot;
  const { selected, openSessions, events, busyRoles } = selection;
  const summary = contextSummary(events);
  const limit = selected?.contextLimitTokens;
  const facts = [
    selected ? `Status: ${statusLabel(selected.status)}` : "",
    summary.model ? `Model: ${summary.model}` : "",
    summary.composerMode ? `Mode: ${summary.composerMode}` : "",
    `Tool calls: ${summary.toolCalls}`,
    summary.endReason ? `Ended: ${summary.endReason.replace(/_/g, " ")}` : "",
  ].filter(Boolean);
  // A selected chat with no assignment reads as Onboarding, matching the rail and the
  // identity the hooks inject; the roster's first persona is only the no-selection default.
  const role = (selected ? (selected.role ?? GUIDE_PERSONA.id) : context.personas[0]?.id) ?? GUIDE_PERSONA.id;
  const persona = context.personas.find((item) => item.id === role);
  const roleNames = Object.fromEntries(
    context.personas.map((entry) => [entry.id, roleLabel(entry.id, entry.title)]),
  ) as Record<Role, string>;
  const activityNames = Object.fromEntries(
    context.personas.map((entry) => [entry.id, personaDisplayName(entry) ?? roleLabel(entry.id, entry.title)]),
  ) as Partial<Record<Role, string>>;

  return {
    collaborators: selected && snapshot.root ? collaboratorsFor(selected, openSessions, handoffs, roleNames) : [],
    facts,
    contextMeter: contextMeter(summary, selected?.contextLimitTokens),
    contextLimitField: limit != null && limit > 0 ? tokenBudgetField(limit) : undefined,
    autoContinueOnLimit: Boolean(selected?.autoContinueOnLimit),
    canSetLimit: Boolean(selected) && !snapshot.usingDemo,
    selectedConversationId: selected?.conversationId,
    files: summary.files,
    log: activityLog(events, selected?.role ?? GUIDE_PERSONA.id, roleMap, busyRoles, activityNames),
    selectedRole: role,
    roleTitle: personaTitle(context, role),
    selectedPersona: {
      id: role,
      roleLabel: roleLabel(role, persona?.title),
      name: personaName(role, persona ? personaDisplayName(persona) : undefined),
      title: persona?.title ?? roleLabel(role),
      description: persona?.description ?? "",
      charterPath: snapshot.charterPaths[role] ?? null,
      linked: linkedContextForPersona(context, role).map((item) => ({
        label: item.label,
        path: item.path,
        type: item.type,
      })),
    },
    context,
    contextTabs: buildContextTabs(context, selected?.role ?? undefined),
    globalRules: snapshot.globalRules,
  };
}
