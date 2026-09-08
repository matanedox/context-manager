import * as vscode from "vscode";
import type { Role } from "../model/roles";
import { addPersona, contextHandlers, dropPersona } from "./commands/actions";
import { planHandoff, type HandoffInput } from "./commands/handoff";
import { startRoleSession } from "./commands/session-start";
import { confirmSecondSession, continuationBrief } from "./commands/session-open";
import { BoardWatcher } from "../data/watch";
import { focusChat, nudgeChat, openChat, runChatTask } from "./cursor-chat";
import { closeSession, reapClosedSessions, type CloseHost } from "./commands/close";
import { loadWebviewHtml, webviewRoots } from "./html";
import { InlineLoading } from "./inline-loading";
import { workspaceContext } from "../data/workspace-context";
import { setSessionAutoContinue } from "../data/auto-continue";
import { bindMessages } from "./messages";
import { setSessionContextLimitField } from "../data/io";
import { clearConversationActivity } from "../data/purge";
import { readSnapshot } from "../data/snapshot";
import { viewModel, type Page } from "../present/view-model";
import { AccountUsageFeed } from "./account-usage";
import {
  installHooks as runInstallHooks,
  openWalkthrough,
  removeAll as runRemoveAll,
  warnMissingHooks,
} from "./commands/board-lifecycle";
import { queueAutoContinue } from "./commands/session-rollover";

export const VIEW_ID = "contextManager.board";
export type { Page };
export class ScrumBoard {
  private webviews = new Map<vscode.Webview, (title: string) => void>();
  private selectedConversationId?: string;
  private hooksOffered = false;
  private lastPaint = 0;
  /** The board is showing the bundled demo, so its session rows name no real chat. */
  private usingDemo = false;
  private pinningConversationId?: string;
  private autoContinuing = false;
  private readonly loading = new InlineLoading(() => this.refreshAll());
  private readonly watcher = new BoardWatcher();
  private readonly usage = new AccountUsageFeed(() => this.refreshAll());
  // ponytail: only a click changes the page; a background session start must not yank the sidebar.
  private page: Page = "team";
  constructor(private readonly context: vscode.ExtensionContext) {}

  attach(webview: vscode.Webview, setTitle: (title: string) => void): void {
    const roots = webviewRoots(this.context.extensionUri);
    webview.options = { enableScripts: true, localResourceRoots: roots };
    this.webviews.set(webview, setTitle);
    const refresh = () => this.refreshAll();
    bindMessages(webview, {
      onReady: () => void this.pushAll().then(() => warnMissingHooks(this.lifecycle(), workspaceRoot())).then(() => openWalkthrough(this.lifecycle(), workspaceRoot())),
      onRole: (role) => void this.openPersonaSession(role),
      onSession: (conversationId) => this.selectSession(conversationId),
      onFocusChat: (conversationId) => this.focusSelected(conversationId),
      onCloseSession: (conversationId) => this.endSession(conversationId),
      onClearActivity: () => this.clearActivity(),
      ...contextHandlers(refresh, () => this.selectedConversationId),
      onCreatePersona: (input) => addPersona(input, refresh),
      onRemovePersona: (role) => dropPersona(role, refresh),
      onSendHandoff: (input) => this.sendHandoff(input),
      onSetSessionLimit: (id, value) => {
        if (!this.usingDemo && setSessionContextLimitField(workspaceRoot(), id, value)) refresh();
      },
      onSetAutoContinue: (id, enabled) => {
        if (!this.usingDemo && setSessionAutoContinue(workspaceRoot(), id, enabled)) refresh();
      },
      onContinueSession: () => this.continueSelected(),
      onConnectUsage: () => this.usage.connect(),
      onRefreshUsage: () => this.usage.refresh(),
      onOpenUsageDashboard: () => this.usage.openDashboard(),
      onRepairHooks: () => this.installHooks(),
      onBack: () => { this.page = "team"; refresh(); },
    });
    webview.html = loadWebviewHtml(webview, this.context.extensionUri);
    this.usage.start();
    this.watcher.start(workspaceRoot(), () => this.repaint(), () => ({
      visible: this.webviews.size > 0,
      agentLive:
        this.page === "agent" && !this.loading.current && Date.now() - this.lastPaint > 1200,
      sincePaint: Date.now() - this.lastPaint,
    }));
  }

  detach(webview: vscode.Webview): void {
    this.webviews.delete(webview);
    if (this.webviews.size === 0) {
      this.watcher.stop();
      this.usage.stop();
    }
  }

  refreshAll(): void { void this.pushAll(); }
  private repaint(): void { this.lastPaint = Date.now(); this.refreshAll(); }

  private clearActivity(): void {
    if (!this.usingDemo && this.selectedConversationId)
      clearConversationActivity(workspaceRoot(), this.selectedConversationId);
    this.refreshAll();
  }

  private closeHost(): CloseHost {
    return {
      root: workspaceRoot(),
      loading: this.loading,
      refresh: () => this.refreshAll(),
      deselect: (id) => {
        if (this.selectedConversationId !== id) return;
        this.selectedConversationId = undefined;
        this.page = "team";
      },
    };
  }

