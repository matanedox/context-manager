/** Detect and install the hooks that log events and inject the per-chat persona identity. */
import * as fs from "fs";
import * as path from "path";

const SCRIPTS = [
  "log-agent-event.sh",
  "inject-persona-context.sh",
  "update-agent-state.mjs",
  "resolve-persona-context.mjs",
];

const IDENTITY = ".cursor/hooks/inject-persona-context.sh";
const LOG = ".cursor/hooks/log-agent-event.sh";

const WIRING: Record<string, string[]> = {
  sessionStart: [LOG, IDENTITY],
  sessionEnd: [LOG],
  beforeSubmitPrompt: [LOG, IDENTITY],
  // Not logged: stop fires on every turn end, and the board already logs afterAgentResponse.
  stop: [IDENTITY],
  subagentStart: [LOG, IDENTITY],
  subagentStop: [LOG, IDENTITY],
  // Identity is not re-injected here: beforeSubmitPrompt covers every turn and the always-on
  // rule is resent each request, so a per-tool-call copy only burns context.
  postToolUse: [LOG],
  postToolUseFailure: [LOG],
  afterAgentResponse: [LOG],
};

/** Wiring dropped in a later version; pruned on repair so old installs stop paying for it. */
const RETIRED = [".cursor/hooks/inject-persona-post-tool.sh"];

const IGNORE_MARKER = "# Context Manager (installed hook copies)";
const IGNORE_PATTERNS = [".cursor/hooks.json", ...SCRIPTS.map((name) => `.cursor/hooks/${name}`)];

export type HookCheck = { ready: boolean; missing: string[] };

/**
 * ponytail: a dev run reads this repo's own hooks; a packaged build needs `hooks/` copied into
 * the extension folder at package time.
 */
export function hookSource(extensionPath: string): string | undefined {
  const candidates = [
    path.join(extensionPath, "hooks"),
    path.join(extensionPath, "..", ".cursor", "hooks"),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, "inject-persona-context.sh")));
}

/** Check every script and event required for identity, activity, and subagent tracking. */
export function checkHooks(root: string | undefined): HookCheck {
  if (!root) return { ready: false, missing: ["workspace"] };
  const missing = SCRIPTS.filter(
    (name) => !fs.existsSync(path.join(root, ".cursor", "hooks", name))
  ).map((name) => `.cursor/hooks/${name}`);
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8")
    ) as { hooks?: Record<string, HookEntry[]> };
    for (const [event, commands] of Object.entries(WIRING)) {
      const entries = Array.isArray(parsed.hooks?.[event]) ? parsed.hooks[event] : [];
      for (const command of commands) {
        if (!entries.some((entry) => entry?.command === command)) {
          missing.push(`${event} → ${command}`);
        }
      }
    }
  } catch {
    missing.push(".cursor/hooks.json");
  }
  return { ready: missing.length === 0, missing };
}

export function hooksInstalled(root: string | undefined): boolean {
  return checkHooks(root).ready;
}

type HookEntry = { command?: string };

function mergeConfig(root: string): void {
  const file = path.join(root, ".cursor", "hooks.json");
  let config: { version?: number; hooks?: Record<string, HookEntry[]> } = {};
  try {
    config = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* no config yet, or unreadable: start from the default wiring */
  }
  const hooks = config.hooks ?? {};
  for (const [event, commands] of Object.entries(WIRING)) {
    const existing = (Array.isArray(hooks[event]) ? hooks[event] : []).filter(
      (entry) => !RETIRED.includes(entry?.command ?? "")
    );
    const missing = commands
      .filter((command) => !existing.some((entry) => entry?.command === command))
      .map((command) => ({ command }));
    hooks[event] = [...existing, ...missing];
  }
  fs.writeFileSync(file, `${JSON.stringify({ version: config.version ?? 1, hooks }, null, 2)}\n`);
}

/**
 * Install now and report what happened. Clicking the board's own Install / Repair button is the
 * consent, so asking again in a notification only left the banner up when that toast was missed.
 */
export async function repairHooks(
  root: string | undefined,
  extensionPath: string
): Promise<boolean> {
  // Loaded lazily so the install logic above stays runnable outside the editor, i.e. under test.
  const vscode = await import("vscode");
  if (!root) {
    void vscode.window.showWarningMessage(
      "Open a folder first: agent hooks are installed per workspace."
    );
    return false;
  }
  if (!hookSource(extensionPath)) {
    void vscode.window.showErrorMessage(
      `No hook scripts are bundled with this build (looked in ${path.join(extensionPath, "hooks")}). Nothing was installed.`
    );
    return false;
  }
  const written = installHooks(root, extensionPath);
  const { ready, missing } = checkHooks(root);
  void vscode.window.showInformationMessage(
    ready
      ? `Installed ${written.length} hook files. New chats answer as their persona.`
      : `Agent hooks are still incomplete: ${missing.join(", ")}`
  );
  return ready;
}

