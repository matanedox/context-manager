/** Top-level render pass and every board click, submit, and message handler. */
/* global ui, vscode, renderTeam, renderAgent, renderSessions, renderFlow, renderContextMeter, submitPersona, sendDelegate, handleContextClick */

/**
 * Screen registry, mirroring PAGES in src/present/ui.ts. Adding a screen means one entry here,
 * one section in index.html, and one builder in src/present/screens/.
 */
const SCREENS = {
  team: { section: "screen-team", render: (payload) => renderTeam(payload) },
  agent: { section: "screen-agent", render: (payload) => renderAgent(payload) },
};
const DEFAULT_PAGE = "team";

function render(payload) {
  ui.currentPayload = payload;
  const hookBar = document.getElementById("hook-bar");
  const hookWarning = document.getElementById("hook-warning");
  const missing = payload.hookCheck?.missing ?? [];
  // No folder open is not a broken install: there is nothing to repair and nothing to warn about.
  const noWorkspace = missing.length === 1 && missing[0] === "workspace";
  hookWarning.hidden = Boolean(payload.hookCheck?.ready) || noWorkspace;
  hookBar.classList.toggle("warn", !hookWarning.hidden);
  hookBar.title = hookWarning.hidden ? "" : `Missing: ${missing.join(", ")}`;
  const focus = document.activeElement;
  const inAddContext = focus?.closest?.("#add-context");
  const inHandoff = focus?.closest?.(".handoff-form");
  const inLimit = focus?.matches?.("[data-session-limit]") ? focus : null;
  const inAuto = focus?.matches?.("[data-auto-continue]") ? focus : null;
  const limitCaret = inLimit
    ? {
        id: focus.dataset.sessionLimit,
        start: focus.selectionStart,
        end: focus.selectionEnd,
        value: focus.value,
      }
    : null;
  const handoffCaret =
    inHandoff && focus?.name === "text" ? { start: focus.selectionStart, end: focus.selectionEnd } : null;
  const focusRole = !inAddContext && !inHandoff && !inLimit && !inAuto ? focus?.dataset?.role : undefined;
  const focusConv = !inAddContext && !inHandoff && !inLimit && !inAuto ? focus?.dataset?.conversation : undefined;
  const page = SCREENS[payload.page] ? payload.page : DEFAULT_PAGE;
  for (const [id, screen] of Object.entries(SCREENS)) {
    const section = document.getElementById(screen.section);
    if (section) section.hidden = id !== page;
  }

  renderSessions(payload);
  SCREENS[page].render(payload);

  const next = focusRole
    ? document.querySelector(`[data-role="${CSS.escape(focusRole)}"]`)
    : focusConv
      ? document.querySelector(`[data-conversation="${CSS.escape(focusConv)}"]`)
      : null;
  if (next) {
    next.focus();
  } else if (limitCaret) {
    const input = document.querySelector(`[data-session-limit="${CSS.escape(limitCaret.id)}"]`);
    if (input) {
      input.value = limitCaret.value;
      input.focus();
      try {
        if (typeof limitCaret.start === "number") {
          input.setSelectionRange(limitCaret.start, limitCaret.end);
        }
      } catch {
        /* number inputs do not always expose a caret */
      }
    }
  } else if (inAuto) {
    document.querySelector(`[data-auto-continue="${CSS.escape(inAuto.dataset.autoContinue)}"]`)?.focus();
  } else if (handoffCaret) {
    // Only ever restore focus the board already had: an open form is not a reason to pull the
    // caret out of the chat the user is typing in.
    const input = document.querySelector('.handoff-form input[name="text"]');
    if (input) {
      input.focus();
      if (typeof handoffCaret.start === "number") {
        input.setSelectionRange(handoffCaret.start, handoffCaret.end);
      }
    }
  }
}

window.addEventListener("message", (event) => {
  if (event.data?.type === "state") render(event.data.payload);
});

