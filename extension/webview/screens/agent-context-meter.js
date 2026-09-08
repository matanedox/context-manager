/** The context reading for the selected chat, the cap that judges it, and the full state. */
/* global ui, paint, escapeHtml */
/* exported renderContextMeter */

/**
 * Painted into a panel rather than a title: a native tooltip truncates this and only
 * reappears after a window reload.
 */
const HELP_PARAGRAPHS = [
  "<strong>Limit</strong> sets a spending cap (examples: <code>80k</code> or <code>5M</code>). A plain number is millions. Blank is no limit.",
  "The reading is lifetime tokens used, not how full the current context window is.",
  "<strong>Auto</strong> requires a limit. When it is hit, this chat is asked for a recap, then a new chat opens with the same persona. It carries over files, tool-call count, the reading, and the recap if ready.",
  "The new chat is briefed and starts on its own; the thread itself is never copied. It keeps the limit but not the checkbox, so one tick is one replacement. Board-started chats only.",
  "A limit below what a single turn costs puts the replacement over the moment it answers, so set it above the reading a normal turn adds.",
];
/**
 * The reading and the cap that judges it, on one line. Painted rather than assigned so a repaint
 * mid-edit cannot wipe the number being typed.
 */
function renderContextMeter(payload) {
  const meter = document.getElementById("context-meter");
  const full = document.getElementById("context-full");
  const help = document.getElementById("context-help-panel");
  if (!meter || !full || !help) return;
  const reading = payload.contextMeter;
  meter.hidden = !reading && !payload.canSetLimit;
  full.hidden = !reading?.overLimit;
  help.hidden = meter.hidden || !ui.showContextHelp;
  if (meter.hidden) {
    paint(meter, "");
    paint(full, "");
    paint(help, "");
    return;
  }
  // Author-written copy, not payload data, so its emphasis and code marks are meant to render.
  paint(help, help.hidden ? "" : HELP_PARAGRAPHS.map((text) => `<p>${text}</p>`).join(""));
  meter.className = `context-meter${reading?.overLimit ? " over" : ""}`;
  const bar =
    reading?.fill != null
      ? `<span class="context-meter-track"><span class="context-meter-fill"></span></span>`
      : "";
  const label = reading ? reading.label : "No context reported yet";
  const limit = payload.canSetLimit
    ? `<label class="context-limit" title="Cap spend for this chat: 80k or 5M. Blank for none.">
        <span>Limit</span>
        <input type="text" spellcheck="false" autocomplete="off" data-session-limit="${escapeHtml(
          payload.selectedConversationId ?? ""
        )}" value="${escapeHtml(
          payload.contextLimitField ?? ""
        )}" placeholder="—" aria-label="Token limit for this chat, for example 80k or 5M" />
      </label>
      <label class="context-auto" title="When this chat passes its limit, open a fresh session briefed on it.">
        <input type="checkbox" data-auto-continue="${escapeHtml(
          payload.selectedConversationId ?? ""
        )}" ${payload.autoContinueOnLimit ? "checked" : ""} ${
          payload.contextLimitField != null ? "" : "disabled"
        } aria-label="Continue automatically in a fresh session at the limit" />
        <span>Auto</span>
      </label>
      <button type="button" class="context-help" data-toggle-context-help aria-expanded="${
        ui.showContextHelp
      }" aria-controls="context-help-panel" title="What Limit and Auto do">?</button>`
    : "";
  paint(meter, `${bar}<span class="context-meter-label">${escapeHtml(label)}</span>${limit}`);
  // The width is set here rather than in the painted html: the webview CSP has no 'unsafe-inline',
  // so a style attribute is dropped and the fill falls back to the full track.
  const fillEl = meter.querySelector(".context-meter-fill");
  if (fillEl) fillEl.style.width = `${Math.round((reading?.fill ?? 0) * 100)}%`;
  paint(
    full,
    reading?.overLimit
      ? `<span>This session is over its limit — ${escapeHtml(
          reading.short
        )} spent. A fresh chat starts the same persona from zero, briefed on this one.</span>
         <button type="button" data-continue-session>Continue in a fresh session</button>`
      : ""
  );
}
