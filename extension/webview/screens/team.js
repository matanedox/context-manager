/** Team screen: the roster of persona figures and the add-persona panel. */
/* global ui, vscode, paint, escapeHtml, ROBOT_SVG, personaFigureCopy */
/* exported renderTeam, submitPersona */
function submitPersona(form) {
	const role = String(form.elements.role?.value ?? '').trim();
	const name = String(form.elements.name?.value ?? '').trim();
	if (!role || !name) return;
	vscode.postMessage({
		type: 'createPersona',
		role,
		description: String(form.elements.description?.value ?? '').trim(),
		name,
	});
	form.reset();
	ui.showAddPersona = false;
	if (ui.currentPayload) renderTeam(ui.currentPayload);
}

/** Shares ROBOT_SVG's box and .bot sizing so the tile's icon and label rows match the roster. */
const ADD_SVG = `<svg class="bot" viewBox="0 0 48 48" aria-hidden="true">
  <circle cx="24" cy="24" r="15" fill="currentColor" opacity="0.14"/>
  <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5"/>
  <path d="M24 17.5v13M17.5 24h13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;

function renderRoster(payload) {
	document.getElementById('banner').textContent = payload.banner;
	const figures = payload.roster
		.map(
			(item) => `<div class="figure-wrap${item.dimmed ? ' dimmed' : ''}">
        <button class="figure" data-role="${escapeHtml(item.role)}" type="button" title="${escapeHtml(
			item.dimmed ? 'Onboarding — extension setup and support' : item.role
		)}">
          ${ROBOT_SVG}${personaFigureCopy(item)}</button>${
				item.removable
					? `<button class="figure-remove" data-remove-role="${escapeHtml(
							item.role
						)}" type="button" aria-label="Remove ${escapeHtml(
							item.name ?? item.roleLabel
						)}" title="Remove persona">×</button>`
					: ''
			}</div>`
		)
		.join('');
	const addActive = ui.showAddPersona ? ' active' : '';
	paint(
		document.getElementById('roster'),
		`${figures}<button class="figure figure-add${addActive}" type="button" data-toggle-add-persona aria-pressed="${ui.showAddPersona}" title="Add a scrum persona">
    ${ADD_SVG}<span class="figure-copy"><span class="role">Add persona</span></span>
  </button>`
	);
}

/** Drawn rather than typed: the emoji bolt and the circled-i glyph both fell back to nothing here. */
const USAGE_ICON = `<svg class="account-usage-icon" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" fill="currentColor"/></svg>`;
const INFO_ICON = `<svg class="account-usage-info" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <circle cx="12" cy="7.6" r="1.15" fill="currentColor"/>
  <path d="M12 10.9v6.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const REFRESH_ICON = `<svg class="account-usage-refresh-icon" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M20.5 4.8v5h-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * The details go in a painted panel rather than a title: a native tooltip in this webview
 * truncates and only reappears after a window reload, the same reason the context meter has one.
 */
function renderAccountUsage(payload, refreshing) {
	const el = document.getElementById('account-usage');
	const help = document.getElementById('account-usage-help');
	if (!el || !help) return;
	const usage = payload.accountUsage;
	const ready = usage?.kind === 'ready';
	help.hidden = !ready || !ui.showUsageHelp;
	paint(
		help,
		help.hidden
			? ''
			: `${usage.details.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
         <p><button type="button" class="account-usage-link" data-open-usage-dashboard>Open cursor.com/dashboard/usage</button></p>`
	);
	if (!usage || usage.kind === 'loading') {
		paint(el, `${USAGE_ICON}<span class="account-usage-label">Checking usage…</span>`);
		return;
	}
	if (usage.kind === 'needsAuth') {
		paint(
			el,
			`<button type="button" class="account-usage-connect" data-connect-usage>Connect Cursor usage</button>`
		);
		return;
	}
	if (usage.kind === 'error') {
		paint(
			el,
			`${USAGE_ICON}<span class="account-usage-label">${escapeHtml(usage.message)}</span><button type="button" class="account-usage-connect" data-connect-usage>Retry</button>`
		);
		return;
	}
	// The half that is spending leads; the other trails dimmed. Once the allowance is gone the
	// dollars are the live number, so they take the lead and the spent allowance dims.
	const half = (text, lead) =>
		text ? `<span class="${lead ? 'usage-lead' : 'usage-trail'}">${escapeHtml(text)}</span>` : '';
	const reading = [
		half(usage.exhausted ? usage.onDemand : usage.included, true),
		half(usage.exhausted ? usage.included : usage.onDemand, false),
	]
		.filter(Boolean)
		.join(`<span class="usage-trail">·</span>`);
	paint(
		el,
		`${USAGE_ICON}<span class="account-usage-reading" aria-label="Cursor usage: ${escapeHtml(
			usage.label
		)}">${reading}</span>
    <span class="account-usage-actions">
      <button type="button" class="account-usage-refresh${
			refreshing ? ' busy' : ''
		}" data-refresh-usage title="Refresh this reading" aria-label="Refresh this reading">${REFRESH_ICON}</button>
      <button type="button" class="account-usage-help" data-toggle-usage-help aria-expanded="${
			ui.showUsageHelp
		}" aria-controls="account-usage-help" title="What this reading covers" aria-label="What this reading covers">${INFO_ICON}</button>
    </span>`
	);
}

function renderTeam(payload) {
	const setup = document.getElementById('team-setup');
	const addPanel = document.getElementById('add-persona-panel');
	const rosterHint = document.getElementById('roster-hint');
	renderAccountUsage(payload);

	setup.hidden = !payload.needsSetup;
	if (addPanel) addPanel.hidden = !ui.showAddPersona;

	if (rosterHint) {
		rosterHint.textContent = payload.needsSetup
			? 'Preview roster — use + Add persona to make it yours. Click a figure to start a chat.'
			: 'Click a figure to start a chat as that role, or again for another session of that persona.';
	}

	renderRoster(payload);
}

// The panel is a sibling of the strip, not a child, so both carry the same handler.
function handleUsageClick(event) {
	if (event.target.closest('[data-connect-usage]')) {
		vscode.postMessage({ type: 'connectUsage' });
	} else if (event.target.closest('[data-toggle-usage-help]')) {
		ui.showUsageHelp = !ui.showUsageHelp;
		if (ui.currentPayload) renderAccountUsage(ui.currentPayload);
	} else if (event.target.closest('[data-open-usage-dashboard]')) {
		vscode.postMessage({ type: 'openUsageDashboard' });
	} else if (event.target.closest('[data-refresh-usage]')) {
		vscode.postMessage({ type: 'refreshUsage' });
		// A ready reading is not swapped for the loading state, so the spin is the only sign the click
		// landed. It rides an argument rather than ui state because the host's next paint renders the
		// plain button, and paint only redraws when the markup differs — which clears it every time.
		if (ui.currentPayload) renderAccountUsage(ui.currentPayload, true);
	}
}

for (const id of ['account-usage', 'account-usage-help']) {
	document.getElementById(id)?.addEventListener('click', handleUsageClick);
}
