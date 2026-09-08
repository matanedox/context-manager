/** Shared board state and DOM helpers every screen builds on. */
/* global: vscode webview */
/* exported ui, vscode, ROBOT_SVG, paint, escapeHtml, sessionStatus, sessionLoadTarget, personaLabels, personaFigureCopy, sessionPersonaCopy, handoffDraft */
const vscode = acquireVsCodeApi();
const savedUi = vscode.getState?.() ?? {};
/** Board UI state shared by every webview script; scripts mutate its fields, never rebind it. */
const ui = {
  contextTab: savedUi.contextTab ?? "rules",
  showAddPersona: false,
  showAddContext: false,
  showAddCategory: false,
  showAddGlobal: false,
  showHandoff: false,
  showSubagent: false,
  showContextHelp: false,
  showUsageHelp: false,
  handoffTargetId: null,
  currentPayload: undefined,
};
const ROBOT_SVG = `<svg class="bot" viewBox="0 0 48 48" aria-hidden="true">
  <rect x="10" y="14" width="28" height="24" rx="6" fill="currentColor" opacity="0.2"/>
  <rect x="10" y="14" width="28" height="24" rx="6" fill="none" stroke="currentColor" stroke-width="2"/>
  <rect x="18" y="6" width="12" height="8" rx="2" fill="currentColor"/>
  <circle cx="20" cy="26" r="3" fill="currentColor"/>
  <circle cx="28" cy="26" r="3" fill="currentColor"/>
  <rect x="18" y="32" width="12" height="2" rx="1" fill="currentColor"/>
</svg>`;

/** Repaint only when the markup changed: swapping a live button mid-click cancels the click. */
function paint(el, html) {
  if (!el || el.dataset.html === html) return false;
  el.dataset.html = html;
  el.innerHTML = html;
  return true;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

function sessionStatus(loading, session, loadTarget) {
  const active =
    loading && loadTarget !== null && (session.pending ? loadTarget === "" : session.conversationId === loadTarget);
  return `<span class="session-status${active ? " loading" : ""}" aria-hidden="true"></span>`;
}

function sessionLoadTarget(loading, sessions) {
  if (!loading) return null;
  if (loading.conversationId) return loading.conversationId;
  return sessions.some((session) => session.pending) ? "" : null;
}

function personaLabels(item) {
  const roleLabel = item.roleLabel ?? item.label ?? item.role ?? "";
  const name = item.name ?? (item.label && item.label !== roleLabel ? item.label : undefined);
  return { roleLabel, name };
}

function personaFigureCopy(item) {
  const { roleLabel, name } = personaLabels(item);
  const role = `<span class="role">${escapeHtml(roleLabel)}</span>`;
  const sub = name ? `<span class="name">${escapeHtml(name)}</span>` : "";
  return `<span class="figure-copy">${role}${sub}</span>`;
}

function sessionPersonaCopy(session) {
  const { roleLabel, name } = personaLabels(session);
  const ordinal = session.showInstance && session.instanceIndex ? ` · ${session.instanceIndex}` : "";
  const sub = name ? `<small class="session-name">${escapeHtml(name)}${escapeHtml(ordinal)}</small>` : "";
  return `<strong>${escapeHtml(roleLabel)}${name ? "" : escapeHtml(ordinal)}</strong>${sub}`;
}

/** The message in flight, so a repaint does not wipe what the user is typing. */
function handoffDraft() {
  return document.querySelector('.handoff-form input[name="text"]')?.value ?? "";
}
