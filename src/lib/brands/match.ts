import { countryName } from "@/lib/job-search/countries";
import type { FoundPosting, SearchQuery } from "@/lib/job-search/search";

// Which of a company's open roles a search wants (Brand watch). A careers
// feed lists every role in every office, so this does the filtering a job
// board would: by title, by place, and by remote work.

const SMALL_WORDS = new Set(["of", "and", "the", "for", "a", "an", "in", "&", "/", "-", "|", "to"]);

/** "Head of BD, partnerships OR alliances" → [["head", "bd"], ["partnerships"], ["alliances"]]. */
export function titlePhrases(keywords: string): string[][] {
  return keywords
    .split(/,|;|\bor\b|\|/i)
    .map((phrase) =>
      phrase
        .toLowerCase()
        .split(/[^\p{L}\p{N}+#]+/u)
        .filter((word) => word && !SMALL_WORDS.has(word)),
    )
    .filter((words) => words.length > 0);
}

/** Whether a title has every word of at least one phrase, as a word start ("partner" finds "Partnerships"). */
export function titleMatches(title: string, phrases: readonly (readonly string[])[]): boolean {
  if (!phrases.length) return true;
  const words = title.toLowerCase().split(/[^\p{L}\p{N}+#]+/u).filter(Boolean);
  return phrases.some((phrase) => phrase.every((wanted) => words.some((word) => word.startsWith(wanted))));
}

// Places a remote role can be open to that include most of Europe.
const WIDE_REGIONS = /\b(europe|european|emea|eu|worldwide|anywhere|global|international)\b/i;
const REMOTE = /\bremote\b|\bhome[- ]?office\b|\bwork from home\b/i;

/**
 * Whether a role's place suits the search: in the place or the country it
 * names, or remote and open to that country (a remote role that names no
 * place, or a region that takes it in, such as "Remote, EMEA").
 */
export function placeMatches(posting: Pick<FoundPosting, "place" | "remote">, query: Pick<SearchQuery, "place" | "country" | "remoteOnly">): boolean {
  const place = posting.place.toLowerCase();
  const remote = posting.remote === true || REMOTE.test(posting.place);
  const country = query.country ? countryName(query.country).toLowerCase() : "";
  const city = query.place.trim().toLowerCase();
  const inCity = city !== "" && place.includes(city);
  const inCountry = country !== "" && (place.includes(country) || (query.country === "de" && /\bdeutschland\b/.test(place)));
  if (query.remoteOnly) return remote && (inCountry || inCity || WIDE_REGIONS.test(place) || remoteWithoutPlace(place) || !country);
  if (inCity || (inCountry && !city)) return true;
  if (!country && !city) return true;
  return remote && (inCountry || WIDE_REGIONS.test(place) || remoteWithoutPlace(place));
}

/** "Remote" or "" with nothing else said. */
function remoteWithoutPlace(place: string): boolean {
  return place.replace(REMOTE, "").replace(/[^\p{L}]+/gu, "") === "";
}

/** The roles `query` wants, newest first. */
export function matchingRoles(postings: readonly FoundPosting[], query: SearchQuery): FoundPosting[] {
  const phrases = titlePhrases(query.keywords);
  return postings
    .filter((posting) => titleMatches(posting.title, phrases) && placeMatches(posting, query))
    .toSorted((a, b) => (b.postedAt ? Date.parse(b.postedAt) : 0) - (a.postedAt ? Date.parse(a.postedAt) : 0));
}
