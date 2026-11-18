import "server-only";

import { greenhouseRoleText, readFeed } from "@/lib/brands/feeds";
import { brandPostingRef } from "@/lib/brands/feeds";
import { matchingRoles } from "@/lib/brands/match";
import { listWatchedCompanies } from "@/lib/brands/companies";
import { logServerError } from "@/lib/log";

import type { JobSourceAdapter, RequestContext } from "./adapter";
import { cached, remember } from "./cache";
import { JobSearchError, jobSearchError } from "./errors";
import { POSTED_WITHIN, type FoundPosting, type SearchPage, type SearchQuery } from "./search";

// Brand watch as a job source: the open roles of the companies the user
// follows (Settings → Brand watch), read from their careers feeds and
// filtered like a job board would. One search reads every enabled company's
// feed (kept for half an hour) and answers in one page.

/** More than this many matches is a search worth narrowing. */
const MAX_RESULTS = 150;
/** Feeds read at once. */
const PARALLEL = 4;

type Company = Awaited<ReturnType<typeof listWatchedCompanies>>[number];

async function rolesOf(company: Company, signal?: AbortSignal): Promise<FoundPosting[]> {
  const key = `brands:${company.board}:${company.slug.toLowerCase()}`;
  const hit = cached<FoundPosting[]>(key);
  if (hit) return hit;
  const roles = await readFeed(company, signal);
  remember(key, roles);
  return roles;
}

const recentEnough = (query: SearchQuery, now: number) => {
  const days = POSTED_WITHIN.find((option) => option.value === query.postedWithin)?.days;
  return (posting: FoundPosting) => !days || !posting.postedAt || Date.parse(posting.postedAt) >= now - days * 24 * 60 * 60 * 1000;
};

async function searchPage(query: SearchQuery, _credentials: Record<string, never>, _next: string | null, context: RequestContext = {}): Promise<SearchPage> {
  const companies = (await listWatchedCompanies()).filter((company) => company.enabled);
  if (!companies.length) throw new JobSearchError("no-key", "Add the companies to watch in Settings → Brand watch first.");
  const roles: FoundPosting[] = [];
  let failures = 0;
  let lastError: unknown = null;
  for (let i = 0; i < companies.length; i += PARALLEL) {
    const batch = await Promise.allSettled(companies.slice(i, i + PARALLEL).map((company) => rolesOf(company, context.signal)));
    for (const [index, result] of batch.entries()) {
      if (result.status === "fulfilled") roles.push(...result.value);
      else {
        failures += 1;
        lastError = result.reason;
        logServerError(`brand watch: ${companies[i + index].name}`, result.reason);
      }
    }
  }
  // One company that doesn't answer doesn't stop the rest.
  if (failures === companies.length) throw lastError instanceof JobSearchError ? lastError : jobSearchError("unavailable", "BRANDS");
  const fresh = recentEnough(query, Date.now());
  return { postings: matchingRoles(roles.filter(fresh), query).slice(0, MAX_RESULTS), next: null };
}

export const brands: JobSourceAdapter<"BRANDS"> = {
  source: "BRANDS",
  search: searchPage,
  details: async (posting, _credentials, context) => {
    if (posting.description) return posting.description;
    const ref = brandPostingRef(posting.externalId);
    if (ref?.board !== "GREENHOUSE") return null;
    return greenhouseRoleText(ref.slug, ref.id, context?.signal);
  },
  // Nothing to check: there's no key.
  test: async () => {},
};
