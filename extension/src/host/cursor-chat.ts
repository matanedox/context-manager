/** Cursor's own composer actions. A conversation id is the composer id these commands take. */
import * as path from 'path';
import * as vscode from 'vscode';

// Only allocating a new composer fires the sessionStart hook the board waits for, so
// "Create New Composer" comes first and the panel commands are fallbacks.
const NEW_CHAT = ['composer.createNew', 'aichat.newchataction', 'workbench.action.chat.openInSidebar'];
const OPEN = ['composer.openComposer'];

let serial = Promise.resolve();
let pendingOpen: string | undefined;

async function runFirst(commands: string[], ...args: unknown[]): Promise<boolean> {
	for (const command of commands) {
		try {
			await vscode.commands.executeCommand(command, ...args);
			return true;
		} catch {
			/* try the next fallback */
		}
	}
	return false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One chat-side effect at a time so archive/start/open cannot stomp each other. */
export function runChatTask<T>(fn: () => Promise<T>): Promise<T> {
	const task = serial.then(fn);
	serial = task.then(
		() => undefined,
		() => undefined
	);
	return task;
}

/**
 * Rapid session clicks coalesce to the latest id so an in-flight open for chat A cannot
 * finish after the user already picked chat B.
 */
export function scheduleOpenChat(conversationId: string): void {
	pendingOpen = conversationId;
	void runChatTask(async () => {
		while (pendingOpen) {
			const target = pendingOpen;
			pendingOpen = undefined;
			await openChat(target);
		}
	});
}

/**
 * `prefill` is left sitting in the new chat's input for the user to send: Cursor only submits a
 * composer's text when the create asks it to, so the board never speaks for the user.
 */
export async function newChat(background = false, prefill?: string, replaceTab = false): Promise<boolean> {
	// Cursor's default create command replaces the selected tab, which fires sessionEnd even
	// when that chat is still working. With hooks, create off-screen and reveal it only after
	// the extension has bound its persona context.
	//
	// The walkthrough asks for that replacement: the tab it would otherwise open beside is Cursor's
	// own empty composer, which the board cannot see to close and which left every first open
	// showing two chats. Every other prefilled chat still wants its own tab.
	const options = {
		...(prefill ? { partialState: { text: prefill, richText: prefill } } : {}),
		...(replaceTab ? {} : { openInNewTab: true }),
		...(background ? { skipSelect: true, skipShowAndFocus: true } : {}),
	};
	// Cursor fires sessionStart before it finishes storing the composer, so a create that rejects
	// has already made a chat. Falling back on a rejection opened a second one, so the fallbacks are
	// chosen by what the build registers and only one create command ever runs.
	const available = new Set(await vscode.commands.getCommands(true));
	const create = NEW_CHAT.find((command) => available.has(command));
	if (!create) return false;
	// Every create gets the options, including the fallbacks: dropping them there left the
	// walkthrough with no prefill. A rejected create has already made a chat, so it is never retried.
	return runFirst([create], options);
}

/**
 * Ids of the chats Cursor has open in the chat pane; a chat id is its conversation id. Cursor titles
 * this command "Get Ordered Pane Composer IDs", so a chat opened as an editor tab is not in here:
 * treat a missing id as unknown rather than as proof the chat is gone.
 */
export async function chatIds(): Promise<string[]> {
	try {
		const ids = await vscode.commands.executeCommand('composer.getOrderedSelectedComposerIds');
		return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

/**
 * Identify the chat Cursor just created by watching its open chats, so a session no longer
 * depends on a sessionStart hook the board cannot verify.
 */
export async function waitForNewChat(before: Set<string>, timeoutMs = 5000): Promise<string | undefined> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const found = (await chatIds()).find((id) => !before.has(id));
		if (found) return found;
		await sleep(150);
	}
	return undefined;
}

// getOrderedSelectedComposerIds is tab order, not focus, so index 0 only ever matched the first
// tab: presence is all it can honestly tell us, and openComposer is what moves the focus.
async function chatReady(conversationId: string, timeoutMs = 2000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if ((await chatIds()).includes(conversationId)) return true;
		await sleep(80);
	}
	return false;
}

const ATTACH_FILE = ['composer.addfilestocomposer', 'composer.addFilesToComposer', 'composer.addFilesToContext'];

/**
 * Switch Cursor to this chat and put the caret back in its composer. focusComposer falls back to
 * Cursor's own selected composer when called bare, which is why it needs the id spelled out.
 */
