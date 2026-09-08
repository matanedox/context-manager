/** Context-tab clicks and forms kept separate from general board controls. */
/* global ui, vscode, renderContext, renderGlobalRules, syncContextForm */
/* exported handleContextClick */
function handleContextClick(event) {
	if (event.target.closest('#open-cursor-rules')) {
		vscode.postMessage({ type: 'openCursorRules' });
		return true;
	}
	if (event.target.closest('#toggle-add-global')) {
		ui.showAddGlobal = !ui.showAddGlobal;
		if (ui.currentPayload) renderGlobalRules(ui.currentPayload);
		if (ui.showAddGlobal) {
			document.getElementById('add-global')?.querySelector('input[name="name"]')?.focus();
		}
		return true;
	}
	const globalAction = [
		['[data-open-global]', 'openGlobalRule', 'openGlobal'],
		['[data-attach-global]', 'attachGlobalRule', 'attachGlobal'],
	].find(([selector]) => event.target.closest(selector));
	if (globalAction) {
		const [selector, type, key] = globalAction;
		vscode.postMessage({ type, itemId: event.target.closest(selector).dataset[key] });
		return true;
	}
	if (event.target.closest('#toggle-add-context')) {
		ui.showAddContext = !ui.showAddContext;
		ui.showAddCategory = false;
		if (ui.showAddContext) {
			const form = document.getElementById('add-context');
			const kindMap = { rules: 'rule', skills: 'skill', workflow: 'workflow' };
			if (ui.currentPayload) syncContextForm(ui.currentPayload);
			if (form?.elements.kind) {
				form.elements.kind.value =
					kindMap[ui.contextTab] ?? (ui.contextTab.startsWith('category:') ? ui.contextTab : 'rule');
			}
			if (ui.currentPayload) syncContextForm(ui.currentPayload);
			document.getElementById('add-context-panel')?.querySelector('input[name="name"]')?.focus();
		}
		if (ui.currentPayload) renderContext(ui.currentPayload);
		return true;
	}
	if (event.target.closest('#toggle-add-category')) {
		ui.showAddCategory = !ui.showAddCategory;
		ui.showAddContext = false;
		if (ui.currentPayload) renderContext(ui.currentPayload);
		if (ui.showAddCategory) {
			document.getElementById('add-category')?.querySelector('input[name="label"]')?.focus();
		}
		return true;
	}
	const removeCategory = event.target.closest('[data-remove-category]');
	if (removeCategory) {
		event.stopPropagation();
		const categoryId = removeCategory.dataset.removeCategory;
		if (ui.contextTab === `category:${categoryId}`) {
			ui.contextTab = 'rules';
			vscode.setState?.({ contextTab: ui.contextTab });
		}
		vscode.postMessage({ type: 'removeContextCategory', categoryId });
		return true;
	}
	const tabButton = event.target.closest('[data-tab]');
	if (tabButton) {
		ui.contextTab = tabButton.dataset.tab;
		ui.showAddContext = false;
		ui.showAddCategory = false;
		vscode.setState?.({ contextTab: ui.contextTab });
		if (ui.currentPayload) renderContext(ui.currentPayload);
		return true;
	}
	const actions = [
		['[data-open-context]', 'openContext', 'openContext'],
		['[data-favorite-item]', 'toggleFavorite', 'favoriteItem'],
		['[data-attach-context]', 'attachContext', 'attachContext'],
		['[data-delete-context]', 'deleteContext', 'deleteContext'],
	];
	for (const [selector, type, key] of actions) {
		const target = event.target.closest(selector);
		if (!target) continue;
		if (type === 'deleteContext') event.stopPropagation();
		vscode.postMessage({ type, itemId: target.dataset[key] });
		return true;
	}
	return false;
}

document.getElementById('add-global')?.addEventListener('submit', (event) => {
	event.preventDefault();
	const form = event.target;
	const name = String(form.elements.name?.value ?? '').trim();
	if (!name) return;
	vscode.postMessage({
		type: 'createGlobalRule',
		name,
		description: String(form.elements.description?.value ?? '').trim(),
	});
	form.reset();
	ui.showAddGlobal = false;
	if (ui.currentPayload) renderGlobalRules(ui.currentPayload);
});

document.getElementById('add-context')?.addEventListener('change', (event) => {
	if (event.target?.name === 'kind' && ui.currentPayload) syncContextForm(ui.currentPayload);
});

document.getElementById('add-category')?.addEventListener('submit', (event) => {
	event.preventDefault();
	const form = event.target;
	const label = String(form.elements.label?.value ?? '').trim();
	if (!label) return;
	vscode.postMessage({ type: 'createContextCategory', label });
	ui.contextTab = `category:${label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48)}`;
	vscode.setState?.({ contextTab: ui.contextTab });
	form.reset();
	ui.showAddCategory = false;
});

document.getElementById('add-context')?.addEventListener('submit', (event) => {
	event.preventDefault();
	const form = event.target;
	const value = (field) => String(form.elements[field]?.value ?? '').trim();
	const name = value('name');
	if (!name) return;
	const selectedKind = value('kind');
	const categoryTab = selectedKind.startsWith('category:') ? selectedKind : ui.contextTab;
	const categoryId = categoryTab.startsWith('category:') ? categoryTab.slice('category:'.length) : undefined;
	const personas = [...form.querySelectorAll('input[name="persona"]:checked')].map((input) => input.value);
	vscode.postMessage({
		type: 'createContext',
		kind: categoryId ? 'rule' : selectedKind,
		categoryId,
		name,
		description: value('description'),
		alwaysOn: Boolean(form.elements.alwaysOn?.checked),
		personas,
	});
	form.reset();
	ui.showAddContext = false;
	if (ui.currentPayload) renderContext(ui.currentPayload);
});