/** The unprompted offer: entering a board with no hooks asks once rather than writing files itself. */
export async function promptInstallHooks(
  root: string | undefined,
  extensionPath: string
): Promise<boolean> {
  if (!root || hooksInstalled(root)) return false;
  const vscode = await import("vscode");
  const choice = await vscode.window.showWarningMessage(
    "Agent hooks are missing or incomplete. Persona identity and live activity will not work.",
    "Install / Repair"
  );
  if (choice !== "Install / Repair") return false;
  return repairHooks(root, extensionPath);
}

/** Copies the hook scripts into the workspace and wires them up. Returns the files written. */
export function installHooks(root: string | undefined, extensionPath: string): string[] {
  const source = root && hookSource(extensionPath);
  if (!root || !source) return [];
  const target = path.join(root, ".cursor", "hooks");
  // Ignore first so git never sees copies. Skip when this workspace is the bundled source.
  const ignored =
    path.resolve(source) === path.resolve(target) ? [] : ensureHookGitignore(root);
  fs.mkdirSync(target, { recursive: true });
  const written = SCRIPTS.filter((name) => fs.existsSync(path.join(source, name))).map((name) => {
    fs.copyFileSync(path.join(source, name), path.join(target, name));
    fs.chmodSync(path.join(target, name), 0o755);
    return `.cursor/hooks/${name}`;
  });
  mergeConfig(root);
  return [...ignored, ...written, ".cursor/hooks.json"];
}

/**
 * Give the workspace back exactly as it was: our scripts and our wiring go, hooks the project
 * added itself stay. Runtime state lives outside the repo, so `removeRuntimeFiles` handles that.
 */
export function uninstallHooks(root: string | undefined): string[] {
  if (!root) return [];
  const dir = path.join(root, ".cursor", "hooks");
  const removed = [...SCRIPTS, ...RETIRED.map((command) => path.basename(command))]
    .filter((name) => fs.existsSync(path.join(dir, name)))
    .map((name) => {
      fs.rmSync(path.join(dir, name), { force: true });
      return `.cursor/hooks/${name}`;
    });
  try {
    if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
  } catch {
    /* a directory the project also uses stays */
  }
  return [...removed, ...pruneConfig(root), ...pruneHookGitignore(root)];
}

function ensureHookGitignore(root: string): string[] {
  const file = path.join(root, ".gitignore");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    /* no gitignore yet */
  }
  const have = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  if (IGNORE_PATTERNS.every((pattern) => have.has(pattern))) return [];
  const prefix = text && !text.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(file, text + prefix + [IGNORE_MARKER, ...IGNORE_PATTERNS].join("\n") + "\n");
  return [".gitignore"];
}

function pruneHookGitignore(root: string): string[] {
  const file = path.join(root, ".gitignore");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const drop = new Set([IGNORE_MARKER, ...IGNORE_PATTERNS]);
  const kept = text.split(/\r?\n/).filter((line) => !drop.has(line.trim()));
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  if (!kept.length) {
    fs.rmSync(file, { force: true });
    return [".gitignore"];
  }
  const next = `${kept.join("\n")}\n`;
  if (next === text) return [];
  fs.writeFileSync(file, next);
  return [".gitignore"];
}

/** Strip our commands from hooks.json; the file goes only when nothing else was wired there. */
function pruneConfig(root: string): string[] {
  const file = path.join(root, ".cursor", "hooks.json");
  let config: { version?: number; hooks?: Record<string, HookEntry[]> };
  try {
    config = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const ours = new Set([...Object.values(WIRING).flat(), ...RETIRED]);
  const hooks: Record<string, HookEntry[]> = {};
  for (const [event, entries] of Object.entries(config.hooks ?? {})) {
    const kept = (Array.isArray(entries) ? entries : []).filter(
      (entry) => !ours.has(entry?.command ?? "")
    );
    if (kept.length) hooks[event] = kept;
  }
  if (!Object.keys(hooks).length) {
    fs.rmSync(file, { force: true });
    return [".cursor/hooks.json"];
  }
  fs.writeFileSync(file, `${JSON.stringify({ version: config.version ?? 1, hooks }, null, 2)}\n`);
  return [".cursor/hooks.json"];
}
