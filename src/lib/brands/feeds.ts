import "server-only";

import { parse } from "node-html-parser";
import { z } from "zod";

import type { CareersBoard } from "@/generated/prisma/enums";
import { requestJson } from "@/lib/job-search/http";
import { safeLink, type FoundPosting } from "@/lib/job-search/search";
import { plainText } from "@/lib/job-search/text";

import { boardFeedUrl } from "./boards";

// Reading a company's public careers feed (Brand watch): Greenhouse, Lever
// and Ashby each publish every open role as JSON, without a key. Each role
// becomes a posting from the BRANDS source; its id names the board too.

/** Big employers list hundreds of roles, with their whole text. */
export const FEED_MAX_BYTES = 40 * 1024 * 1024;
const FEED_TIMEOUT_MS = 30_000;

const text = z.string().nullish().catch(null);
const number = z.number().nullish().catch(null);

const greenhouseSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.union([z.number(), z.string()]),
      title: text,
      absolute_url: text,
      company_name: text,
      location: z.object({ name: text }).nullish().catch(null),
      first_published: text,
      updated_at: text,
      metadata: z.array(z.object({ name: text, value: z.unknown() })).nullish().catch(null),
    }),
  ),
});

const leverSchema = z.array(
  z.object({
    id: z.string(),
    text: text,
    hostedUrl: text,
    createdAt: number,
    workplaceType: text,
    categories: z.object({ location: text, allLocations: z.array(z.string()).nullish().catch(null) }).nullish().catch(null),
    descriptionPlain: text,
    lists: z.array(z.object({ text: text, content: text })).nullish().catch(null),
    additionalPlain: text,
    salaryRange: z.object({ min: number, max: number, currency: text, interval: text }).nullish().catch(null),
  }),
);

const ashbySchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      title: text,
      location: text,
      secondaryLocations: z.array(z.object({ location: text })).nullish().catch(null),
      isRemote: z.boolean().nullish().catch(null),
      workplaceType: text,
      isListed: z.boolean().nullish().catch(null),
      publishedAt: text,
      jobUrl: text,
      descriptionPlain: text,
      compensation: z.object({ compensationTierSummary: text, scrapeableCompensationSalarySummary: text }).nullish().catch(null),
    }),
  ),
});

const isoOrNull = (value: string | number | null | undefined): string | null => {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
};

const clip = (value: string | null | undefined, max: number) => (value ?? "").trim().slice(0, max);

/** "greenhouse:anthropic:123": unique across boards and companies. */
export const brandPostingId = (board: CareersBoard, slug: string, id: string | number) => `${board.toLowerCase()}:${slug.toLowerCase()}:${id}`.slice(0, 500);

/** The board, company and role a Brand watch posting came from. */
export function brandPostingRef(externalId: string): { board: CareersBoard; slug: string; id: string } | null {
  const [board, slug, ...rest] = externalId.split(":");
  const known: CareersBoard[] = ["GREENHOUSE", "LEVER", "LEVER_EU", "ASHBY"];
  const upper = board?.toUpperCase() as CareersBoard;
  if (!known.includes(upper) || !slug || !rest.length) return null;
  return { board: upper, slug, id: rest.join(":") };
}

type Company = { name: string; board: CareersBoard; slug: string };

const posting = (company: Company, fields: Omit<FoundPosting, "source" | "company" | "via"> & { company?: string }): FoundPosting => ({
  ...fields,
  source: "BRANDS",
  company: clip(fields.company || company.name, 300),
  via: company.name.slice(0, 100),
});

function salaryOf(range: { min?: number | null; max?: number | null; currency?: string | null; interval?: string | null } | null | undefined): string {
  if (!range || (range.min == null && range.max == null)) return "";
  const amount = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const span = range.min != null && range.max != null && range.min !== range.max ? `${amount(range.min)}–${amount(range.max)}` : amount((range.min ?? range.max)!);
  // Lever writes "per-year-salary", "per-hour-wage".
  const per = /\b(year|month|week|day|hour)\b/.exec(range.interval ?? "")?.[1];
  return [range.currency, span, per ? `${per === "hour" ? "an" : "a"} ${per}` : ""].filter(Boolean).join(" ");
}