export async function focusChat(conversationId: string): Promise<boolean> {
	if (!(await openChat(conversationId))) return false;
	await runFirst(['composer.focusComposer'], conversationId);
	return true;
}

/**
 * Attach a workspace file to a chat's composer. Cursor attaches to whichever composer is focused,
 * so the chat is focused first; useExactResource keeps it from attaching whatever the explorer
 * happens to have selected instead of this file.
 */
export async function attachFileToChat(conversationId: string, filePath: string): Promise<boolean> {
	if (!(await focusChat(conversationId))) return false;
	const uri = vscode.Uri.file(filePath);
	for (const command of ATTACH_FILE) {
		try {
			await vscode.commands.executeCommand(command, uri, { useExactResource: true });
			return true;
		} catch {
			/* try next signature */
		}
		try {
			await vscode.commands.executeCommand(command, { files: [uri] });
			return true;
		} catch {
			/* try next command */
		}
	}
	const mention = `@${path.basename(filePath)}`;
	await vscode.env.clipboard.writeText(mention);
	void vscode.window.showInformationMessage(
		`Could not attach automatically. Copied ${mention} — paste it in the chat.`
	);
	return false;
}

/** Switch Cursor to this chat without swapping the previous one out of the tab strip. */
export async function openChat(conversationId: string): Promise<boolean> {
	const listed = (await chatIds()).includes(conversationId);
	for (let attempt = 0; attempt < 2; attempt++) {
		// A chat created off-screen is in no tab yet, so the first open asks for one. Only the first:
		// the retry is there for an open the pane list could not confirm, and asking for a tab again
		// gave one persona click two tabs of the same chat.
		const opts = listed || attempt > 0 ? [] : [{ openInNewTab: true }];
		if (!(await runFirst(OPEN, conversationId, ...opts))) return false;
		if (await chatReady(conversationId, 500)) return true;
		await sleep(120);
	}
	// ponytail: a chat Cursor put in an editor tab never shows up in the pane list, so it can never
	// confirm. The open command resolved, so report success instead of reopening it another four
	// times and then telling callers it failed. Upgrade path: also read chat editor tabs.
	return true;
}

/**
 * Make an idle chat take a turn so its stop hook fires and speaks whatever handoff is queued
 * there. Cursor's resume command takes no id and acts on the selected composer, so the chat is
 * focused by id first — an open alone left the note in whichever chat the user was already in.
 */
export async function nudgeChat(conversationId: string): Promise<boolean> {
	if (!(await focusChat(conversationId))) return false;
	return runFirst(['composer.resumeCurrentChat']);
}

// Cursor archives whichever chat is focused rather than one named by id, so the id-taking
// commands are tried first and the active-chat ones only after focusing the target.
const ARCHIVE_BY_ID = ['composer.archiveComposer', 'composer.archiveChat'];
const ARCHIVE_ACTIVE = ['glass.archiveActiveAgent', 'composer.archiveActiveComposer'];

/**
 * Archive the chat in Cursor so it leaves the chat list, not just the tab strip. Falls back to
 * closing the tab when the running Cursor build exposes no archive command.
 */
export async function archiveChat(conversationId: string): Promise<boolean> {
	const available = new Set(await vscode.commands.getCommands(true));
	const listed = (await chatIds()).includes(conversationId);
	const byId = ARCHIVE_BY_ID.find((command) => available.has(command));
	if (byId && (await runFirst([byId], conversationId)) && (await left(conversationId, listed))) {
		return true;
	}
	const active = ARCHIVE_ACTIVE.find((command) => available.has(command));
	if (active) {
		await openChat(conversationId);
		if ((await runFirst([active])) && (await left(conversationId, listed))) return true;
	}
	return runFirst(['composer.closeComposerTab'], conversationId);
}

/** Drop a chat from the tab strip only: the conversation stays in Cursor's chat history. */
export function closeChatTab(conversationId: string): Promise<boolean> {
	return runFirst(['composer.closeComposerTab'], conversationId);
}

/**
 * An archive command resolves even when a scope guard made it a no-op, so confirm the chat
 * actually left Cursor's open list before calling it archived.
 */
async function left(conversationId: string, wasListed: boolean, timeoutMs = 1500): Promise<boolean> {
	if (!wasListed) return true;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!(await chatIds()).includes(conversationId)) return true;
		await sleep(120);
	}
	return false;
}

/** Test hook: reset the module queue between cases. */
export function resetChatQueueForTests(): void {
	serial = Promise.resolve();
	pendingOpen = undefined;
}