  private endSession(conversationId: string): void {
    if (this.usingDemo) return this.refreshAll();
    closeSession(this.closeHost(), conversationId);
  }

  private selectSession(conversationId: string): void {
    this.pinningConversationId = conversationId;
    this.selectedConversationId = conversationId;
    this.page = "agent";
    workspaceContext(workspaceRoot());
    this.refreshAll();
    if (this.usingDemo) {
      this.pinningConversationId = undefined;
      return;
    }
    const token = this.loading.begin("Opening session…", conversationId);
    void runChatTask(async () => {
      try {
        if (!(await this.loading.finish(token))) return;
        if (this.selectedConversationId !== conversationId) return;
        await openChat(conversationId);
        this.refreshAll();
      } finally {
        if (this.pinningConversationId === conversationId) this.pinningConversationId = undefined;
      }
    });
  }

  private focusSelected(conversationId?: string): void {
    const target = conversationId ?? this.selectedConversationId;
    if (!target) return;
    if (target !== this.selectedConversationId) this.selectSession(target);
    if (this.usingDemo) return;
    void runChatTask(() => focusChat(target));
  }

  private sendHandoff(input: HandoffInput): void {
    const root = workspaceRoot();
    const { state } = readSnapshot(root, this.context.extensionPath);
    const plan = planHandoff(root, state, this.selectedConversationId, input);
    if (plan.warning) {
      void vscode.window.showWarningMessage(plan.warning);
      return;
    }
    this.refreshAll();
    if (!plan.openConversationId) return;
    const target = plan.openConversationId;
    this.selectSession(target);
    if (plan.nudge) void runChatTask(() => nudgeChat(target));
  }

  private async pushAll(): Promise<void> {
    const snapshot = readSnapshot(workspaceRoot(), this.context.extensionPath);
    this.usingDemo = snapshot.usingDemo;
    if (!this.usingDemo) reapClosedSessions(this.closeHost(), snapshot.state.sessions);
    if (this.pinningConversationId) this.selectedConversationId = this.pinningConversationId;
    // A chat on its way out keeps its screen until its loader ends, as the rail keeps its row.
    const closing = this.loading.current?.conversationId;
    const known = snapshot.state.sessions.some(
      (session) => session.conversationId === this.selectedConversationId && (session.status !== "closed" || session.conversationId === closing)
    );
    if (!known) {
      this.selectedConversationId = undefined;
      if (this.page === "agent") this.page = "team";
    }
    const payload = viewModel(snapshot, {
      page: this.page,
      selectedConversationId: this.selectedConversationId,
      now: Date.now(),
      loading: this.loading.current,
      accountUsage: this.usage.view,
    });
    const message = { type: "state" as const, payload };
    for (const [webview, setTitle] of this.webviews) {
      setTitle("");
      void webview.postMessage(message);
    }
    queueAutoContinue({
      usingDemo: this.usingDemo,
      autoContinuing: this.autoContinuing,
      extensionPath: this.context.extensionPath,
      markRunning: (running) => { this.autoContinuing = running; },
      startSession: (role, note, from) => this.startSession(role, note, from),
    }, snapshot, workspaceRoot());
  }

  private startSession(role: Role, continueNote?: string, rolloverFrom?: string): void {
    startRoleSession(
      {
        root: workspaceRoot(),
        extensionPath: this.context.extensionPath,
        loading: this.loading,
        refresh: () => this.refreshAll(),
        pin: (id) => { this.pinningConversationId = id; this.selectedConversationId = id; },
        release: (clear) => {
          this.pinningConversationId = undefined;
          if (clear) this.selectedConversationId = undefined;
        },
        showAgentPage: () => { this.page = "agent"; },
      },
      role,
      continueNote,
      rolloverFrom
    );
  }

  private async openPersonaSession(role: Role): Promise<void> {
    const snapshot = readSnapshot(workspaceRoot(), this.context.extensionPath);
    const choice = await confirmSecondSession(snapshot, role, this.usingDemo);
    if (choice.open === "new") this.startSession(role, choice.note);
    else if (choice.open === "existing") this.selectSession(choice.conversationId);
  }

  private continueSelected(): void {
    if (this.usingDemo || !this.selectedConversationId) return;
    const snapshot = readSnapshot(workspaceRoot(), this.context.extensionPath);
    const brief = continuationBrief(snapshot, this.selectedConversationId, "full");
    if (brief) this.startSession(brief.role, brief.text, this.selectedConversationId);
  }

  private lifecycle() {
    return {
      usingDemo: this.usingDemo,
      hooksOffered: this.hooksOffered,
      extensionPath: this.context.extensionPath,
      refreshAll: () => this.refreshAll(),
      startSession: (role: Role) => this.startSession(role),
      markHooksOffered: () => { this.hooksOffered = true; },
    };
  }

  installHooks(): void { runInstallHooks(this.lifecycle(), workspaceRoot()); }
  async removeAll(): Promise<void> { await runRemoveAll(this.lifecycle(), workspaceRoot()); }
}

function workspaceRoot(): string | undefined { return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; }