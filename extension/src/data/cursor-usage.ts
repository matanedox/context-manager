/**
 * The two cards on cursor.com/dashboard/usage, read from the endpoints that feed them:
 * Included-Request Usage from `/api/usage`, On-Demand Usage from `/api/usage-summary`.
 * Both are shown as the dashboard shows them. Session handling lives in `cursor-session.ts`.
 */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export type UsageReading = {
  usedRequests?: number;
  totalRequests?: number;
  onDemandEnabled: boolean;
  onDemandDollars?: number;
  onDemandCapDollars?: number;
  resetsOn?: string;
};

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Amounts on the summary endpoint are cents: an on-demand limit of 7500 is the $75 cap in the UI. */
function dollars(cents: unknown): number | undefined {
  const value = num(cents);
  return value === undefined ? undefined : value / 100;
}

/** The Included-Request Usage card: requests spent this cycle, out of the plan's allowance. */
export function parseRequests(body: unknown): { used?: number; total?: number } {
  if (!body || typeof body !== "object") return {};
  const row = (body as { "gpt-4"?: { numRequests?: unknown; maxRequestUsage?: unknown } })["gpt-4"];
  return { used: num(row?.numRequests), total: num(row?.maxRequestUsage) };
}

export function parseUsageSummary(body: unknown, usageBody?: unknown): UsageReading | null {
  if (!body || typeof body !== "object") return null;
  const record = body as {
    individualUsage?: { onDemand?: { enabled?: unknown; used?: unknown; limit?: unknown } };
    billingCycleEnd?: unknown;
  };
  const onDemand = record.individualUsage?.onDemand;
  const requests = parseRequests(usageBody);
  const onDemandDollars = dollars(onDemand?.used);
  if (requests.used === undefined && onDemandDollars === undefined) return null;
  const end =
    typeof record.billingCycleEnd === "string" ? new Date(record.billingCycleEnd) : undefined;
  return {
    usedRequests: requests.used,
    totalRequests: requests.total,
    onDemandEnabled: onDemand?.enabled !== false,
    onDemandDollars,
    onDemandCapDollars: dollars(onDemand?.limit),
    resetsOn: end && !Number.isNaN(end.getTime()) ? resetDay(end) : undefined,
  };
}

/** "Oct 1, 2026", the way the card prints it. */
function resetDay(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function money(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

export type UsageDisplay = {
  /** Both cards as one string, for the control's accessible name. */
  label: string;
  included?: string;
  onDemand?: string;
  /** The included requests are spent, so on-demand is the number that matters now. */
  exhausted: boolean;
  details: string[];
};

/** The strip's own reading, split so the screen can lead with whichever card is spending. */
export function formatUsage(reading: UsageReading): UsageDisplay {
  const included =
    reading.usedRequests === undefined
      ? undefined
      : reading.totalRequests === undefined
        ? `${reading.usedRequests}`
        : `${reading.usedRequests} / ${reading.totalRequests}`;
  const onDemand =
    reading.onDemandDollars === undefined || !reading.onDemandEnabled
      ? undefined
      : reading.onDemandCapDollars === undefined
        ? money(reading.onDemandDollars)
        : `${money(reading.onDemandDollars)} / ${money(reading.onDemandCapDollars)}`;
  const exhausted =
    reading.usedRequests !== undefined &&
    reading.totalRequests !== undefined &&
    reading.usedRequests >= reading.totalRequests;
  const details = [
    included ? `Included-Request Usage: ${included}, included in your plan.` : undefined,
    onDemand
      ? `On-Demand Usage: ${onDemand}, for usage beyond your plan limits.`
      : reading.onDemandDollars === undefined
        ? undefined
        : "On-Demand Usage is off: nothing bills past the plan.",
    reading.resetsOn ? `Resets ${reading.resetsOn}.` : undefined,
    "Account-wide, every Cursor chat. The meter on an agent card is that chat's tokens, a different number.",
  ].filter((line): line is string => Boolean(line));
  const ordered = exhausted ? [onDemand, included] : [included, onDemand];
  return {
    label: ordered.filter(Boolean).join(" · ") || "No reading",
    included,
    onDemand,
    exhausted,
    details,
  };
}
