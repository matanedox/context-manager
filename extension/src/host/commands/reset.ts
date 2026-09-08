/** The board's two destructive commands: repair, which wipes then reinstalls, and remove-all. */
import * as vscode from "vscode";
import { repairHooks, uninstallHooks } from "../../data/hooks-install";
import { resetWalkthrough } from "../../data/intro";
import { openConversationIds, removeRuntimeState } from "../../data/purge";
import { readSnapshot } from "../../data/snapshot";
import { archiveChat, runChatTask } from "../cursor-chat";

const KEPT = "Personas, rules, skills and workflows are left alone.";

/** Archive the chats the board opened, then drop everything it saved outside the workspace. */
async function wipe(root: string | undefined, extensionPath: string, usingDemo: boolean): Promise<void> {
  const open = openConversationIds(readSnapshot(root, extensionPath).state.sessions, usingDemo);
  await runChatTask(async () => {
    for (const conversationId of open) await archiveChat(conversationId);
  });
  removeRuntimeState(root);
  resetWalkthrough();
}

/**
 * Repair is also the reset, so it stays reachable on a healthy install: the board's chats are
 * archived and its saved state dropped before the hooks go back in clean.
 */
export async function repairInstall(
  root: string | undefined,
  extensionPath: string,
  usingDemo: boolean,
): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `Reinstall agent hooks? This closes every open session and clears all saved board data. ${KEPT}`,
    { modal: true },
    "Reinstall",
  );
  if (choice !== "Reinstall") return false;
  await wipe(root, extensionPath, usingDemo);
  return repairHooks(root, extensionPath);
}

/** Everything the board put on disk: hook wiring in the workspace, session state outside it. */
export async function removeEverything(
  root: string | undefined,
  extensionPath: string,
  usingDemo: boolean,
): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `Remove the Scrum board's hooks and all session data? ${KEPT}`,
    { modal: true },
    "Remove",
  );
  if (choice !== "Remove") return false;
  const removed = uninstallHooks(root);
  await wipe(root, extensionPath, usingDemo);
  void vscode.window.showInformationMessage(
    `Removed ${removed.length} hook file${removed.length === 1 ? "" : "s"} and all board session data.`,
  );
  return true;
}
