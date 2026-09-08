/** The session rail: rows for every open chat, shown on every screen. */
/* global escapeHtml, ROBOT_SVG, sessionStatus, sessionLoadTarget, sessionPersonaCopy */
/* exported renderSessions, sessionSubtitle */
function sessionSubtitle(session, loading, loadTarget) {
  const loadingRow =
    loading &&
    loadTarget !== null &&
    (session.pending ? loadTarget === "" : session.conversationId === loadTarget);
  if (loadingRow) return loading.label;
  if (session.pending) return session.shortId;
  const parts = [session.shortId];
  if (session.working) parts.push("working");
  if (session.when) parts.push(session.when);
  if (session.status === "failed") parts.push("tool error");
  return parts.join(" · ");
}

function renderSessions(payload) {
  const loading = payload.loading;
  const loadTarget = sessionLoadTarget(loading, payload.sessions);
  const sessions = document.getElementById("sessions");
  // Rows carry a ticking "3s ago", but rebuilding them mid-click cancels the click, so
  // repaint only on real changes and patch the subtitle text in place otherwise.
  const key = JSON.stringify([
    payload.sessions.map((session) => ({ ...session, when: "" })),
    loading,
    loadTarget,
  ]);
  if (key === sessions.dataset.key) {
    for (const session of payload.sessions) {
      const row = sessions.querySelector(
        `[data-conversation="${CSS.escape(session.conversationId)}"] .session-copy small:last-child`
      );
      if (row) row.textContent = sessionSubtitle(session, loading, loadTarget);
    }
    return;
  }
  sessions.dataset.key = key;
  sessions.innerHTML = payload.sessions.length
    ? `<div class="session-list">${payload.sessions
        .map((session) => {
          if (session.pending) {
            const pendingLoad = loadTarget === "";
            return `<div class="session-row pending${pendingLoad ? " opening" : ""}">
              <div class="session-main" ${pendingLoad ? 'role="status" aria-live="polite"' : ""}>
                ${sessionStatus(loading, session, loadTarget)}
                ${ROBOT_SVG}
                <span class="session-copy">
                  ${sessionPersonaCopy(session)}
                  <small>${escapeHtml(sessionSubtitle(session, loading, loadTarget))}</small>
                </span>
              </div>
            </div>`;
          }
          const opening = loadTarget === session.conversationId;
          // Read-only here: every row reserves the same slot so the rail reads as status, and the
          // cap that produced it is set on the agent screen beside the same number.
          const context = `<span class="session-context${
            session.contextOver ? " over" : ""
          }" title="${
            session.context ? "Context reported by the last turn" : "No turn reported yet"
          }">${escapeHtml(session.context ?? "—")}</span>`;
          return `<div class="session-row ${session.active ? "active" : ""} ${
            session.working ? "working" : ""
          } ${session.status === "failed" ? "failed" : ""} ${opening ? "opening" : ""}">
            <button class="session-main" data-conversation="${escapeHtml(
              session.conversationId
            )}" type="button" aria-pressed="${session.active}" title="${escapeHtml(
              session.conversationId
            )}" ${opening ? 'aria-busy="true"' : ""}>
              ${sessionStatus(loading, session, loadTarget)}
              ${ROBOT_SVG}
              <span class="session-copy">
                ${sessionPersonaCopy(session)}
                <small>${escapeHtml(sessionSubtitle(session, loading, loadTarget))}</small>
              </span>
            </button>
            ${context}
            <button class="session-close" data-close-conversation="${escapeHtml(
              session.conversationId
            )}" type="button" aria-label="End ${escapeHtml(
              session.name ?? session.roleLabel
            )} session and archive its chat" title="End session and archive the chat">×</button>
          </div>`;
        })
        .join("")}</div>`
    : '<p class="empty">No sessions yet.</p>';
}