/** Every role a feed lists, as postings. Unknown shapes come back empty, not as an error. */
export function postingsFromFeed(company: Company, answer: unknown): FoundPosting[] {
  switch (company.board) {
    case "GREENHOUSE": {
      const feed = greenhouseSchema.safeParse(answer);
      if (!feed.success) return [];
      return feed.data.jobs.map((job) => {
        const type = job.metadata?.find((entry) => /location type|workplace|remote/i.test(entry.name ?? ""))?.value;
        const place = clip(job.location?.name, 300);
        return posting(company, {
          externalId: brandPostingId(company.board, company.slug, job.id),
          title: clip(job.title, 500),
          company: job.company_name ?? "",
          place,
          remote: typeof type === "string" ? /remote/i.test(type) : /\bremote\b/i.test(place) ? true : null,
          salary: "",
          postedAt: isoOrNull(job.first_published ?? job.updated_at),
          url: safeLink(job.absolute_url).slice(0, 2000),
          // The list has no text; details() fetches it.
          description: "",
          complete: false,
        });
      });
    }
    case "LEVER":
    case "LEVER_EU": {
      const feed = leverSchema.safeParse(answer);
      if (!feed.success) return [];
      return feed.data.map((job) => {
        const places = [job.categories?.location, ...(job.categories?.allLocations ?? [])].filter(Boolean) as string[];
        const description = [job.descriptionPlain, ...(job.lists ?? []).map((list) => [list.text, plainText(list.content)].filter(Boolean).join("\n")), job.additionalPlain]
          .filter(Boolean)
          .join("\n\n")
          .trim()
          .slice(0, 100_000);
        return posting(company, {
          externalId: brandPostingId(company.board, company.slug, job.id),
          title: clip(job.text, 500),
          place: clip([...new Set(places)].join(" · "), 300),
          remote: job.workplaceType ? job.workplaceType.toLowerCase() === "remote" : null,
          salary: salaryOf(job.salaryRange).slice(0, 200),
          postedAt: isoOrNull(job.createdAt),
          url: safeLink(job.hostedUrl).slice(0, 2000),
          description,
          complete: description.length > 0,
        });
      });
    }
    case "ASHBY": {
      const feed = ashbySchema.safeParse(answer);
      if (!feed.success) return [];
      return feed.data.jobs
        .filter((job) => job.isListed !== false)
        .map((job) => {
          const places = [job.location, ...(job.secondaryLocations ?? []).map((entry) => entry.location)].filter(Boolean) as string[];
          const description = clip(job.descriptionPlain, 100_000);
          return posting(company, {
            externalId: brandPostingId(company.board, company.slug, job.id),
            title: clip(job.title, 500),
            place: clip([...new Set(places)].join(" · "), 300),
            remote: job.isRemote ?? (job.workplaceType ? job.workplaceType.toLowerCase() === "remote" : null),
            salary: clip(job.compensation?.scrapeableCompensationSalarySummary ?? job.compensation?.compensationTierSummary, 200),
            postedAt: isoOrNull(job.publishedAt),
            url: safeLink(job.jobUrl).slice(0, 2000),
            description,
            complete: description.length > 0,
          });
        });
    }
  }
}

/** A company's feed, as postings; a JobSearchError when it can't be read. */
export async function readFeed(company: Company, signal?: AbortSignal): Promise<FoundPosting[]> {
  const answer = await requestJson("BRANDS", boardFeedUrl(company.board, company.slug), { signal, timeoutMs: FEED_TIMEOUT_MS, maxBytes: FEED_MAX_BYTES });
  return postingsFromFeed(company, answer);
}

const greenhouseJobSchema = z.object({ content: text });

/** A Greenhouse role's whole text, which its list leaves out. */
export async function greenhouseRoleText(slug: string, id: string, signal?: AbortSignal): Promise<string | null> {
  const url = new URL(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(id)}`);
  const job = greenhouseJobSchema.safeParse(await requestJson("BRANDS", url, { signal }));
  if (!job.success || !job.data.content) return null;
  // Its content is HTML with the tags escaped: unescape once, then drop the tags.
  return roleText(parse(job.data.content).text) || null;
}

/** A role's HTML as text with paragraph breaks. */
function roleText(escaped: string): string {
  return escaped
    .replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim()
    .slice(0, 100_000);
}
