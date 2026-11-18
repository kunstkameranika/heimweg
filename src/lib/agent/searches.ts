import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ActionError } from "@/lib/action";
import { searchQuerySchema } from "@/lib/job-search/search";
import { lockForTransaction } from "@/lib/db-lock";
import { prisma } from "@/lib/prisma";

import { AGENT_SOURCES, agentSearchInputSchema, MAX_AGENT_SEARCHES, MAX_AGENT_SEARCHES_TEXT, type AgentSearchInput, type AgentSource, type SavedAgentSearch } from "./search";

type AgentSearchRow = Prisma.AgentSearchGetPayload<object>;

/** A stored row as the app uses it; a source the agent can't use reads as the default. */
const saved = (row: AgentSearchRow): SavedAgentSearch => ({
  ...row,
  source: (AGENT_SOURCES as readonly string[]).includes(row.source ?? "") ? row.source as AgentSource : null,
  query: searchQuerySchema.parse(row.query),
});

/** Serialize all search writes, including imports, without introducing a lock table. */
export async function lockAgentSearches(tx: Prisma.TransactionClient): Promise<void> {
  await lockForTransaction(tx, 621746001);
}

export async function listAgentSearches(db: PrismaClient = prisma): Promise<SavedAgentSearch[]> {
  const rows = await db.agentSearch.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  return rows.map(saved);
}

/** Create, or update by stable id. Disabled searches count toward the cap too. */
export async function saveAgentSearch(input: AgentSearchInput, id?: string, db: PrismaClient = prisma): Promise<SavedAgentSearch> {
  const data = agentSearchInputSchema.parse(input);
  return db.$transaction(async (tx) => {
    await lockAgentSearches(tx);
    if (id && !await tx.agentSearch.findUnique({ where: { id }, select: { id: true } })) throw new ActionError("That Agent search no longer exists.");
    if (!id && await tx.agentSearch.count() >= MAX_AGENT_SEARCHES) throw new ActionError(MAX_AGENT_SEARCHES_TEXT);
    const row = id
      ? await tx.agentSearch.update({ where: { id }, data })
      : await tx.agentSearch.create({ data });
    return saved(row);
  });
}

/** A stale toggle must never replace another tab's name, query or order. */
export async function setAgentSearchEnabled(id: string, enabled: boolean, db: PrismaClient = prisma): Promise<SavedAgentSearch> {
  return db.$transaction(async (tx) => {
    await lockAgentSearches(tx);
    const current = await tx.agentSearch.findUnique({ where: { id } });
    if (!current) throw new ActionError("That Agent search no longer exists.");
    const query = searchQuerySchema.parse(current.query);
    if (enabled && !query.country) throw new ActionError(`Choose a country for “${current.name}”.`);
    return saved(await tx.agentSearch.update({ where: { id }, data: { enabled } }));
  });
}

/** The FK unlinks attribution but keeps its historical name. Candidates remain. */
export async function deleteAgentSearch(id: string, db: PrismaClient = prisma): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockAgentSearches(tx);
    await tx.agentSearch.deleteMany({ where: { id } });
  });
}

/** Move against the current order under the same lock as create/delete/import. */
export async function moveAgentSearch(id: string, direction: "up" | "down", db: PrismaClient = prisma): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockAgentSearches(tx);
    const rows = await tx.agentSearch.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) throw new ActionError("That Agent search no longer exists.");
    const target = index + (direction === "up" ? -1 : 1);
    if (target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    for (const [sort, row] of rows.entries()) await tx.agentSearch.update({ where: { id: row.id }, data: { sort } });
  });
}
