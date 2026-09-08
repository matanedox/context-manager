/**
 * The first session a workspace starts explains the board in the chat itself, which beats a README
 * nobody opens. Delivered as a board request through the handoff pipeline the hooks already read.
 */
import * as fs from 'fs';
import * as path from 'path';
import { checkHooks } from './hooks-install';
import { discoverPersonas, guideDismissed, isGuide, personaDisplayName, type Persona } from './personas';
import { runtimeDir } from './runtime-dir';

/** A preference, not session state: it has to survive the purge that runs when a session closes. */
function marker(root: string): string {
	return path.join(runtimeDir(root), 'intro-shown');
}

/**
 * Waiting in the new chat's input, unsent: the user reads the hello and presses enter, which is
 * what makes the walkthrough above a reply rather than the board talking to itself.
 */
export const HELLO_PROMPT =
	'Who are you? And what is the Context Manager extension — what problem does it solve, what is it for, and what can it do?';

/** Claimed once per window, so a sidebar and an editor panel opening together start one chat. */
let walkthroughOffered = false;

/** The claimed walkthrough's note, waiting for the Onboarding session the board is about to start. */
let introPending = false;

/** Records the walkthrough as spent; false when it was already spent, or could not be recorded. */
function markShown(root: string): boolean {
	const file = marker(root);
	try {
		if (fs.existsSync(file)) return false;
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, `${new Date().toISOString()}\n`);
		return true;
	} catch {
		return false;
	}
}

/**
 * Whether entering the board should start the Onboarding chat itself. The marker is the first-run test:
 * an empty event log is not, since the hooks fill it the moment they work and every board would
 * read as live before its first open. Only with the hooks installed, since they are what delivers
 * the note. Spent here rather than when the chat asks for its note, so a first entry that never
 * reaches its chat is still the only one: the next window opens a board with no walkthrough.
 */
export function walkthroughDue(root: string | undefined): boolean {
	const due =
		!walkthroughOffered &&
		!!root &&
		!fs.existsSync(marker(root)) &&
		!guideDismissed(root) &&
		checkHooks(root).ready;
	if (!due) return false;
	walkthroughOffered = true;
	introPending = markShown(root);
	return true;
}

/** A reset puts the workspace back to first run, and the once-per-window claim has to go with it. */
export function resetWalkthrough(): void {
	walkthroughOffered = false;
	introPending = false;
}

/**
 * The roster the project already declares, so the walkthrough offers what is missing instead of a
 * team the project has. The guide is the extension's own card, not something the project owns.
 */
function declaredRoster(root: string | undefined): Persona[] {
	return root ? discoverPersonas(root).personas.filter((persona) => !isGuide(persona.id)) : [];
}

function titleList(roster: Persona[]): string {
	return roster
		.slice(0, 6)
		.map((persona) => persona.title)
		.join(', ');
}

/** The last lines of the note: an offer, a redirect to the manager the project already has. */
function closingLines(roster: Persona[]): string[] {
	const manager = roster.find((persona) => persona.id === 'project-manager');
	if (manager) {
		const name = personaDisplayName(manager);
		return [
			`Close on what this project already has, in two short lines: its roster — ${roster.length} personas, ${titleList(roster)} — and its ${manager.title}${name ? `, who goes by ${name}` : ''}, who already owns the mapping and the delegation. Tell them to click that card on Team to put it to work, and stop.`,
			`Do not offer to create a Project Manager, do not propose a roster of your own, and do not edit any files. If they say a role is missing, that is that persona's call to make with them: offer to hand it the note rather than writing the persona yourself.`,
		];
	}
	const offer = roster.length
		? `Close by naming what the project already declares — ${roster.length} personas: ${titleList(roster)} — and offering the one job none of them owns, in two short lines: a Project Manager, who reads the context files and the repo itself, runs the roster, and hands work to the persona that owns it — and once they have that persona they can send you away. Ask whether to add it, then stop and wait. Do not inventory the project yet. Do not edit any files on this turn.`
		: `Close by offering one thing, in two short lines: a Project Manager, the first persona this project would own, which reads the context files and the repo itself and proposes a first roster from what it finds — and once they have that second persona they can send you away. Ask whether to add it, then stop and wait. Do not inventory the project yet. Do not edit any files on this turn.`;
	return [
		offer,
		`The rest applies to your next turn, once they answer.`,
		`If they decline: acknowledge it, write nothing, and do not ask again.`,
		`If they accept: list .cursor/personas/ before writing, with a glob or the terminal rather than a file read, and open a file only once you know it is there. If they chose a display name, add a name: key with that value. When one file there already lists several roles, append a "## project-manager" section and a Role Index bullet to that file — a separate file beside a charter never reaches the board. Otherwise create .cursor/personas/project-manager.md, opening with exactly this frontmatter, these keys:`,
		`---`,
		`id: project-manager`,
		`title: Project Manager`,
		`description: Runs the project and roster — mapping, delegation, and ownership — without doing the implementer's work.`,
		`---`,
		`Give it a charter body stating both duties it keeps, running the roster first and building it second. Running is the standing job: break work into tasks, give each one to the persona whose charter owns that cut, hand it over with the context files and a done-when, track what is in flight or blocked, and reassign when ownership was wrong rather than adding a persona to avoid the question. It does not implement, and it never assigns project work to Onboarding. Building the team is the occasional job: read the declared context (.cursor/rules, .cursor/skills, .cursor/workflows, .cursor/personas, AGENTS.md), then the repo as it actually is (top-level layout, package manifests, entrypoints, test directories), report where the two disagree, propose the smallest roster that follows the code — skipping roles that already exist — and write persona files only once the user approves them, each with id, title, and one stable name in frontmatter so it lands as one named card. Ask before changing an existing persona's name. Say in that charter that it must read the repo with the file and terminal tools rather than assume how the project is arranged, and that when asked who it is it answers with its name, role, and that job, never with a model name.`,
		`Then tell them to click the new Project Manager card on Team to start that chat, and stop.`,
	];
}

export function introNote(root?: string): string {
	const roster = declaredRoster(root);
	return [
		`Answer short, in your own voice, the way you would show a new colleague around: contractions, plain sentences, first person throughout, no headings. Four short paragraphs, one bullet list, nothing more.`,
		`Open with exactly this line, then finish the same paragraph with one sentence on what you do — you show them around the board and help them get a team started: "I'm Onboarding — I show you around this board." Do not claim the mapping work itself; that is the Project Manager's job and you offer it at the end. Do not name internal persona ids and do not say which persona you are wearing.`,
		`Then the problem in one sentence: a repo's agent context already describes how its team works, but it is buried in markdown files and @-mentions, so nobody can see who owns what, which context a given chat actually receives, or who handed off to whom.`,
		`Then one sentence on what Context Manager does about it: it puts that existing context on a live board, visible and editable in place.`,
		`Then four markdown bullets, a few words each, no labels with colons: start a chat with any persona; see and adjust the context each one receives; hand work or a note to another session or subagent; edit the context markdown without leaving the board.`,
		...closingLines(roster),
	].join('\n');
}

/**
 * The note for the chat the board just claimed the walkthrough for. Only that one: a session the
 * user starts themselves would otherwise make some implementer deliver the Onboarding introduction.
 */
export function takeIntroNote(root?: string): string | null {
	if (!introPending) return null;
	introPending = false;
	return introNote(root);
}
