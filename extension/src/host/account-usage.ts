/** Poll Cursor account usage and open login when the IDE session cookie is missing. */
import * as vscode from "vscode";
import { CURSOR_LOGIN_URL, CURSOR_USAGE_URL } from "../data/cursor-session";
import { formatUsage } from "../data/cursor-usage";
import { loadAccountUsage } from "../data/cursor-account";
import type { AccountUsageView } from "../present/ui";

const POLL_MS = 30 * 60 * 1000;

export class AccountUsageFeed {
  view: AccountUsageView = { kind: "loading" };
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly paint: () => void) {}

  start(): void {
    if (this.timer) return;
    void this.reload(false);
    this.timer = setInterval(() => void this.reload(false), POLL_MS);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  connect(): void {
    void this.reload(true);
  }

  refresh(): void {
    void this.reload(false);
  }

  openDashboard(): void {
    void vscode.env.openExternal(vscode.Uri.parse(CURSOR_USAGE_URL));
  }

  private async reload(openLoginIfNeeded: boolean): Promise<void> {
    if (this.view.kind !== "ready") {
      this.view = { kind: "loading" };
      this.paint();
    }
    const loaded = await loadAccountUsage();
    if (openLoginIfNeeded && loaded.kind === "needsAuth") {
      await vscode.env.openExternal(vscode.Uri.parse(CURSOR_LOGIN_URL));
    }
    this.view =
      loaded.kind === "ready" ? { kind: "ready", ...formatUsage(loaded.reading) } : loaded;
    this.paint();
  }
}
