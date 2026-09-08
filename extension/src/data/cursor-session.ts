/** Where Cursor keeps its own session, and the cookie shape its dashboard API expects. */
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CURSOR_LOGIN_URL = 'https://cursor.com/login';
export const CURSOR_USAGE_URL = 'https://cursor.com/dashboard/usage';

export function cursorStateDbPath(): string {
	if (process.platform === 'darwin') {
		return join(homedir(), 'Library/Application Support/Cursor/User/globalStorage/state.vscdb');
	}
	if (process.platform === 'win32') {
		return join(process.env.APPDATA ?? join(homedir(), 'AppData/Roaming'), 'Cursor/User/globalStorage/state.vscdb');
	}
	return join(homedir(), '.config/Cursor/User/globalStorage/state.vscdb');
}

export function jwtPayload(jwt: string): Record<string, unknown> | null {
	const parts = jwt.split('.');
	if (parts.length < 2) return null;
	try {
		const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** The `sub` claim as-is: what `/api/usage?user=` wants. */
export function accountSub(jwt: string): string | undefined {
	const sub = jwtPayload(jwt)?.sub;
	return typeof sub === 'string' && sub ? sub : undefined;
}

/** Dashboard cookie value: WorkOS user id + JWT, `::` encoded the way cursor.com sends it. */
export function sessionCookieFromAccessToken(jwt: string): string | null {
	const sub = accountSub(jwt);
	if (!sub) return null;
	const userId = sub.includes('|') ? sub.slice(sub.lastIndexOf('|') + 1) : sub;
	if (!userId) return null;
	return `${userId}%3A%3A${jwt}`;
}