document.body.addEventListener("click", (event) => {
  if (handleContextClick(event)) return;
  if (event.target.closest("[data-toggle-add-persona]")) {
    ui.showAddPersona = !ui.showAddPersona;
    if (ui.currentPayload) renderTeam(ui.currentPayload);
    if (ui.showAddPersona) {
      document.getElementById("add-persona-panel")?.querySelector('input[name="role"]')?.focus();
    }
    return;
  }
  if (event.target.closest(".back")) {
    vscode.postMessage({ type: "back" });
    return;
  }
  if (event.target.closest("[data-repair-hooks]")) {
    vscode.postMessage({ type: "repairHooks" });
    return;
  }
  if (event.target.closest("#clear-activity")) {
    vscode.postMessage({ type: "clearActivity" });
    return;
  }
  const removeRole = event.target.closest("[data-remove-role]");
  if (removeRole) {
    event.stopPropagation();
    vscode.postMessage({ type: "removePersona", role: removeRole.dataset.removeRole });
    return;
  }
  const figure = event.target.closest(".figure[data-role]");
  if (figure) {
    vscode.postMessage({ type: "openChat", role: figure.dataset.role });
    return;
  }
  const close = event.target.closest("[data-close-conversation]");
  if (close) {
    vscode.postMessage({
      type: "closeSession",
      conversationId: close.dataset.closeConversation,
    });
    return;
  }
  if (event.target.closest("[data-continue-session]")) {
    vscode.postMessage({ type: "continueSession" });
    return;
  }
  if (event.target.closest("[data-toggle-context-help]")) {
    ui.showContextHelp = !ui.showContextHelp;
    if (ui.currentPayload) renderContextMeter(ui.currentPayload);
    return;
  }
  const tab = event.target.closest(".session-main");
  if (tab) {
    vscode.postMessage({ type: "selectSession", conversationId: tab.dataset.conversation });
    return;
  }
  if (event.target.closest("#toggle-handoff")) {
    ui.showHandoff = !ui.showHandoff;
    ui.showSubagent = false;
    if (ui.currentPayload) renderFlow(ui.currentPayload);
    if (ui.showHandoff) {
      document.querySelector('#handoff-form input[name="text"]')?.focus();
    }
    return;
  }
  if (event.target.closest("#toggle-subagent")) {
    ui.showSubagent = !ui.showSubagent;
    ui.showHandoff = false;
    if (ui.currentPayload) renderFlow(ui.currentPayload);
    if (ui.showSubagent) {
      document.querySelector('#subagent-form input[name="text"]')?.focus();
    }
    return;
  }
  const focusSession = event.target.closest("[data-focus-session]");
  if (focusSession) {
    vscode.postMessage({
      type: "focusChat",
      conversationId: focusSession.dataset.focusSession,
    });
    return;
  }
  const pick = event.target.closest("[data-handoff-target]");
  if (pick) {
    ui.handoffTargetId = pick.dataset.handoffTarget;
    if (ui.currentPayload) renderFlow(ui.currentPayload);
    return;
  }
  const open = event.target.closest("[data-open-path]");
  if (open) {
    vscode.postMessage({ type: "openFile", path: open.dataset.openPath });
    return;
  }
  if (event.target.closest("[data-focus-chat]")) {
    vscode.postMessage({ type: "focusChat" });
    return;
  }
  const editCharter = event.target.closest(".edit-charter-link");
  if (editCharter?.dataset.path) {
    vscode.postMessage({ type: "openFile", path: editCharter.dataset.path, editable: true });
    return;
  }
});

document.body.addEventListener("change", (event) => {
  const auto = event.target.closest?.("[data-auto-continue]");
  if (auto) {
    vscode.postMessage({
      type: "setAutoContinue",
      conversationId: auto.dataset.autoContinue,
      autoContinue: auto.checked,
    });
    return;
  }
  const input = event.target.closest?.("[data-session-limit]");
  if (!input) return;
  vscode.postMessage({
    type: "setSessionLimit",
    conversationId: input.dataset.sessionLimit,
    limit: input.value,
  });
});

document.getElementById("flow")?.addEventListener("submit", (event) => {
  const form = event.target.closest(".handoff-form");
  if (!form) return;
  event.preventDefault();
  const text = String(form.elements.text?.value ?? "").trim();
  if (!text) return;
  if (form.id === "subagent-form") {
    sendDelegate(text, String(form.elements.role?.value ?? ""));
  } else {
    const target = (ui.currentPayload?.collaborators ?? []).find((item) => item.id === ui.handoffTargetId);
    if (!target) return;
    vscode.postMessage({
      type: "sendHandoff",
      targetKind: target.kind,
      role: target.role,
      conversationId: target.conversationId,
      subagentType: target.subagentType,
      text,
    });
  }
  form.reset();
  ui.showHandoff = false;
  ui.showSubagent = false;
  if (ui.currentPayload) renderFlow(ui.currentPayload);
});

document.getElementById("add-persona")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitPersona(event.target);
});

vscode.postMessage({ type: "ready" });
