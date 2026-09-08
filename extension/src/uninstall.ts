/**
 * Runs on uninstall via the `vscode:uninstall` script, in plain node with no vscode API and no
 * way to know which workspaces were used — so it drops the whole runtime tree at once. Workspace
 * files (hooks, personas, rules) are the user's; the board's "Remove Hooks And Data" command
 * clears those per workspace.
 */
import * as fs from "fs";
import { runtimeHome } from "./data/runtime-dir";

fs.rmSync(runtimeHome(), { recursive: true, force: true });
