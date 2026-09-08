/** Cursor's own global config: user-level rules under ~/.cursor, mirrored read/write by the board. */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { frontmatter, markdownFiles, metaValue, slugify } from "./md";

export type GlobalRule = { id: string; label: string; path: string; detail: string };

/** Cursor keeps User Rules in Customize; these commands are its own source of truth. */
export const CURSOR_RULES_COMMANDS = [
  "workbench.action.customize.openRules",
  "workbench.action.openCustomizeEditor",
];

export function cursorHome(): string {
  return path.join(os.homedir(), ".cursor");
}

function rule(home: string, file: string): GlobalRule {
  const rel = path.relative(home, file).split(path.sep).join("/");
  const description = metaValue(frontmatter(fs.readFileSync(file, "utf8")), "description");
  return {
    id: `global:${rel}`,
    label: path.basename(file),
    path: `~/.cursor/${rel}`,
    detail: description ?? "Applies to every workspace",
  };
}

export function globalRules(home = cursorHome()): GlobalRule[] {
  const agents = path.join(home, "AGENTS.md");
  return [
    ...(fs.existsSync(agents) ? [rule(home, agents)] : []),
    ...markdownFiles(path.join(home, "rules")).map((file) => rule(home, file)),
  ];
}

/** Global ids may only name `AGENTS.md` or a markdown file inside ~/.cursor/rules. */
export function globalRuleFile(itemId: string, home = cursorHome()): string | null {
  if (!itemId.startsWith("global:")) return null;
  const rel = itemId.slice("global:".length).replaceAll("\\", "/");
  if (!rel || path.posix.isAbsolute(rel) || rel.split("/").includes("..")) return null;
  if (rel !== "AGENTS.md" && !rel.startsWith("rules/")) return null;
  const absPath = path.resolve(home, rel);
  if (!absPath.startsWith(`${path.resolve(home)}${path.sep}`)) return null;
  if (![".md", ".mdc"].includes(path.extname(absPath))) return null;
  try {
    const realHome = fs.realpathSync(home);
    const realFile = fs.realpathSync(absPath);
    return realFile.startsWith(`${realHome}${path.sep}`) ? realFile : null;
  } catch {
    return null;
  }
}

/** Writes a new always-on rule into Cursor's global rules folder and returns its absolute path. */
export function createGlobalRule(
  name: string,
  description: string,
  home = cursorHome()
): string | null {
  const slug = slugify(name);
  if (!slug) return null;
  const absPath = path.join(home, "rules", `${slug}.mdc`);
  if (fs.existsSync(absPath)) return absPath;
  const summary = description.trim() || name.trim();
  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(
      absPath,
      `---\ndescription: ${summary}\nalwaysApply: true\n---\n\n${summary}\n`
    );
    return absPath;
  } catch {
    return null;
  }
}
