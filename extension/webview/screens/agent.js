/** Context tabs, the add-context form, and the agent detail screen. */
/* global ui, paint, escapeHtml, ROBOT_SVG, personaLabels, renderFlow, renderGlobalRules, renderContextMeter */
/* exported renderAgent, renderContext, personaTags, syncContextForm, syncAddContextUi, contextItemRow */
/** Drawn rather than a glyph: the webview cannot count on an emoji trash rendering in every theme font. */
const TRASH_SVG = `<svg class="ctx-trash" viewBox="0 0 16 16" aria-hidden="true">
  <path d="M6.5 2.5h3M2.5 4.5h11M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2M6.8 7v4M9.2 7v4"
    fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function personaTags(item, personas, selectedRole) {
	const ids = [...new Set([...(item.personas ?? []), ...(item.referencedBy ?? [])])];
	if (!ids.length) {
		const label = item.alwaysApply ? 'All' : 'Shared';
		return `<span class="persona-tag muted">${escapeHtml(label)}</span>`;
	}
	const title = (id) => personas.find((persona) => persona.id === id)?.title ?? id;
	return ids
		.map(
			(id) => `<span class="persona-tag${id === selectedRole ? ' selected' : ''}">${escapeHtml(title(id))}</span>`
		)
		.join('');
}

function syncContextForm(payload) {
	const form = document.getElementById('add-context');
	const checks = document.getElementById('persona-checks');
	const alwaysOnField = document.getElementById('always-on-field');
	if (!form || !checks) return;

	const kindSelect = form.elements.kind;
	const selectedKind = kindSelect?.value ?? 'rule';
	if (kindSelect) {
		const types = [
			['rule', 'Rule'],
			['skill', 'Skill'],
			['workflow', 'Workflow'],
			...(payload.context?.categories ?? []).map((category) => [`category:${category.id}`, category.label]),
		];
		kindSelect.innerHTML = types
			.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
			.join('');
		kindSelect.value = types.some(([value]) => value === selectedKind) ? selectedKind : 'rule';
	}

	const personas = payload.context?.personas ?? [];
	const selected = new Set([...checks.querySelectorAll('input:checked')].map((input) => input.value));
	if (!selected.size && payload.selectedRole) selected.add(payload.selectedRole);

	checks.innerHTML = personas.length
		? personas
				.map(
					(persona) => `<label class="persona-check">
            <span class="check-wrap">
              <input type="checkbox" name="persona" value="${escapeHtml(persona.id)}" ${
					selected.has(persona.id) ? 'checked' : ''
				} />
              <span class="check-ui" aria-hidden="true"></span>
            </span>
            ${escapeHtml(persona.title)}
          </label>`
				)
				.join('')
		: '<span class="hint inline">Use + Add persona on the Team roster first.</span>';

	const kind = kindSelect?.value ?? 'rule';
	if (alwaysOnField) alwaysOnField.hidden = kind !== 'rule' && !kind.startsWith('category:');
}

function syncAddContextUi() {
	const panel = document.getElementById('add-context-panel');
	const toggle = document.getElementById('toggle-add-context');
	const categoryPanel = document.getElementById('add-category-panel');
	const categoryToggle = document.getElementById('toggle-add-category');
	if (panel) panel.hidden = !ui.showAddContext;
	if (categoryPanel) categoryPanel.hidden = !ui.showAddCategory;
	if (toggle) {
		toggle.classList.toggle('active', ui.showAddContext);
		toggle.setAttribute('aria-expanded', String(ui.showAddContext));
	}
	if (categoryToggle) {
		categoryToggle.classList.toggle('active', ui.showAddCategory);
		categoryToggle.setAttribute('aria-expanded', String(ui.showAddCategory));
	}
}

function syncContextTabs(payload) {
	const tabs = payload.contextTabs ?? [];
	if (!tabs.some((tab) => tab.id === ui.contextTab)) ui.contextTab = tabs[0]?.id ?? 'rules';
	paint(
		document.getElementById('context-tab-row'),
		tabs
			.map((tab) => {
				const button = `<button type="button" data-tab="${escapeHtml(tab.id)}" class="ctx-tab${
					tab.id === ui.contextTab ? ' active' : ''
				}">${escapeHtml(tab.label)}<span class="tab-count">${tab.count}</span></button>`;
				return tab.removable
					? `<span class="ctx-tab-wrap">${button}<button type="button" class="ctx-tab-remove" data-remove-category="${escapeHtml(
							tab.id.replace(/^category:/, '')
						)}" aria-label="Remove ${escapeHtml(tab.label)} category" title="Remove category">×</button></span>`
					: button;
			})
			.join('')
	);
	syncAddContextUi();
}

