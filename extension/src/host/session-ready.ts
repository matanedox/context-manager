/** Wait for Cursor to expose the chat id, including background chats visible only to hooks. */
import { chatIds } from './cursor-chat';
import { parseLines } from '../model/events';
import { loadEvents } from '../data/io';

function newIds(before: Set<string>, ids: string[]): string[] {
	return ids.filter((id) => !before.has(id));
}

function pickTabId(before: Set<string>, ids: string[]): string | undefined {
	// ponytail: an empty baseline can't tell new from existing tabs — rely on hooks instead.
	if (!before.size) return undefined;
	return newIds(before, ids)[0];
}

function hookCreatedId(
	events: ReturnType<typeof parseLines>,
	afterEventCount: number,
	before: Set<string>
): string | undefined {
	return [...events.slice(afterEventCount)]
		.reverse()
		.find(
			(event) =>
				(event.type === 'sessionStart' || event.raw?.hook_event_name === 'sessionStart') &&
				event.raw?.conversation_id &&
				!before.has(event.raw.conversation_id)
		)?.raw?.conversation_id;
}

function pickCreatedId(
	before: Set<string>,
	ids: string[],
	fromHook: string | undefined,
	fromTabs: string | undefined
): string | undefined {
	const fresh = newIds(before, ids);
	if (fromHook && fresh.includes(fromHook)) return fromHook;
	if (fromTabs) return fromTabs;
	if (fromHook) return fromHook;
	// ponytail: empty baseline can't distinguish new from existing tabs — rely on hooks.
	if (!before.size) return undefined;
	return fresh[fresh.length - 1];
}

export async function waitForCreatedChat(
	root: string | undefined,
	extensionPath: string,
	before: Set<string>,
	afterEventCount: number,
	timeoutMs = 5000
): Promise<string | undefined> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const loaded = loadEvents(root, extensionPath);
		// The demo log carries sessionStart ids of its own. Reading those as the chat Cursor just
		// created bound the session to a demo id, and revealing it opened a second, empty chat.
		const events = loaded.usingDemo ? [] : parseLines(loaded.text);
		const fromHook = hookCreatedId(events, afterEventCount, before);
		const ids = await chatIds();
		const fromTabs = pickTabId(before, ids);
		const picked = pickCreatedId(before, ids, fromHook, fromTabs);
		if (picked) return picked;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return undefined;
}
