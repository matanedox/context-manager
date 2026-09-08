/**
 * The budget field takes either unit. The reading it caps is tokens spent across the whole chat,
 * which runs to millions on a long one, but a short chat is still worth capping in thousands.
 */

const FIELD = /^(\d+(?:\.\d+)?)\s*([kKmM])?$/;

/** `80k`, `2.5M`, or a bare number meaning millions. `null` when the text is not a budget. */
export function parseTokenBudget(value: string): number | null {
  const match = FIELD.exec(value.trim());
  if (!match) return null;
  const scale = match[2]?.toLowerCase() === "k" ? 1_000 : 1_000_000;
  const tokens = Math.floor(Number.parseFloat(match[1]) * scale);
  return Number.isFinite(tokens) && tokens > 0 ? tokens : null;
}

/** What the field shows for a stored budget; round-trips back through `parseTokenBudget`. */
export function tokenBudgetField(tokens: number): string {
  const millions = tokens / 1_000_000;
  if (millions >= 1) return `${Number(millions.toFixed(2))}M`;
  return `${Number((tokens / 1_000).toFixed(2))}k`;
}
