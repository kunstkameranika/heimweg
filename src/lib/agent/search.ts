import { z } from "zod";

import { PostingSource } from "@/generated/prisma/enums";
import { EMPTY_QUERY, searchQuerySchema, type JobSource, type SearchQuery } from "@/lib/job-search/search";

/** Fixed product and source-budget cap, shared by forms and server writes. */
export { MAX_AGENT_SEARCHES, MAX_AGENT_SEARCHES_TEXT } from "./limits";

/** The sources a search may name; the agent never searches the Bundesagentur (#223). */
export const AGENT_SOURCES = [PostingSource.JSEARCH, PostingSource.ADZUNA, PostingSource.FREEHIRE] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

export const agentSearchInputSchema = z.object({
  name: z.string().trim().min(1, "Give the search a name.").max(100),
  /** Null: the source chosen in Settings → Job search. */
  source: z.enum(AGENT_SOURCES).nullable().default(null),
  query: searchQuerySchema.refine((query) => Boolean(query.keywords), "Add what to look for."),
  enabled: z.boolean().default(true),
  sort: z.number().int().min(0).default(0),
});
export type AgentSearchInput = z.input<typeof agentSearchInputSchema>;
export type SavedAgentSearch = { id: string; name: string; source: AgentSource | null; query: SearchQuery; enabled: boolean; sort: number; createdAt: Date; updatedAt: Date };

/** The source `search` runs on: its own, or the one chosen in Settings. */
export const sourceOf = (search: Pick<SavedAgentSearch, "source">, fallback: JobSource | null): JobSource | null => search.source ?? fallback;

/** Shared setup wording for the engine and the master enable action. */
export function agentSearchSetupProblem(searches: readonly SavedAgentSearch[]): string | null {
  if (!searches.length) return "Add what to look for in Settings → Job agent first.";
  const enabled = searches.filter((search) => search.enabled);
  if (!enabled.length) return "Enable an Agent search in Settings → Job agent first.";
  const empty = enabled.find((search) => !search.query.keywords.trim());
  if (empty) return `Add what to look for in “${empty.name}” in Settings → Job agent first.`;
  const missingCountry = enabled.find((search) => !search.query.country);
  if (missingCountry) return `Choose a country for “${missingCountry.name}” in Settings → Job agent first.`;
  return null;
}

/** Same recovery rules as the SQL upgrade: keep meaningful keywords, repair
 * optional fields and truncate the place rather than lose the whole search. */
export function legacyAgentQuery(value: string): SearchQuery | null {
  let raw: unknown;
  try { raw = JSON.parse(value); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const q = raw as Record<string, unknown>;
  const keywords = searchQuerySchema.shape.keywords.safeParse(q.keywords);
  if (!keywords.success || !keywords.data) return null;
  return {
    keywords: keywords.data,
    place: typeof q.place === "string" ? Array.from(q.place.trim()).slice(0, 200).join("").trim() : "",
    country: searchQuerySchema.shape.country.catch(EMPTY_QUERY.country).parse(q.country),
    radiusKm: searchQuerySchema.shape.radiusKm.catch(EMPTY_QUERY.radiusKm).parse(q.radiusKm),
    remoteOnly: searchQuerySchema.shape.remoteOnly.catch(EMPTY_QUERY.remoteOnly).parse(q.remoteOnly),
    postedWithin: searchQuerySchema.shape.postedWithin.catch(EMPTY_QUERY.postedWithin).parse(q.postedWithin),
  };
}
