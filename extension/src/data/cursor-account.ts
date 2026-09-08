/** Pull Cursor's own session cookie out of its state DB and read the account usage summary. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { accountSub, cursorStateDbPath, sessionCookieFromAccessToken } from "./cursor-session";
import { parseUsageSummary, type UsageReading } from "./cursor-usage";

const API = "https://cursor.com/api";

export type AccountUsageLoad =
  | { kind: "needsAuth" }
  | { kind: "error"; message: string }
  | { kind: "ready"; reading: UsageReading };

/** Read-only; immutable URI so a live Cursor WAL lock does not block us. */
export function readCursorAccessToken(dbPath = cursorStateDbPath()): string | undefined {
  if (!existsSync(dbPath)) return undefined;
  const script = [
    "import sqlite3, sys",
    "path = sys.argv[1]",
    "for uri in (f'file:{path}?mode=ro', f'file:{path}?mode=ro&immutable=1'):",
    "    try:",
    "        con = sqlite3.connect(uri, uri=True)",
    "        row = con.execute('SELECT value FROM ItemTable WHERE key = ?', ('cursorAuth/accessToken',)).fetchone()",
    "        con.close()",
    "        if row and row[0]:",
    "            sys.stdout.write(str(row[0]))",
    "            break",
    "    except Exception:",
    "        continue",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script, dbPath], { encoding: "utf8", timeout: 4000 });
  const token = result.stdout?.trim();
  return token || undefined;
}

function get(path: string, cookie: string): Promise<Response> {
  return fetch(`${API}/${path}`, {
    headers: { Cookie: `WorkosCursorSessionToken=${cookie}`, Origin: "https://cursor.com" },
  });
}

export async function fetchUsageReading(
  cookie: string,
  sub?: string
): Promise<UsageReading | "unauthorized" | "error"> {
  try {
    const summary = await get("usage-summary", cookie);
    if (summary.status === 401 || summary.status === 403) return "unauthorized";
    if (!summary.ok) return "error";
    // The Included-Request card comes from the older endpoint; on-demand alone still reads.
    const counts = sub
      ? await get(`usage?user=${encodeURIComponent(sub)}`, cookie)
          .then((response) => (response.ok ? response.json() : undefined))
          .catch(() => undefined)
      : undefined;
    return parseUsageSummary(await summary.json(), counts) ?? "error";
  } catch {
    return "error";
  }
}

export async function loadAccountUsage(): Promise<AccountUsageLoad> {
  const token = readCursorAccessToken();
  const cookie = token ? sessionCookieFromAccessToken(token) : null;
  if (!cookie || !token) return { kind: "needsAuth" };
  const result = await fetchUsageReading(cookie, accountSub(token));
  if (result === "unauthorized") return { kind: "needsAuth" };
  if (result === "error") return { kind: "error", message: "Usage unavailable" };
  return { kind: "ready", reading: result };
}
