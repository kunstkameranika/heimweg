import "server-only";

import { z } from "zod";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { lockForTransaction } from "@/lib/db-lock";
import { formatDateTime } from "@/lib/dates";
import { prisma } from "@/lib/prisma";

import { SOURCE_MONTHLY_LIMITS, USAGE_WINDOW_MS, usedInWindow, type MeteredSource } from "./usage-limits";
import type { JobSource } from "./search";

// Requests to sources with a monthly quota (JSearch's free plan has 250),
// from Find jobs and the job agent alike. Kept as one Setting row of
// timestamps, pruned to the rolling window.

const KEY = "sourceUsage";
const USAGE_LOCK = 621746004;

const usageSchema = z.array(z.object({ source: z.string(), at: z.iso.datetime() }));
type Usage = z.infer<typeof usageSchema>;

const metered = (source: JobSource): source is MeteredSource => source in SOURCE_MONTHLY_LIMITS;

async function readUsage(db: PrismaClient | Prisma.TransactionClient): Promise<Usage> {
  const row = await db.setting.findUnique({ where: { key: KEY } });
  if (!row) return [];
  try {
    return usageSchema.parse(JSON.parse(row.value));
  } catch {
    return [];
  }
}

/** Requests to `source` in the rolling window, oldest first. */
export async function sourceUsage(source: JobSource, now = new Date(), db: PrismaClient = prisma): Promise<string[]> {
  return usedInWindow(await readUsage(db), source, now);
}

/** Counts one request to `source`, before it's sent. Unmetered sources aren't kept. */
export async function recordSourceUse(source: JobSource, now = new Date(), db: PrismaClient = prisma): Promise<void> {
  if (!metered(source)) return;
  await db.$transaction(async (tx) => {
    await lockForTransaction(tx, USAGE_LOCK);
    const kept = (await readUsage(tx)).filter((entry) => Date.parse(entry.at) + USAGE_WINDOW_MS > now.getTime());
    const value = JSON.stringify([...kept, { source, at: now.toISOString() }]);
    await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  });
}

/** Why the job agent may not ask `source` now, or null. Find jobs isn't held
 * back: it's the reserve. `planned`: requests this run sends to `source` first. */
export async function agentBudgetProblem(source: JobSource, now = new Date(), timeZone = "UTC", planned = 0, db: PrismaClient = prisma): Promise<string | null> {
  if (!metered(source)) return null;
  const { agent } = SOURCE_MONTHLY_LIMITS[source];
  const used = await sourceUsage(source, now, db);
  if (used.length + planned < agent) return null;
  // The request that has to expire before one more fits.
  const free = new Date(Date.parse(used[Math.min(used.length - 1, used.length + planned - agent)] ?? now.toISOString()) + USAGE_WINDOW_MS);
  return `The agent has used its ${agent} JSearch searches for the last 30 days; the next one frees up ${formatDateTime(free, timeZone, now)}.`;
}
