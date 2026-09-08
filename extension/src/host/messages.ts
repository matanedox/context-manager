/** Webview → extension message routing for the board. */
import * as vscode from "vscode";
import { isRole, type Role } from "../model/roles";
import type { HandoffTargetKind } from "../data/handoffs";
import type { CreateContextInput, CreatePersonaInput } from "../data/workspace-context";

export type BoardHandlers = {
  onReady: () => void;
  onRole: (role: Role) => void;
  onSession: (conversationId: string) => void;
  onFocusChat: (conversationId?: string) => void;
  onCloseSession: (conversationId: string) => void;
  onClearActivity: () => void;
  onSendHandoff: (input: {
    kind: HandoffTargetKind;
    role: Role;
    conversationId?: string;
    subagentType?: string;
    text: string;
  }) => void;
  onFile: (relPath: string, editable?: boolean) => void;
  onOpenContext: (itemId: string) => void;
  onAttachContext: (itemId: string) => void;
  onDeleteContext: (itemId: string) => void;
  onToggleFavorite: (itemId: string) => void;
  onCreateCategory: (label: string) => void;
  onRemoveCategory: (categoryId: string) => void;
  onOpenGlobalRule: (itemId: string) => void;
  onAttachGlobalRule: (itemId: string) => void;
  onOpenCursorRules: () => void;
  onCreateGlobalRule: (name: string, description: string) => void;
  onCreate: (input: CreateContextInput) => void;
  onCreatePersona: (input: CreatePersonaInput) => void;
  onRemovePersona: (role: Role) => void;
  onRepairHooks: () => void;
  onBack: () => void;
  onSetSessionLimit: (conversationId: string, limit: string) => void;
  onSetAutoContinue: (conversationId: string, enabled: boolean) => void;
  onContinueSession: () => void;
  onConnectUsage: () => void;
  onRefreshUsage: () => void;
  onOpenUsageDashboard: () => void;
};

type BoardMessage = {
  type?: string;
  role?: string;
  conversationId?: string;
  path?: string;
  itemId?: string;
  categoryId?: string;
  label?: string;
  kind?: CreateContextInput["kind"];
  name?: string;
  description?: string;
  alwaysOn?: boolean;
  personas?: string[];
  editable?: boolean;
  targetKind?: HandoffTargetKind;
  subagentType?: string;
  text?: string;
  limit?: string;
  autoContinue?: boolean;
};

export function bindMessages(webview: vscode.Webview, handlers: BoardHandlers): void {
  webview.onDidReceiveMessage((msg: BoardMessage) => {
    if (msg.type === "ready") return handlers.onReady();
    if (msg.type === "back") return handlers.onBack();
    if (msg.type === "repairHooks") return handlers.onRepairHooks();
    if (msg.type === "clearActivity") return handlers.onClearActivity();
    if (msg.type === "selectSession") {
      if (msg.conversationId) handlers.onSession(msg.conversationId);
      return;
    }
    if (msg.type === "focusChat") return handlers.onFocusChat(msg.conversationId);
    if (msg.type === "closeSession") {
      if (msg.conversationId) handlers.onCloseSession(msg.conversationId);
      return;
    }
    if (msg.type === "sendHandoff" && isRole(msg.role) && msg.text?.trim()) {
      handlers.onSendHandoff({
        kind: msg.targetKind ?? "role",
        role: msg.role,
        conversationId: msg.conversationId,
        subagentType: msg.subagentType,
        text: msg.text.trim(),
      });
      return;
    }
    if (msg.type === "openFile") {
      if (msg.path) handlers.onFile(msg.path, Boolean(msg.editable));
      return;
    }
    if (msg.type === "openContext") {
      if (msg.itemId) handlers.onOpenContext(msg.itemId);
      return;
    }
    if (msg.type === "attachContext") {
      if (msg.itemId) handlers.onAttachContext(msg.itemId);
      return;
    }
    if (msg.type === "deleteContext") {
      if (msg.itemId) handlers.onDeleteContext(msg.itemId);
      return;
    }
    if (msg.type === "toggleFavorite") {
      if (msg.itemId) handlers.onToggleFavorite(msg.itemId);
      return;
    }
    if (msg.type === "createContextCategory") {
      if (msg.label?.trim()) handlers.onCreateCategory(msg.label.trim());
      return;
    }
    if (msg.type === "removeContextCategory") {
      if (msg.categoryId) handlers.onRemoveCategory(msg.categoryId);
      return;
    }
    if (msg.type === "openGlobalRule") {
      if (msg.itemId) handlers.onOpenGlobalRule(msg.itemId);
      return;
    }
    if (msg.type === "attachGlobalRule") {
      if (msg.itemId) handlers.onAttachGlobalRule(msg.itemId);
      return;
    }
    if (msg.type === "openCursorRules") return handlers.onOpenCursorRules();
    if (msg.type === "createGlobalRule") {
      if (msg.name?.trim()) handlers.onCreateGlobalRule(msg.name.trim(), msg.description ?? "");
      return;
    }
    if (msg.type === "createContext") {
      if (msg.kind && msg.name) {
        handlers.onCreate({
          kind: msg.kind,
          name: msg.name,
          description: msg.description ?? "",
          alwaysOn: Boolean(msg.alwaysOn),
          personas: msg.personas,
          categoryId: msg.categoryId,
        });
      }
      return;
    }
    if (msg.type === "createPersona" && msg.role) {
      handlers.onCreatePersona({
        role: msg.role,
        description: msg.description ?? "",
        name: msg.name ?? "",
      });
      return;
    }
    if (msg.type === "removePersona" && isRole(msg.role)) handlers.onRemovePersona(msg.role);
    if (msg.type === "openChat" && isRole(msg.role)) handlers.onRole(msg.role);
    if (msg.type === "setSessionLimit" && msg.conversationId) {
      handlers.onSetSessionLimit(msg.conversationId, msg.limit ?? "");
    }
    if (msg.type === "setAutoContinue" && msg.conversationId) {
      handlers.onSetAutoContinue(msg.conversationId, Boolean(msg.autoContinue));
    }
    if (msg.type === "continueSession") handlers.onContinueSession();
    if (msg.type === "connectUsage") handlers.onConnectUsage();
    if (msg.type === "refreshUsage") handlers.onRefreshUsage();
    if (msg.type === "openUsageDashboard") handlers.onOpenUsageDashboard();
  });
}
