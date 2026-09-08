/** Board actions on workspace files: open, attach, create and remove context or personas. */
import * as fs from "fs";
import * as vscode from "vscode";
import type { Role } from "../../model/roles";
import { attachFileToChat, runChatTask } from "../cursor-chat";
import {
  createContextCategory as createStoredContextCategory,
  removeContextCategory as removeStoredContextCategory,
  setContextCategory as setStoredContextCategory,
  toggleContextFavorite as toggleStoredContextFavorite,
} from "../../data/context-tabs";
import {
  createGlobalRule,
  CURSOR_RULES_COMMANDS,
  globalRuleFile,
  globalRules,
} from "../../data/global-rules";
import {
  contextItemFile,
  createContextFile,
  createPersona,
  deleteContextFile,
  isGuide,
  isWorkspaceContextPath,
  removePersona,
  workspaceContext,
  type CreateContextInput,
  type CreatePersonaInput,
} from "../../data/workspace-context";
import type { BoardHandlers } from "../messages";

/** Context and global-rule wiring for the webview, kept out of the board's own plumbing. */
export function contextHandlers(
  refresh: () => void,
  conversationId: () => string | undefined
): Pick<
  BoardHandlers,
  | "onFile"
  | "onOpenContext"
  | "onAttachContext"
  | "onDeleteContext"
  | "onToggleFavorite"
  | "onCreateCategory"
  | "onRemoveCategory"
  | "onOpenGlobalRule"
  | "onAttachGlobalRule"
  | "onOpenCursorRules"
  | "onCreateGlobalRule"
  | "onCreate"
