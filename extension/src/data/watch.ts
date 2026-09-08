/** Repaint triggers: fs.watch on .cursor plus a poll, because hook writes slip past the watcher. */
import * as fs from 'fs';
import * as path from 'path';
import { runtimeDir } from './runtime-dir';

/** Poll context the board owns: whether anyone is looking and when it last painted. */
export type LiveCheck = { visible: boolean; agentLive: boolean; sincePaint: number };

export class BoardWatcher {
	private watchers: fs.FSWatcher[] = [];
	private debounce?: ReturnType<typeof setTimeout>;
	private poll?: ReturnType<typeof setInterval>;
	private eventBytes = 0;
	private marks = new Map<string, number>();

	start(root: string | undefined, refresh: () => void, live: () => LiveCheck): void {
		if (this.watchers.length || !root) return;
		const bump = () => {
			if (this.debounce) clearTimeout(this.debounce);
			this.debounce = setTimeout(refresh, 80);
		};
		// The workspace .cursor holds the files the user owns, but the hooks write session state to the
		// runtime dir: watching only the workspace left every hook report — a chat closed in Cursor
		// above all — waiting on the next poll tick before the board could react to it.
		for (const dir of [path.join(root, '.cursor'), runtimeDir(root)]) {
			try {
				if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
				this.watchers.push(fs.watch(dir, { recursive: true }, bump));
			} catch {
				/* ponytail: first hook creates the file, and the poll covers a dir we cannot watch */
			}
		}
		this.startPoll(root, refresh, live);
	}

	stop(): void {
		for (const watcher of this.watchers) watcher.close();
		this.watchers = [];
		if (this.debounce) clearTimeout(this.debounce);
		if (this.poll) {
			clearInterval(this.poll);
			this.poll = undefined;
		}
	}

	private startPoll(root: string, refresh: () => void, live: () => LiveCheck): void {
		if (this.poll) return;
		const dir = runtimeDir(root);
		const eventsPath = path.join(dir, 'events.jsonl');
		this.eventBytes = size(eventsPath) ?? 0;
		this.poll = setInterval(() => {
			const status = live();
			if (!status.visible) return;
			let changed = false;
			const bytes = size(eventsPath);
			if (bytes !== undefined && bytes !== this.eventBytes) {
				this.eventBytes = bytes;
				changed = true;
			}
			for (const file of ['current-state.json', 'context-handoffs.jsonl']) {
				const mtime = mtimeMs(path.join(dir, file));
				if (mtime === undefined) continue;
				const previous = this.marks.get(file) ?? 0;
				if (previous && mtime > previous) changed = true;
				this.marks.set(file, mtime);
			}
			if (changed || status.agentLive || status.sincePaint > 4000) refresh();
		}, 800);
	}
}

function size(file: string): number | undefined {
	try {
		return fs.statSync(file).size;
	} catch {
		return undefined;
	}
}

function mtimeMs(file: string): number | undefined {
	try {
		return fs.statSync(file).mtimeMs;
	} catch {
		return undefined;
	}
}
