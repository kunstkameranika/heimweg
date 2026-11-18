/** Browser-safe quota numbers. JSearch's free plan allows 250 requests a
 * month; the agent may use up to `agent` of them in any 30 days, leaving the
 * rest for searching by hand. */
export const SOURCE_MONTHLY_LIMITS = {
  JSEARCH: { plan: 250, agent: 220 },
} as const;
export type MeteredSource = keyof typeof SOURCE_MONTHLY_LIMITS;

export const USAGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** The timestamps of `source`'s requests inside the window ending at `now`, oldest first. */
export function usedInWindow(usage: readonly { source: string; at: string }[], source: string, now: Date): string[] {
  return usage
    .filter((entry) => entry.source === source && Date.parse(entry.at) + USAGE_WINDOW_MS > now.getTime() && Date.parse(entry.at) <= now.getTime())
    .map((entry) => entry.at)
    .toSorted();
}
