export type Role = string;

/** Only ids the generic capitalisation below gets wrong. */
const SPECIAL_LABELS: Record<string, string> = {
  "ux-a11y": "UX/A11y",
  qa: "QA",
  devops: "DevOps",
};

/** A role id is a kebab-case slug so custom personas from disk are valid. */
export function isRole(value: string | undefined): value is Role {
  return !!value && /^[a-z][a-z0-9-]*$/.test(value);
}

export function mapRole(sub: string | undefined, roleMap: Record<string, string>): Role | null {
  if (!sub) return null;
  const mapped = roleMap[sub] ?? sub;
  return isRole(mapped) ? mapped : null;
}

export function roleLabel(role: Role, title?: string): string {
  if (title) return title.split("—")[0]?.trim() || title;
  if (SPECIAL_LABELS[role]) return SPECIAL_LABELS[role];
  return role
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
