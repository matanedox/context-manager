import * as vscode from "vscode";
import { ScrumBoard } from "./host/board";
import { ScrumBoardProvider, VIEW_ID } from "./host/board-provider";
import { restoreGuide } from "./data/personas";

/** A removed Onboarding card leaves nothing to click, so the way back is a command rather than the board. */
function bringBackGuide(board: ScrumBoard): void {
  const restored = restoreGuide(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  board.refreshAll();
  void vscode.window.showInformationMessage(
    restored ? "Onboarding is back on the Team roster." : "Onboarding is already on the Team roster."
  );
}

async function openBoard(board: ScrumBoard): Promise<void> {
  try { await vscode.commands.executeCommand("workbench.view.extension.contextManager"); }
  catch { /* sidebar may not be registered yet */ }
  board.refreshAll();
}

export function activate(context: vscode.ExtensionContext) {
  console.log("[agent-context] activated");
  const board = new ScrumBoard(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, new ScrumBoardProvider(board), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("contextManager.openBoard", () => openBoard(board)),
    vscode.commands.registerCommand("contextManager.installHooks", () => board.installHooks()),
    vscode.commands.registerCommand("contextManager.restoreGuide", () => bringBackGuide(board)),
    vscode.commands.registerCommand("contextManager.removeAll", () => void board.removeAll())
  );
}

export function deactivate() {}
