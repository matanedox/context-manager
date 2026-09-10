/** Pull Cursor's own session cookie out of its state DB and read the account usage summary. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { accountSub, cursorStateDbPath, sessionCookieFromAccessToken } from './cursor-session';
import { parseUsageSummary, type UsageReading } from './cursor-usage';

const API = 'https://cursor.com/api';
const TOKEN_KEY = 'cursorAuth/accessToken';
const nodeRequire = createRequire(__filename);

export type AccountUsageLoad =
	{ kind: 'needsAuth' } | { kind: 'error'; message: string } | { kind: 'ready'; reading: UsageReading };

type SqliteDatabase = {
	prepare(sql: string): { get(...params: unknown[]): Record<string, unknown> | undefined };
	close(): void;
};

/** `{}` is a readable DB with nobody logged in; `unreadable` is no reader for it at all. */
export type TokenRead = { token?: string; unreadable?: boolean };

/**
 * Cursor's own runtime (Electron 42 / Node 24) has `node:sqlite`, so no interpreter is needed.
 * ponytail: the DB grows past a gigabyte, so scanning its bytes is not an option; older hosts
 * without `node:sqlite` fall through to a Python reader, and say so when that is missing too.
 */
function readWithNodeSqlite(dbPath: string): TokenRead {
	let db: SqliteDatabase;
	try {
		const { DatabaseSync } = nodeRequire('node:sqlite') as {
			DatabaseSync: new (path: string, options: { readOnly: boolean }) => SqliteDatabase;
		};
		db = new DatabaseSync(dbPath, { readOnly: true });
	} catch {
		return { unreadable: true };
	}
	try {
		const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(TOKEN_KEY);
		return { token: typeof row?.value === 'string' ? row.value : undefined };
	} catch {
		return { unreadable: true };
	} finally {
		db.close();
	}
}

export function pythonCommands(platform = process.platform): Array<[string, string[]]> {
	return platform === 'win32'
		? [
				['py', ['-3']],
				['python', []],
				['python3', []],
			]
		: [
				['python3', []],
				['python', []],
			];
}

/** Read-only; immutable URI so a live Cursor WAL lock does not block us. */
export function readToken(dbPath = cursorStateDbPath()): TokenRead {
	if (!existsSync(dbPath)) return {};
	const native = readWithNodeSqlite(dbPath);
	if (!native.unreadable) return native;
	// Exit code, not empty output, separates "read it, nobody is logged in" from "could not read it".
	const script = [
		'import sqlite3, sys',
		'path = sys.argv[1].replace(chr(92), "/")',
		"base = 'file:///' + path.lstrip('/')",
		"for uri in (base + '?mode=ro', base + '?mode=ro&immutable=1'):",
		'    try:',
		'        con = sqlite3.connect(uri, uri=True)',
		`        row = con.execute('SELECT value FROM ItemTable WHERE key = ?', ('${TOKEN_KEY}',)).fetchone()`,
		'        con.close()',
		"        sys.stdout.write(str(row[0]) if row and row[0] else '')",
		'        sys.exit(0)',
		'    except Exception:',
		'        continue',
		'sys.exit(3)',
	].join('\n');
	for (const [command, prefix] of pythonCommands()) {
		const result = spawnSync(command, [...prefix, '-c', script, dbPath], {
			encoding: 'utf8',
			timeout: 4000,
			windowsHide: true,
		});
		if (result.error || result.status !== 0) continue;
		const token = result.stdout?.trim();
		return token ? { token } : {};
	}
	return { unreadable: true };
}

function get(path: string, cookie: string): Promise<Response> {
	return fetch(`${API}/${path}`, {
		headers: { Cookie: `WorkosCursorSessionToken=${cookie}`, Origin: 'https://cursor.com' },
	});
}

export async function fetchUsageReading(
	cookie: string,
	sub?: string
): Promise<UsageReading | 'unauthorized' | 'error'> {
	try {
		const summary = await get('usage-summary', cookie);
		if (summary.status === 401 || summary.status === 403) return 'unauthorized';
		if (!summary.ok) return 'error';
		// The Included-Request card comes from the older endpoint; on-demand alone still reads.
		const counts = sub
			? await get(`usage?user=${encodeURIComponent(sub)}`, cookie)
					.then((response) => (response.ok ? response.json() : undefined))
					.catch(() => undefined)
			: undefined;
		return parseUsageSummary(await summary.json(), counts) ?? 'error';
	} catch {
		return 'error';
	}
}

export async function loadAccountUsage(): Promise<AccountUsageLoad> {
	const { token, unreadable } = readToken();
	const cookie = token ? sessionCookieFromAccessToken(token) : null;
	// Offering the login page again would loop forever when nothing here can read the session.
	if (unreadable) return { kind: 'error', message: 'Usage needs a newer Cursor build' };
	if (!cookie || !token) return { kind: 'needsAuth' };
	const result = await fetchUsageReading(cookie, accountSub(token));
	if (result === 'unauthorized') return { kind: 'needsAuth' };
	if (result === 'error') return { kind: 'error', message: 'Usage unavailable' };
	return { kind: 'ready', reading: result };
}