> {
  return {
    onFile: (relPath, editable) => openContextFile(relPath, editable),
    onOpenContext: (itemId) => openContextItem(itemId),
    onAttachContext: (itemId) => attachContextItem(conversationId(), itemId),
    onDeleteContext: (itemId) => deleteContextItem(itemId, refresh),
    onToggleFavorite: (itemId) => toggleContextFavorite(itemId, refresh),
    onCreateCategory: (label) => createContextCategory(label, refresh),
    onRemoveCategory: (categoryId) => removeContextCategory(categoryId, refresh),
    onOpenGlobalRule: (itemId) => openGlobalRule(itemId),
    onAttachGlobalRule: (itemId) => attachGlobalRule(conversationId(), itemId),
    onOpenCursorRules: () => openCursorRules(),
    onCreateGlobalRule: (name, description) => addGlobalRule(name, description, refresh),
    onCreate: (input) => createContext(input, refresh),
  };
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function openContextFile(relPath: string, editable = false): void {
  if (!isWorkspaceContextPath(relPath)) return;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return;
  const uri = vscode.Uri.joinPath(root, relPath);
  if (!fs.existsSync(uri.fsPath)) return;
  void vscode.window.showTextDocument(uri, { preview: !editable });
}

function knownContextItem(itemId: string) {
  const context = workspaceContext(workspaceRoot());
  return [...context.alwaysOn, ...context.available].find((item) => item.id === itemId);
}

export function openContextItem(itemId: string): void {
  if (!knownContextItem(itemId)) return;
  const resolved = contextItemFile(workspaceRoot(), itemId);
  if (!resolved || !fs.existsSync(resolved.absPath)) return;
  void vscode.window.showTextDocument(vscode.Uri.file(resolved.absPath), { preview: true });
}

export function attachContextItem(
  conversationId: string | undefined,
  itemId: string
): void {
  if (!conversationId || !knownContextItem(itemId)) return;
  const resolved = contextItemFile(workspaceRoot(), itemId);
  if (!resolved || !fs.existsSync(resolved.absPath)) return;
  void runChatTask(async () => {
    await attachFileToChat(conversationId, resolved.absPath);
  });
}

export function deleteContext(relPath: string, refresh: () => void): void {
  void vscode.window.showWarningMessage(`Delete ${relPath}?`, { modal: true }, "Delete").then((choice) => {
    if (choice !== "Delete") return;
    if (!deleteContextFile(workspaceRoot(), relPath)) {
      void vscode.window.showWarningMessage(`Could not delete ${relPath}.`);
      return;
    }
    refresh();
  });
}

export function deleteContextItem(itemId: string, refresh: () => void): void {
  const item = knownContextItem(itemId);
  const resolved = contextItemFile(workspaceRoot(), itemId);
  if (!item || item.readonly || !resolved) {
    void vscode.window.showWarningMessage("Could not find that context file.");
    return;
  }
  deleteContext(resolved.relPath, refresh);
}

function knownGlobalRule(itemId: string): string | null {
  return globalRules().some((rule) => rule.id === itemId) ? globalRuleFile(itemId) : null;
}

export function openGlobalRule(itemId: string): void {
  const absPath = knownGlobalRule(itemId);
  if (absPath) void vscode.window.showTextDocument(vscode.Uri.file(absPath), { preview: false });
}

export function attachGlobalRule(conversationId: string | undefined, itemId: string): void {
  const absPath = conversationId && knownGlobalRule(itemId);
  if (!absPath || !conversationId) return;
  void runChatTask(async () => {
    await attachFileToChat(conversationId, absPath);
  });
}

/** Cursor's User Rules live in Customize, so hand the user off to its own editor. */
export function openCursorRules(): void {
  void (async () => {
    const available = await vscode.commands.getCommands(true);
    const command = CURSOR_RULES_COMMANDS.find((entry) => available.includes(entry));
    if (!command) {
      void vscode.window.showWarningMessage(
        "This build has no Customize editor. Open Cursor Settings → Rules instead."
      );
      return;
    }
    await vscode.commands.executeCommand(command);
  })();
}

export function addGlobalRule(name: string, description: string, refresh: () => void): void {
  const created = createGlobalRule(name, description);
  if (!created) {
    void vscode.window.showWarningMessage("Use a name with letters or numbers.");
    return;
  }
  refresh();
  void vscode.window.showTextDocument(vscode.Uri.file(created), { preview: false });
}

export function createContext(
  input: CreateContextInput,
  refresh: () => void
): void {
  const root = workspaceRoot();
  const created = createContextFile(root, input);
  if (created && input.categoryId) {
    setStoredContextCategory(root, `workspace:${created}`, input.categoryId, true);
  }
  refresh();
  if (created) openContextFile(created);
}

export function toggleContextFavorite(itemId: string, refresh: () => void): void {
  if (!knownContextItem(itemId)) return;
  if (toggleStoredContextFavorite(workspaceRoot(), itemId)) refresh();
}

export function createContextCategory(label: string, refresh: () => void): void {
  if (!createStoredContextCategory(workspaceRoot(), label)) {
    void vscode.window.showWarningMessage("Use a unique category name.");
    return;
  }
  refresh();
}

export function removeContextCategory(categoryId: string, refresh: () => void): void {
  if (removeStoredContextCategory(workspaceRoot(), categoryId)) refresh();
}

export function addPersona(input: CreatePersonaInput, refresh: () => void): void {
  const created = createPersona(workspaceRoot(), input);
  refresh();
  if (created) {
    openContextFile(created);
    return;
  }
  void vscode.window.showWarningMessage(
    "Could not add persona. Use a unique kebab-case role (e.g. code-reviewer)."
  );
}

export function dropPersona(role: Role, refresh: () => void): void {
  // Modal like every other destructive confirm here: a toast behind the sidebar reads as a dead ×.
  void vscode.window.showWarningMessage(`Remove ${role} from the team?`, { modal: true }, "Remove").then((choice) => {
    if (choice !== "Remove") return;
    if (!removePersona(workspaceRoot(), role)) {
      void vscode.window.showWarningMessage(
        "Could not remove persona. It needs a saved roster to be removed from, not the preview list."
      );
      return;
    }
    refresh();
    if (isGuide(role)) {
      void vscode.window.showInformationMessage(
        "Onboarding is gone. Bring it back with Context Manager: Restore onboarding."
      );
    }
  });
}
