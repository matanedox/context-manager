/** Start a chat for a persona and bind its identity before the chat is revealed. */
import * as vscode from 'vscode';
import { eventType, parseLines } from '../../model/events';
import { isRole, roleLabel, type Role } from '../../model/roles';
import { chatIds, closeChatTab, focusChat, newChat, nudgeChat, runChatTask } from '../cursor-chat';
import { appendHandoff } from '../../data/handoffs';
import { checkHooks } from '../../data/hooks-install';
import { HELLO_PROMPT, takeIntroNote } from '../../data/intro';
import type { InlineLoading } from '../inline-loading';
import {
	appendSessionStart,
	bindSessionRole,
	clearPendingRole,
	loadEvents,
	readPersistedState,
	writePendingRole,
} from '../../data/io';
import { finishAutoContinue, unclaimAutoContinue } from '../../data/auto-continue';
import { personaDisplayName } from '../../data/personas';
import { planSiblingNotes } from '../../data/sibling-sessions';
import { workspaceContext } from '../../data/workspace-context';
import { personaName } from '../../present/persona';
import { waitForCreatedChat } from '../session-ready';

export type SessionHost = {
	root: string | undefined;
	extensionPath: string;
	loading: InlineLoading;
	refresh: () => void;
	/** Hold the board on this chat while it is being created. */
	pin: (conversationId: string) => void;
	/** Let focus sync move again; `clearSelection` also drops the chat that failed to bind. */
	release: (clearSelection?: boolean) => void;
	showAgentPage: () => void;
};

/**
 * Cursor keeps one empty chat in a window, and a persona start opens beside it rather than swapping
 * it out, so every first start left a stray tab. These are the chats that were already open, took no
 * turn, and belong to no persona.
 *
 * ponytail: a chat whose history predates the hook log reads as quiet too. Only its tab is closed,
 * so the conversation stays in Cursor's history; the upgrade path is a Cursor command that reports a
 * composer's message count.
 */
export function leftoverTabs(
	root: string | undefined,
	extensionPath: string,
	before: Set<string>,
	keep: string
): string[] {
	const loaded = loadEvents(root, extensionPath);
	if (loaded.usingDemo) return [];
	const busy = new Set<string>();
	for (const event of parseLines(loaded.text)) {
		const id = event.raw?.conversation_id;
		if (!id) continue;
		const kind = eventType(event);
		const lifecycle = kind === 'sessionStart' || kind === 'sessionEnd';
		if (!lifecycle || isRole(event.raw?.role)) busy.add(id);
	}
	return [...before].filter((id) => id !== keep && !busy.has(id));
}