function contextItemRow(item, personas, selectedRole) {
	const removable = !item.readonly;
	return `<li class="context-item">
    <div class="context-body">
      <span class="context-name">${escapeHtml(item.label)}</span>
      <span class="context-personas">${personaTags(item, personas, selectedRole)}</span>
      <span class="context-meta"><span class="badge">${escapeHtml(item.type)}</span>${escapeHtml(item.detail)}</span>
    </div>
    <div class="context-actions">
      <button type="button" class="ctx-action ctx-favorite${item.favorite ? ' active' : ''}" data-favorite-item="${escapeHtml(
			item.id
		)}" title="${item.favorite ? 'Remove from favorites' : 'Add to favorites'}" aria-label="${
			item.favorite ? 'Remove from favorites' : 'Add to favorites'
		}">★</button>
      <button type="button" class="ctx-action" data-open-context="${escapeHtml(
			item.id
		)}" title="Open file">Open</button>
      <button type="button" class="ctx-action" data-attach-context="${escapeHtml(
			item.id
		)}" title="Add to chat">Add</button>${
			removable
				? `<button type="button" class="ctx-action ctx-delete" data-delete-context="${escapeHtml(
						item.id
					)}" title="Delete file" aria-label="Delete ${escapeHtml(item.label)}">${TRASH_SVG}</button>`
				: ''
		}
    </div>
  </li>`;
}

function renderContext(payload) {
	const items = [...(payload.context?.alwaysOn ?? []), ...(payload.context?.available ?? [])];
	const personas = payload.context?.personas ?? [];
	syncContextTabs(payload);
	const tab = (payload.contextTabs ?? []).find((entry) => entry.id === ui.contextTab);
	const visible = new Set(tab?.itemIds ?? []);
	const filtered = items.filter((item) => visible.has(item.id));
	paint(
		document.getElementById('context-list'),
		filtered.length
			? filtered.map((item) => contextItemRow(item, personas, payload.selectedRole)).join('')
			: '<li class="empty">None in this tab.</li>'
	);
}

function renderAgent(payload) {
	const charterPath = payload.selectedPersona?.charterPath;
	const persona = payload.selectedPersona;
	const { roleLabel, name } = persona ? personaLabels(persona) : { roleLabel: payload.roleTitle, name: undefined };
	const title = persona
		? `<span class="figure-copy"><span class="title role">${escapeHtml(roleLabel)}</span>${
				name ? `<span class="name">${escapeHtml(name)}</span>` : ''
			}</span>`
		: `<span class="title">${escapeHtml(payload.roleTitle)}</span>`;
	const chat = (payload.sessions ?? []).find((session) => session.active);
	// The session rail lives on the team screen, so this chat would otherwise end with no sign of it
	// here: the card takes the rail's spinner, and its own × so the close starts from the board.
	const closing = chat && chat.conversationId === payload.loading?.conversationId;
	const actions = closing
		? `<span class="spinner" aria-hidden="true"></span><span class="closing-note" role="status">${escapeHtml(
				payload.loading.label
			)}</span>`
		: `${
				charterPath
					? `<button type="button" class="edit-charter-link" data-path="${escapeHtml(
							charterPath
						)}">Edit Persona</button>`
					: ''
			}${
				chat
					? `<button type="button" class="focus-chat-btn" data-focus-chat title="Bring this agent's chat back into focus">Focus</button><button type="button" class="focus-chat-btn" data-close-conversation="${escapeHtml(
							chat.conversationId
						)}" title="End session and archive the chat">Close</button>`
					: ''
			}`;
	paint(document.getElementById('current'), `${ROBOT_SVG}${title}<span class="current-actions">${actions}</span>`);
	document.getElementById('facts').innerHTML = (payload.facts ?? [])
		.map((fact) => {
			const live = /^Status: Working/.test(fact) || /^Tool calls: [1-9]/.test(fact);
			return `<span class="fact${live ? ' fact-live' : ''}">${escapeHtml(fact)}</span>`;
		})
		.join('');
	renderContextMeter(payload);
	const files = payload.files ?? [];
	document.getElementById('files-count').textContent = String(files.length);
	paint(
		document.getElementById('files'),
		files.length
			? files.map((file) => `<code>${escapeHtml(file)}</code>`).join(' ')
			: '<span class="empty">No files touched in this session yet.</span>'
	);
	renderFlow(payload);
	renderGlobalRules(payload);
	if (ui.showAddContext) syncContextForm(payload);
	renderContext(payload);
	const log = document.getElementById('log');
	const logged = paint(
		log,
		payload.log.length
			? payload.log
					.map(
						(row) =>
							`<li class="${row.hot ? 'hot' : ''}"><time>${escapeHtml(row.ts)}</time> <strong>${escapeHtml(
								row.text
							)}</strong></li>`
					)
					.join('')
			: '<li>No events for this session.</li>'
	);
	if (logged) log.scrollTop = log.scrollHeight;
}
