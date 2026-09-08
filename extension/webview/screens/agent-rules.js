/** Global rules live in ~/.cursor, so they get their own list instead of an Context Manager tab. */
/* global ui, paint, escapeHtml */
/* exported renderGlobalRules */
function renderGlobalRules(payload) {
  const rules = payload.globalRules ?? [];
  document.getElementById("global-count").textContent = String(rules.length);
  const form = document.getElementById("add-global");
  if (form) form.hidden = !ui.showAddGlobal;
  document.getElementById("toggle-add-global")?.setAttribute("aria-expanded", String(Boolean(ui.showAddGlobal)));
  paint(
    document.getElementById("global-list"),
    rules.length
      ? rules
          .map(
            (rule) => `<li class="context-item">
              <div class="context-body">
                <span class="context-name">${escapeHtml(rule.label)}</span>
                <span class="context-meta"><span class="badge">global</span>${escapeHtml(rule.detail)}</span>
              </div>
              <div class="context-actions">
                <button type="button" class="ctx-action" data-open-global="${escapeHtml(
                  rule.id,
                )}" title="Open file">Open</button>
                <button type="button" class="ctx-action" data-attach-global="${escapeHtml(
                  rule.id,
                )}" title="Add to chat">Add</button>
              </div>
            </li>`,
          )
          .join("")
      : '<li class="empty">No files in ~/.cursor/rules yet. Cursor user rules live in its own editor.</li>',
  );
}
