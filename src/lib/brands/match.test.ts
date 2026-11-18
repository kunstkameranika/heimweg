import { describe, expect, it } from "vitest";

import type { FoundPosting, SearchQuery } from "@/lib/job-search/search";

import { matchingRoles, placeMatches, titleMatches, titlePhrases } from "./match";

const query = (change: Partial<SearchQuery> = {}): SearchQuery => ({ keywords: "", place: "Berlin", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any", ...change });
const role = (title: string, place: string, remote: boolean | null = null, postedAt: string | null = null): FoundPosting => ({
  source: "BRANDS", externalId: title, title, company: "Acme", place, remote, salary: "", postedAt, url: "", via: "Acme", description: "", complete: false,
});

describe("titles", () => {
  it("splits phrases on commas and OR, leaving out small words", () => {
    expect(titlePhrases("Head of BD, partnerships OR alliances")).toEqual([["head", "bd"], ["partnerships"], ["alliances"]]);
    expect(titlePhrases(" , ")).toEqual([]);
  });

  it("matches when every word of one phrase starts a word of the title", () => {
    const phrases = titlePhrases("partner, business development");
    expect(titleMatches("Strategic Partnerships Lead", phrases)).toBe(true);
    expect(titleMatches("Business Development Manager", phrases)).toBe(true);
    expect(titleMatches("Software Engineer, Development Tools", phrases)).toBe(false);
    expect(titleMatches("Anything", [])).toBe(true);
  });
});

describe("places", () => {
  it("takes roles in the city, and remote roles open to the country or Europe", () => {
    expect(placeMatches(role("", "Berlin, Germany"), query())).toBe(true);
    expect(placeMatches(role("", "Munich, Germany"), query())).toBe(false);
    expect(placeMatches(role("", "Munich, Germany · Remote", true), query())).toBe(true);
    expect(placeMatches(role("", "Remote - EMEA"), query())).toBe(true);
    expect(placeMatches(role("", "Remote"), query())).toBe(true);
    expect(placeMatches(role("", "Remote - US"), query())).toBe(false);
    expect(placeMatches(role("", "San Francisco, CA"), query())).toBe(false);
  });

  it("takes the whole country without a city, and anything without either", () => {
    expect(placeMatches(role("", "Hamburg, Deutschland"), query({ place: "" }))).toBe(true);
    expect(placeMatches(role("", "Tokyo"), query({ place: "", country: "" }))).toBe(true);
  });

  it("keeps to remote roles when asked", () => {
    expect(placeMatches(role("", "Berlin, Germany"), query({ remoteOnly: true }))).toBe(false);
    expect(placeMatches(role("", "Germany", true), query({ remoteOnly: true }))).toBe(true);
    expect(placeMatches(role("", "Remote, Europe"), query({ remoteOnly: true }))).toBe(true);
    expect(placeMatches(role("", "Remote - US"), query({ remoteOnly: true }))).toBe(false);
    expect(placeMatches(role("", "Remote", true), query({ remoteOnly: true, country: "", place: "" }))).toBe(true);
  });
});

describe("matchingRoles", () => {
  it("keeps the fitting roles, newest first", () => {
    const roles = [
      role("Partnerships Manager", "Berlin", null, "2026-10-01T00:00:00Z"),
      role("Head of Partnerships", "Berlin", null, "2026-11-01T00:00:00Z"),
      role("Engineer", "Berlin", null, "2026-11-02T00:00:00Z"),
      role("Partner Lead", "London"),
      role("Partner Marketing", "Berlin"),
    ];
    expect(matchingRoles(roles, query({ keywords: "partner" })).map((posting) => posting.title)).toEqual(["Head of Partnerships", "Partnerships Manager", "Partner Marketing"]);
  });
});
