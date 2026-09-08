/** The context reading for the selected chat, the cap that judges it, and the full state. */
/* global ui, paint, escapeHtml */
/* exported renderContextMeter */

/**
 * Painted into a panel rather than a title: a native tooltip truncates this and only
 * reappears after a window reload.
 */
// Filled rather than stroked: at 11px a 1.2px stroke lands under a device pixel and turns to mush.
const TIP_ICON = `<svg class="context-tip-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor"
  d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 2.6a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM7 7.4h2v4.6H7z"/></svg>`;
const HELP_PARAGRAPHS = [
	'<strong>Tokens spent:</strong> all the tokens this chat session has used, all replies added up. 10 replies at 30k each is 300k. Never goes down.',
	'<strong>Cached:</strong> the part Cursor reused instead of re-reading, at lower cost.',
	'<strong>Calls:</strong> agent replies. Tool calls are counted separately, in Facts.',
	'<strong>Context window:</strong> a different number. How much this chat carries into its <em>next</em> reply. Drops when Cursor summarizes. Only Cursor shows it: <button type="button" data-focus-chat>open this chat</button>, click the context indicator in its toolbar.',
	'<strong>Limit:</strong> a line for Tokens spent to cross, like <code>80k</code> or <code>5M</code>. Plain number means millions, blank means none. The reply that crosses it lands a little past.',
	'<strong>Auto:</strong> needs a Limit. At the Limit this chat writes a recap and one fresh chat opens with the same persona, briefed on it. Files, tool count and recap carry over, the conversation does not. Limit carries over, the checkbox does not.',
	`${TIP_ICON} <strong>Tip:</strong> every reply re-reads the whole chat, so long chats cost more per reply. Starting a new chat for a new task keeps it cheap.`,
];
/**
 * The reading and the cap that judges it, on one line. Painted rather than assigned so a repaint
 * mid-edit cannot wipe the number being typed.
 */
function renderContextMeter(payload) {
	const meter = document.getElementById('context-meter');
	const full = document.getElementById('context-full');
	const help = document.getElementById('context-help-panel');
	if (!meter || !full || !help) return;
	const reading = payload.contextMeter;
	meter.hidden = !reading && !payload.canSetLimit;
	full.hidden = !reading?.overLimit;
	help.hidden = meter.hidden || !ui.showContextHelp;
	if (meter.hidden) {
		paint(meter, '');
		paint(full, '');
		paint(help, '');
		return;
	}
	// Author-written copy, not payload data, so its emphasis and code marks are meant to render.
	paint(help, help.hidden ? '' : HELP_PARAGRAPHS.map((text) => `<p>${text}</p>`).join(''));
	meter.className = `context-meter${reading?.overLimit ? ' over' : ''}`;
	const bar =
		reading?.fill != null
			? `<span class="context-meter-track"><span class="context-meter-fill"></span></span>`
			: '';
	const label = reading ? reading.label : 'No context reported yet';
	// The reading opens the same explanation as `?`; its link focuses the chat, where Cursor owns
	// the context-usage popup.
	const copy = `<span class="context-meter-kicker">Tokens spent</span><span class="context-meter-label">${escapeHtml(
		label
	)}</span>`;
	const readingCopy = payload.canSetLimit
		? `<button type="button" class="context-meter-copy" data-toggle-context-help aria-expanded="${
				ui.showContextHelp
			}" aria-controls="context-help-panel" title="What tokens spent, the context window, Limit, and Auto do">${copy}</button>`
		: `<span class="context-meter-copy">${copy}</span>`;
	const limit = payload.canSetLimit
		? `<label class="context-limit" title="Cap spend for this chat: 80k or 5M. Blank for none.">
        <span>Limit</span>
        <input type="text" spellcheck="false" autocomplete="off" data-session-limit="${escapeHtml(
			payload.selectedConversationId ?? ''
		)}" value="${escapeHtml(
			payload.contextLimitField ?? ''
		)}" placeholder="—" aria-label="Token limit for this chat, for example 80k or 5M" />
      </label>
      <label class="context-auto" title="When this chat passes its limit, open a fresh session briefed on it.">
        <input type="checkbox" data-auto-continue="${escapeHtml(
			payload.selectedConversationId ?? ''
		)}" ${payload.autoContinueOnLimit ? 'checked' : ''} ${
			payload.contextLimitField != null ? '' : 'disabled'
		} aria-label="Continue automatically in a fresh session at the limit" />
        <span>Auto</span>
      </label>
      <button type="button" class="context-help" data-toggle-context-help aria-expanded="${
			ui.showContextHelp
		}" aria-controls="context-help-panel" title="What tokens spent, the context window, Limit, and Auto do">?</button>`
		: '';
	paint(meter, `${readingCopy}${bar}${limit}`);
	// The width is set here rather than in the painted html: the webview CSP has no 'unsafe-inline',
	// so a style attribute is dropped and the fill falls back to the full track.
	const fillEl = meter.querySelector('.context-meter-fill');
	if (fillEl) fillEl.style.width = `${Math.round((reading?.fill ?? 0) * 100)}%`;
	paint(
		full,
		reading?.overLimit
			? `<span>This session is over its limit — ${escapeHtml(
					reading.short
				)} spent. A fresh chat starts the same persona from zero, briefed on this one.</span>
         <button type="button" data-continue-session>Continue in a fresh session</button>`
			: ''
	);
}