/** `continueNote` is what a chat opened beside — or in place of — another one is told about it. */
export function startRoleSession(host: SessionHost, role: Role, continueNote?: string, rolloverFrom?: string): void {
	const token = host.loading.begin(`Starting ${role} session…`);
	void runChatTask(async () => {
		const { root, extensionPath, loading } = host;
		host.release();
		try {
			const loaded = loadEvents(root, extensionPath);
			const afterEventCount = loaded.usingDemo ? 0 : parseLines(loaded.text).length;
			const before = new Set(await chatIds());
			writePendingRole(root, role, afterEventCount);
			host.refresh();

			// The walkthrough the board claimed on its first entry, if this is that chat.
			const hooksReady = checkHooks(root).ready;
			const intro = takeIntroNote(root);

			// Create off-screen while hooks bind the persona, then reveal the chat. Not the walkthrough:
			// a prefilled create takes over Cursor's own empty composer, and revealing a hidden chat asks
			// for a tab beside that composer instead — which is the second tab every first open showed.
			// Its note is submitOnly, so sending the hello before the note lands costs the note, not a
			// second introduction.
			// Only the walkthrough is prefilled. A briefed chat used to park a catch-up line here for the
			// user to send, but the resume below delivers its brief on its own, which left that line
			// sitting in the composer after the chat had already answered it.
			const prefill = intro ? HELLO_PROMPT : undefined;
			await newChat(prefill ? false : hooksReady, prefill, Boolean(intro));
			const conversationId = await waitForCreatedChat(root, extensionPath, before, afterEventCount, 5000);
			if (!conversationId) {
				clearPendingRole(root);
				if (rolloverFrom) unclaimAutoContinue(root, rolloverFrom);
				void vscode.window.showWarningMessage(
					`Cursor did not open a new chat for ${role}. The board cleared the starting session.`
				);
				return;
			}
			host.pin(conversationId);
			loading.update(token, `Starting ${role} session…`, conversationId);
			appendSessionStart(root, conversationId, role);
			const contextReady =
				workspaceContext(root).personas.some((persona) => persona.id === role) &&
				bindSessionRole(root, conversationId, role);
			clearPendingRole(root);
			if (!contextReady) {
				if (rolloverFrom) unclaimAutoContinue(root, rolloverFrom);
				host.release(true);
				void vscode.window.showErrorMessage(`Could not load ${role} context. The chat was not opened.`);
				return;
			}
			if (rolloverFrom) finishAutoContinue(root, rolloverFrom, conversationId);
			const persona = workspaceContext(root).personas.find((entry) => entry.id === role);
			const personaLabel =
				personaName(role, persona ? personaDisplayName(persona) : undefined) ?? roleLabel(role, persona?.title);
			// "Another session opened" is for a twin beside you. The chat this one replaces is not a
			// twin, and telling it so cost the retiring chat a turn to acknowledge an aside.
			const siblingNotes = planSiblingNotes(
				readPersistedState(root).sessions ?? [],
				conversationId,
				role,
				personaLabel
			).filter((note) => note.conversationId !== rolloverFrom);
			for (const note of siblingNotes) {
				appendHandoff(root, {
					fromConversationId: note.fromConversationId,
					fromRole: role,
					to: { kind: 'session', role, conversationId: note.conversationId },
					text: note.text,
				});
			}
			// The brief rides the same lane as the walkthrough note: the prefilled line sits in the
			// composer and the hook hands the brief over with it, so the board never speaks for the user.
			const seed = intro ?? continueNote;
			if (seed) {
				appendHandoff(root, {
					fromConversationId: conversationId,
					fromRole: role,
					to: { kind: 'session', role, conversationId },
					text: seed,
					submitOnly: Boolean(intro),
				});
			}
			host.showAgentPage();
			host.refresh();
			if (await loading.finish(token)) {
				// Nothing else may touch a chat between here and the reveal: waking the neighbour to hear
				// it had a sibling made that chat take a turn, and Cursor brings a chat that starts talking
				// to the front — so both a briefed and a clean start left the user back in the old session.
				// The neighbour's note waits for its own next turn.
				//
				// Focused, not just opened: an open puts the chat in front but leaves the caret in the
				// composer the user was already in, so the next thing they typed went to the old session.
				// focusChat still asks for a tab first when the chat was created off-screen.
				//
				// A briefed chat catches itself up rather than waiting to be sent. The brief was written
				// above, and a resume reaches beforeSubmitPrompt, which is where a note is taken — the same
				// append-then-nudge the recap request uses. nudgeChat focuses first, so this is the focus.
				// The walkthrough is never nudged: its note is submitOnly and belongs to the user's send.
				//
				// ponytail: the resume is the only thing that hands the brief over now. Ceiling: a build
				// with no resume command leaves the chat open, focused and uninformed, and the user has to
				// say what they want. Upgrade path: a create that can submit its own prefill.
				if (continueNote && !intro) await nudgeChat(conversationId);
				else await focusChat(conversationId);
				// Queued behind the open, so the persona chat is on screen before its neighbour goes.
				void runChatTask(async () => {
					// A window that just opened lists its empty composer after the baseline was taken, which
					// is how the walkthrough kept leaving one behind: take the tabs open now as well.
					const open = new Set([...before, ...(await chatIds())]);
					for (const stray of leftoverTabs(root, extensionPath, open, conversationId)) {
						await closeChatTab(stray);
					}
				});
				// The walkthrough is not nudged into speaking: the hello sits in the composer and the
				// beforeSubmitPrompt hook hands the note over when the user sends it.
			}
		} catch {
			await loading.finish(token);
			if (rolloverFrom) unclaimAutoContinue(host.root, rolloverFrom);
		} finally {
			host.release();
		}
	});
}
