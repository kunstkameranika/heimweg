import type { CareersBoard } from "@/generated/prisma/enums";

// Brand watch: the hiring systems whose public job feeds it reads, and how
// a careers link names a company on one. Browser-safe.

export const BOARD_NAMES: Record<CareersBoard, string> = {
  GREENHOUSE: "Greenhouse",
  LEVER: "Lever",
  LEVER_EU: "Lever (EU)",
  ASHBY: "Ashby",
};

/** Where a company's open roles are listed for people, for the Settings list. */
export function boardPageUrl(board: CareersBoard, slug: string): string {
  const name = encodeURIComponent(slug);
  switch (board) {
    case "GREENHOUSE":
      return `https://job-boards.greenhouse.io/${name}`;
    case "LEVER":
      return `https://jobs.lever.co/${name}`;
    case "LEVER_EU":
      return `https://jobs.eu.lever.co/${name}`;
    case "ASHBY":
      return `https://jobs.ashbyhq.com/${name}`;
  }
}

/** The feed Brand watch reads for a company. */
export function boardFeedUrl(board: CareersBoard, slug: string): URL {
  const name = encodeURIComponent(slug);
  switch (board) {
    case "GREENHOUSE":
      return new URL(`https://boards-api.greenhouse.io/v1/boards/${name}/jobs`);
    case "LEVER":
      return new URL(`https://api.lever.co/v0/postings/${name}?mode=json`);
    case "LEVER_EU":
      return new URL(`https://api.eu.lever.co/v0/postings/${name}?mode=json`);
    case "ASHBY":
      return new URL(`https://api.ashbyhq.com/posting-api/job-board/${name}?includeCompensation=true`);
  }
}

export type BoardRef = { board: CareersBoard; slug: string };

const SLUG = "([A-Za-z0-9][A-Za-z0-9._-]{0,99})";

// Links to a board, as careers pages and people write them.
const PATTERNS: { board: CareersBoard; pattern: RegExp }[] = [
  { board: "GREENHOUSE", pattern: new RegExp(`(?:job-)?boards(?:\\.eu)?\\.greenhouse\\.io/(?:embed/job_board(?:/js)?\\?for=)?${SLUG}`, "i") },
  { board: "GREENHOUSE", pattern: new RegExp(`boards-api\\.greenhouse\\.io/v1/boards/${SLUG}`, "i") },
  { board: "LEVER_EU", pattern: new RegExp(`(?:jobs|api)\\.eu\\.lever\\.co/(?:v0/postings/)?${SLUG}`, "i") },
  { board: "LEVER", pattern: new RegExp(`(?:jobs|api)\\.lever\\.co/(?:v0/postings/)?${SLUG}`, "i") },
  { board: "ASHBY", pattern: new RegExp(`jobs\\.ashbyhq\\.com/${SLUG}`, "i") },
  { board: "ASHBY", pattern: new RegExp(`api\\.ashbyhq\\.com/posting-api/job-board/${SLUG}`, "i") },
];

// Path parts that are a board's own pages, not a company.
const NOT_A_COMPANY = new Set(["embed", "v1", "v0", "api", "jobs", "job_board"]);

/** Every board link in `text` (a link, or a careers page's HTML), first ones first, without repeats. */
export function boardRefsIn(text: string): BoardRef[] {
  const found: { at: number; ref: BoardRef }[] = [];
  for (const { board, pattern } of PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, "gi"))) {
      const slug = match[1].replace(/[._-]+$/, "");
      if (!slug || NOT_A_COMPANY.has(slug.toLowerCase())) continue;
      found.push({ at: match.index, ref: { board, slug } });
    }
  }
  const seen = new Set<string>();
  return found
    .toSorted((a, b) => a.at - b.at)
    .map(({ ref }) => ref)
    .filter((ref) => {
      const key = `${ref.board}:${ref.slug.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Names a company may have on a board: "Black Forest Labs" → black-forest-labs, blackforestlabs, … */
export function slugGuesses(name: string): string[] {
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/https?:\/\/|www\.|\.(com|io|ai|de|co|org|net)\b.*$/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return [];
  const withoutSuffix = words.filter((word, index) => index === 0 || !["inc", "gmbh", "ltd", "ai", "labs", "hq"].includes(word));
  return [...new Set([words.join(""), words.join("-"), withoutSuffix.join(""), withoutSuffix.join("-"), `${words.join("")}ai`, words[0]])].filter((slug) => slug.length >= 2);
}
