#!/usr/bin/env node
/** Persona discovery, the context catalog, and global rules: node test/workspace-context.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Context tabs are board preferences kept outside the workspace; redirect the tree for tests.
process.env.CURSOR_AGENT_VIZ_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-home-'));
const {
	contextForPersona,
	contextItemFile,
	createContextFile,
	createPersona,
	deleteContextFile,
	discoverPersonas,
	isWorkspaceContextPath,
	linkedContextForPersona,
	personaCharterPath,
	removePersona,
	restoreGuide,
	workspaceContext,
} = require('../out/data/workspace-context');
const {
	createContextCategory,
	readContextTabs,
	removeContextCategory,
	setContextCategory,
	toggleContextFavorite,
} = require('../out/data/context-tabs');
const { createGlobalRule, globalRuleFile, globalRules } = require('../out/data/global-rules');
const { payloadFor, repoContext, roleMap, sampleState } = require('./fixtures');

// this repo's own context
assert.ok(repoContext.alwaysOn.some((item) => item.path === 'AGENTS.md'));
assert.ok(repoContext.alwaysOn.some((item) => item.path.endsWith('00-scrum-identity.mdc')));
assert.equal(isWorkspaceContextPath('.cursor/rules/a.mdc'), true);
assert.equal(isWorkspaceContextPath('.cursor/rules/../secrets.txt'), false);
assert.equal(isWorkspaceContextPath('.cursor/personas/beta.md'), true);
assert.equal(isWorkspaceContextPath('vendor/rules/a.mdc'), false);

const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-workflow-'));
assert.equal(
	createContextFile(workflowRoot, {
		kind: 'workflow',
		name: 'Ship It',
		description: 'release run',
	}),
	'.cursor/workflows/ship-it.md'
);
assert.ok(
	workspaceContext(workflowRoot).available.some((item) => item.type === 'workflow'),
	'workflows are scanned as context'
);
fs.rmSync(workflowRoot, { recursive: true, force: true });

const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-empty-'));
const emptyCtx = workspaceContext(emptyRoot);
assert.equal(
	emptyCtx.available.some((item) => item.type === 'skill'),
	false,
	'empty skills stay empty'
);
assert.equal(emptyCtx.personaSource, 'fallback', "the board can tell the roster is not the project's");
fs.rmSync(emptyRoot, { recursive: true, force: true });

const personaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-personas-'));
fs.mkdirSync(path.join(personaRoot, '.cursor', 'personas'), { recursive: true });
fs.mkdirSync(path.join(personaRoot, '.cursor', 'rules'), { recursive: true });
fs.writeFileSync(
	path.join(personaRoot, '.cursor', 'personas', 'beta.md'),
	'---\nid: beta\ntitle: Beta\ndescription: from disk\n---\n'
);
fs.writeFileSync(
	path.join(personaRoot, '.cursor', 'rules', 'gamma-only.mdc'),
	'---\ndescription: Gamma only\nalwaysApply: false\npersonas: gamma\n---\n'
);
fs.writeFileSync(
	path.join(personaRoot, '.cursor', 'rules', 'shared.mdc'),
	'---\ndescription: untagged\nalwaysApply: false\n---\n'
);
const fromDisk = discoverPersonas(personaRoot);
assert.deepEqual(
	fromDisk.personas.map((persona) => persona.id),
	['guide', 'beta'],
	"the extension's Extension Assistant card leads the project's own personas"
);
assert.equal(fromDisk.source, 'personas', 'the Extension Assistant does not make the roster look invented');
assert.equal(personaCharterPath(personaRoot, 'guide'), null, 'the Extension Assistant has no charter to open');
const scanned = workspaceContext(personaRoot);
const betaCtx = contextForPersona(scanned, 'beta');
assert.equal(
	betaCtx.available.some((item) => item.path.endsWith('gamma-only.mdc')),
	false,
	'a gamma-only rule stays hidden on the beta screen'
);
assert.equal(
	betaCtx.available.some((item) => item.path.endsWith('shared.mdc')),
	true,
	'untagged files stay available'
);
const created = createContextFile(personaRoot, {
	kind: 'rule',
	name: 'Always Gate',
	description: 'always-on rule',
	alwaysOn: true,
});
assert.equal(created, '.cursor/rules/always-gate.mdc');
assert.equal(fs.existsSync(path.join(personaRoot, created)), true);
const afterCreate = workspaceContext(personaRoot);
assert.ok(
	afterCreate.alwaysOn.some((item) => item.path === created),
	'an always-on rule created from the board appears immediately'
);
assert.equal(deleteContextFile(personaRoot, created), true);
assert.equal(fs.existsSync(path.join(personaRoot, created)), false);
assert.equal(deleteContextFile(personaRoot, 'AGENTS.md'), false);

const sharedId = scanned.available.find((item) => item.path.endsWith('shared.mdc')).id;
assert.equal(createContextCategory(personaRoot, 'My Picks'), 'my-picks');
assert.equal(
	fs.existsSync(path.join(personaRoot, '.cursor', 'rules', 'my-picks')),
	true,
	'a custom tab creates its rules folder'
);
const categorized = createContextFile(personaRoot, {
	kind: 'rule',
	name: 'Picked Rule',
	description: 'created in the custom tab',
	categoryId: 'my-picks',
});
assert.equal(categorized, '.cursor/rules/my-picks/picked-rule.mdc');
assert.equal(toggleContextFavorite(personaRoot, sharedId), true);
assert.equal(setContextCategory(personaRoot, `workspace:${categorized}`, 'my-picks', true), true);
const decorated = workspaceContext(personaRoot);
const decoratedShared = decorated.available.find((item) => item.id === sharedId);
const decoratedCategorized = decorated.available.find((item) => item.path === categorized);
assert.equal(decoratedShared.favorite, true, 'favorites survive a catalog refresh');
assert.deepEqual(decoratedCategorized.categoryIds, ['my-picks'], 'new context keeps its custom-tab membership');
const tabsPayload = payloadFor(sampleState, false, roleMap, 'conv-a', decorated, Date.now());
assert.equal(
	tabsPayload.contextTabs.find((tab) => tab.id === 'favorites').count,
	1,
	'dynamic favorite counts use decorated items'
);
assert.equal(
	tabsPayload.contextTabs.find((tab) => tab.id === 'category:my-picks').count,
	1,
	'custom categories become tabs'
);
assert.equal(removeContextCategory(personaRoot, 'my-picks'), true);
fs.rmSync(personaRoot, { recursive: true, force: true });

// Global rules mirror Cursor's own ~/.cursor folder, outside the workspace context tabs.
const cursorHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-cursor-home-'));
fs.writeFileSync(path.join(cursorHome, 'AGENTS.md'), '# global agents\n');
const createdGlobal = createGlobalRule('Review Bar', 'keep reviews tight', cursorHome);
assert.equal(createdGlobal, path.join(cursorHome, 'rules', 'review-bar.mdc'));
assert.deepEqual(
	globalRules(cursorHome).map((rule) => rule.id),
	['global:AGENTS.md', 'global:rules/review-bar.mdc'],
	'global rules list AGENTS.md plus every file under ~/.cursor/rules'
);
assert.equal(globalRules(cursorHome)[1].detail, 'keep reviews tight');
assert.equal(globalRuleFile('global:rules/review-bar.mdc', cursorHome), fs.realpathSync(createdGlobal));
assert.equal(globalRuleFile('global:../outside.md', cursorHome), null, 'global rule ids cannot escape ~/.cursor');
assert.equal(
	globalRuleFile('global:mcp.json', cursorHome),
	null,
	'only AGENTS.md and ~/.cursor/rules files are reachable'
);
assert.equal(contextItemFile(cursorHome, 'global:AGENTS.md'), null, 'context ids stay workspace-only');
fs.rmSync(cursorHome, { recursive: true, force: true });

const pruneRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-prune-'));
fs.mkdirSync(path.join(pruneRoot, '.cursor', 'rules'), { recursive: true });
fs.writeFileSync(
	path.join(pruneRoot, '.cursor', 'rules', 'temp.mdc'),
	'---\ndescription: temp\nalwaysApply: false\n---\n'
);
const pruneId = 'workspace:.cursor/rules/temp.mdc';
assert.equal(toggleContextFavorite(pruneRoot, pruneId), true);
assert.equal(createContextCategory(pruneRoot, 'Picks'), 'picks');
assert.equal(setContextCategory(pruneRoot, pruneId, 'picks', true), true);
fs.unlinkSync(path.join(pruneRoot, '.cursor', 'rules', 'temp.mdc'));
workspaceContext(pruneRoot);
const cleanedTabs = readContextTabs(pruneRoot);
assert.deepEqual(cleanedTabs.favorites, [], 'stale favorite ids are pruned');
assert.deepEqual(cleanedTabs.assignments.picks, [], 'stale category ids are pruned');
fs.rmSync(pruneRoot, { recursive: true, force: true });

// A project that lists every role in one charter file.
const charterRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-charter-'));
fs.mkdirSync(path.join(charterRoot, '.cursor', 'personas'), { recursive: true });
fs.mkdirSync(path.join(charterRoot, '.cursor', 'skills', 'react'), { recursive: true });
fs.mkdirSync(path.join(charterRoot, '.cursor', 'rules', 'frontend'), { recursive: true });
fs.writeFileSync(
	path.join(charterRoot, '.cursor', 'personas', 'team-roles.md'),
	[
		'# Team Roles',
		'',
		'## Role Index',
		'',
		'- alpha — implement components, hooks, focused UI behavior.',
		'- beta — design, public APIs, boundaries.',
		'- gamma — test strategy, regression coverage.',
		'',
		'## beta',
		'',
		'- Use when: boundaries change.',
		'- Rules: ../rules/frontend/react-typescript.mdc',
		'',
		'## gamma',
		'',
		'- Use when: verifying a change.',
		'',
	].join('\n')
);
fs.writeFileSync(
	path.join(charterRoot, '.cursor', 'rules', 'frontend', 'react-typescript.mdc'),
	'---\ndescription: react rules\nalwaysApply: false\n---\n'
);
fs.writeFileSync(path.join(charterRoot, '.cursor', 'skills', 'react', 'SKILL.md'), '# React skill\n');
fs.writeFileSync(path.join(charterRoot, '.cursor', 'skills', 'react', 'patterns.md'), '# Patterns\n');
const charterCtx = workspaceContext(charterRoot);
assert.deepEqual(
	charterCtx.personas.map((persona) => persona.id),
	['guide', 'alpha', 'beta', 'gamma'],
	"a single charter file yields every role it lists, behind the extension's Extension Assistant card"
);
assert.equal(charterCtx.personaSource, 'charter');
assert.equal(
	charterCtx.personas.find((persona) => persona.id === 'beta').description,
	'design, public APIs, boundaries.',
	'role-index text becomes the persona description'
);
assert.equal(
	charterCtx.available.filter((item) => item.type === 'skill').length,
	2,
	'supporting skill docs are context too, not just SKILL.md'
);
assert.equal(
	contextForPersona(charterCtx, 'beta').available[0].path,
	'.cursor/rules/frontend/react-typescript.mdc',
	'rules a charter points at rank first for that persona'
);
assert.deepEqual(
	charterCtx.available.find((item) => item.path.endsWith('react-typescript.mdc'))?.referencedBy,
	['beta'],
	'charter rule references surface as persona tags'
);
const betaTabs = payloadFor(sampleState, false, roleMap, 'conv-a', charterCtx, Date.now()).contextTabs;
const betaTab = betaTabs.find((tab) => tab.id === 'persona:beta');
assert.ok(
	betaTab.itemIds.some((id) => id.endsWith('react-typescript.mdc')),
	'persona tabs include charter-linked context'
);
assert.deepEqual(
	betaTabs.filter((tab) => tab.kind === 'persona').map((tab) => tab.id),
	['persona:beta'],
	'only the persona of the open session gets a tab'
);
assert.deepEqual(
	payloadFor(sampleState, false, roleMap, undefined, charterCtx, Date.now()).contextTabs.filter(
		(tab) => tab.kind === 'persona'
	),
	[],
	'no session open means no persona tab'
);
// A persona file that names itself in frontmatter is one persona, however many sections its charter
// body has: the Extension Assistant wrote exactly this file and the board showed a card per heading instead.
const sectionedPersona = [
	'---',
	'id: project-manager',
	'title: Project Manager',
	'description: Reconciles declared context against actual repo shape.',
	'---',
	'',
	'## What you read first',
	'',
	'- The declared context, then the repo itself.',
	'',
	'## How you work',
	'',
	'- Read with the file tools rather than assume.',
	'',
	'## What you deliver',
	'',
	'- A roster the user approves before anything is written.',
	'',
].join('\n');
const sectionedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-sectioned-'));
fs.mkdirSync(path.join(sectionedRoot, '.cursor', 'personas'), { recursive: true });
fs.writeFileSync(path.join(sectionedRoot, '.cursor', 'personas', 'project-manager.md'), sectionedPersona);
const sectioned = discoverPersonas(sectionedRoot);
assert.deepEqual(
	sectioned.personas.map((persona) => persona.id),
	['guide', 'project-manager'],
	"a persona's own headings are its charter, not three more personas"
);
assert.equal(sectioned.source, 'personas');
fs.rmSync(sectionedRoot, { recursive: true, force: true });

// And one written beside an existing charter is listed rather than dropped, so a file the user can
// see on disk is a card they can click.
fs.writeFileSync(path.join(charterRoot, '.cursor', 'personas', 'project-manager.md'), sectionedPersona);
const mixed = discoverPersonas(charterRoot);
assert.deepEqual(
	mixed.personas.map((persona) => persona.id),
	['guide', 'alpha', 'beta', 'gamma', 'project-manager'],
	"a self-declared persona joins the charter's roles"
);
assert.equal(mixed.source, 'charter', 'while the charter stays the roster new personas are added to');
fs.rmSync(charterRoot, { recursive: true, force: true });

// An empty workspace is left empty: the board writes no persona of its own, it shows the setup
// panel instead. Discovery reports the preview roster without anything landing on disk.
const emptyWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-empty-'));
assert.equal(discoverPersonas(emptyWorkspace).source, 'fallback');
assert.deepEqual(
	discoverPersonas(emptyWorkspace).personas.map((persona) => persona.id),
	['guide'],
	'an unconfigured project offers one helper, not an invented team'
);
assert.deepEqual(fs.readdirSync(emptyWorkspace), [], 'reading an unconfigured workspace creates no files in it');
fs.rmSync(emptyWorkspace, { recursive: true, force: true });

// An unparseable id leaves the file on disk while discovery still reports the fallback roster.
const staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-stale-'));
const stalePersona = path.join(staleRoot, '.cursor', 'personas', 'broken-role.md');
fs.mkdirSync(path.dirname(stalePersona), { recursive: true });
fs.writeFileSync(stalePersona, '---\nid: 123\ndescription: broken\n---\n');
assert.equal(discoverPersonas(staleRoot).source, 'fallback', 'an invalid id yields no roster');
fs.rmSync(staleRoot, { recursive: true, force: true });

const fallbackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-fallback-'));
const createdPersona = createPersona(fallbackRoot, {
	role: 'Security',
	name: 'Alice',
	description: 'reviews auth and secrets',
});
assert.equal(createdPersona, '.cursor/agent-viz/personas.json');
const fromJson = discoverPersonas(fallbackRoot);
assert.equal(fromJson.source, 'json');
assert.deepEqual(
	fromJson.personas.map((persona) => persona.id),
	['guide', 'security'],
	'the Extension Assistant leads the roster without being written into personas.json'
);
assert.deepEqual(
	JSON.parse(fs.readFileSync(path.join(fallbackRoot, '.cursor', 'agent-viz', 'personas.json'), 'utf8')).map(
		(entry) => entry.id
	),
	['security'],
	"the project's roster file holds only the project's own personas"
);
assert.equal(fromJson.personas.at(-1)?.name, 'Alice');
createPersona(fallbackRoot, { role: 'secops', name: 'Bob', description: 'ops' });
assert.equal(
	createPersona(fallbackRoot, { role: 'infra', description: 'infra' }),
	null,
	'a persona needs one stable name'
);
const kept = discoverPersonas(fallbackRoot).personas.find((persona) => persona.id === 'secops');
assert.equal(kept?.name, 'Bob', 'rewriting personas.json keeps stored display names');
const linked = linkedContextForPersona(
	workspaceContext(
		(() => {
			fs.mkdirSync(path.join(fallbackRoot, '.cursor', 'rules'), { recursive: true });
			fs.writeFileSync(
				path.join(fallbackRoot, '.cursor', 'rules', 'gamma-only.mdc'),
				'---\ndescription: Gamma\nalwaysApply: false\npersonas: gamma\n---\n'
			);
			return fallbackRoot;
		})()
	),
	'gamma'
);
assert.ok(linked.some((item) => item.path.endsWith('gamma-only.mdc')));
fs.rmSync(fallbackRoot, { recursive: true, force: true });

const addCharterRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-add-charter-'));
fs.mkdirSync(path.join(addCharterRoot, '.cursor', 'personas'), { recursive: true });
fs.writeFileSync(
	path.join(addCharterRoot, '.cursor', 'personas', 'team-roles.md'),
	[
		'# Team Roles',
		'',
		'## Role Index',
		'',
		'- alpha — implement components.',
		'- beta — design boundaries.',
		'',
		'## alpha',
		'',
		'- Use when: build UI.',
		'',
		'## beta',
		'',
		'- Use when: design.',
		'',
	].join('\n')
);
assert.equal(
	createPersona(addCharterRoot, {
		role: 'Security',
		name: 'SecOps',
		description: 'reviews secrets',
	}),
	'.cursor/personas/team-roles.md'
);
assert.ok(
	fs.readFileSync(path.join(addCharterRoot, '.cursor', 'personas', 'team-roles.md'), 'utf8').includes('## security'),
	'new personas append to an existing charter'
);
assert.equal(
	discoverPersonas(addCharterRoot).personas.find((persona) => persona.id === 'security')?.name,
	'SecOps',
	'charter personas keep an optional display name'
);
assert.match(
	fs.readFileSync(path.join(addCharterRoot, '.cursor', 'personas', 'team-roles.md'), 'utf8'),
	/\n\n## security\n/,
	'charter persona sections keep a blank line before the heading'
);
fs.rmSync(addCharterRoot, { recursive: true, force: true });

// The Extension Assistant can be sent away — and the
// board remembers that outside the repo, since it was never a file in it.
const dismissRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-dismiss-'));
fs.mkdirSync(path.join(dismissRoot, '.cursor', 'personas'), { recursive: true });
fs.writeFileSync(
	path.join(dismissRoot, '.cursor', 'personas', 'beta.md'),
	'---\nid: beta\ntitle: Beta\ndescription: from disk\n---\n'
);
assert.equal(removePersona(dismissRoot, 'guide'), true, 'the Extension Assistant can be sent away');
assert.deepEqual(
	discoverPersonas(dismissRoot).personas.map((persona) => persona.id),
	['beta'],
	'a dismissed Extension Assistant card stays gone across reads'
);
assert.deepEqual(
	fs.readdirSync(path.join(dismissRoot, '.cursor', 'personas')),
	['beta.md'],
	'dismissing the Extension Assistant writes nothing into the project'
);
fs.rmSync(dismissRoot, { recursive: true, force: true });

// No persona is kept against the user's wishes, so the Extension Assistant goes even when it is the only card and
// the board is left empty. It is a preference rather than a file, so there is a way back.
const guideOnlyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-guide-only-'));
assert.equal(removePersona(guideOnlyRoot, 'guide'), true, "the last card is still the user's to drop");
assert.deepEqual(
	discoverPersonas(guideOnlyRoot).personas,
	[],
	'an emptied board shows no roster rather than reviving one'
);
assert.equal(restoreGuide(guideOnlyRoot), true, 'and the Extension Assistant can be asked back');
assert.deepEqual(
	discoverPersonas(guideOnlyRoot).personas.map((persona) => persona.id),
	['guide'],
	'which puts it at the head of the roster again'
);
assert.equal(restoreGuide(guideOnlyRoot), false, 'restoring the Extension Assistant that never left is a no-op');
fs.rmSync(guideOnlyRoot, { recursive: true, force: true });

const removeJsonRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-remove-json-'));
createPersona(removeJsonRoot, { role: 'Security', name: 'Alice', description: 'reviews secrets' });
createPersona(removeJsonRoot, { role: 'Infra', name: 'Ian', description: 'runs the cluster' });
assert.equal(removePersona(removeJsonRoot, 'security'), true);
assert.equal(
	discoverPersonas(removeJsonRoot).personas.some((persona) => persona.id === 'security'),
	false
);
assert.equal(
	removePersona(removeJsonRoot, 'infra'),
	true,
	'the last project persona goes too: an empty roster is a state the user can ask for'
);
assert.equal(
	fs.existsSync(path.join(removeJsonRoot, '.cursor', 'agent-viz', 'personas.json')),
	false,
	'and the emptied roster file goes with it rather than being left as []'
);
fs.rmSync(removeJsonRoot, { recursive: true, force: true });

console.log('workspace-context checks passed');
