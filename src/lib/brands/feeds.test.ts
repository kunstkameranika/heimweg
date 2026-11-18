import { describe, expect, it } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";

import { brandPostingId, brandPostingRef, greenhouseRoleText, postingsFromFeed, readFeed } from "./feeds";

const greenhouse = {
  jobs: [
    {
      id: 5456619008,
      title: "Partnerships Lead ",
      absolute_url: "https://job-boards.greenhouse.io/anthropic/jobs/5456619008",
      company_name: "Anthropic",
      location: { name: "Remote-Friendly (Travel Required) | Berlin" },
      first_published: "2026-10-19T11:17:24-04:00",
      metadata: [{ name: "Location Type", value: "Remote" }],
    },
    { id: "7", title: "Engineer", absolute_url: "javascript:alert(1)", location: null, updated_at: "2026-10-01T00:00:00Z", metadata: null },
  ],
};
const lever = [
  {
    id: "2a55",
    text: "Artist Partnerships Manager",
    hostedUrl: "https://jobs.lever.co/spotify/2a55",
    createdAt: 1792767640768,
    workplaceType: "hybrid",
    categories: { location: "Berlin", allLocations: ["Berlin", "Hamburg"] },
    descriptionPlain: "You will build partnerships.",
    lists: [{ text: "What you'll do", content: "<li>Sign artists</li>" }],
    additionalPlain: "Benefits.",
    salaryRange: { min: 60000, max: 80000, currency: "EUR", interval: "per-year-salary" },
  },
];
const ashby = {
  jobs: [
    { id: "a1", title: "Account Director", location: "Berlin, Germany", secondaryLocations: [{ location: "Remote" }], isRemote: true, publishedAt: "2026-06-22T00:00:00Z", jobUrl: "https://jobs.ashbyhq.com/openai/a1", descriptionPlain: "Own accounts.", compensation: { compensationTierSummary: "€120K – €160K", scrapeableCompensationSalarySummary: null } },
    { id: "a2", title: "Hidden", location: "Berlin", isListed: false },
  ],
};

describe("postingsFromFeed", () => {
  it("reads a Greenhouse list, whose text comes later", () => {
    const [role, other] = postingsFromFeed({ name: "Anthropic", board: "GREENHOUSE", slug: "anthropic" }, greenhouse);
    expect(role).toEqual({
      source: "BRANDS",
      externalId: "greenhouse:anthropic:5456619008",
      title: "Partnerships Lead",
      company: "Anthropic",
      place: "Remote-Friendly (Travel Required) | Berlin",
      remote: true,
      salary: "",
      postedAt: "2026-10-19T15:17:24.000Z",
      url: "https://job-boards.greenhouse.io/anthropic/jobs/5456619008",
      via: "Anthropic",
      description: "",
      complete: false,
    });
    expect(other).toMatchObject({ company: "Anthropic", place: "", remote: null, url: "", postedAt: "2026-10-01T00:00:00.000Z" });
  });

  it("reads a Lever list with its whole text and pay", () => {
    const [role] = postingsFromFeed({ name: "Spotify", board: "LEVER", slug: "spotify" }, lever);
    expect(role).toMatchObject({
      externalId: "lever:spotify:2a55",
      company: "Spotify",
      place: "Berlin · Hamburg",
      remote: false,
      salary: "EUR 60,000–80,000 a year",
      complete: true,
    });
    expect(role.description).toBe("You will build partnerships.\n\nWhat you'll do\nSign artists\n\nBenefits.");
  });

  it("reads an Ashby list, leaving out unlisted roles", () => {
    const roles = postingsFromFeed({ name: "OpenAI", board: "ASHBY", slug: "openai" }, ashby);
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({ externalId: "ashby:openai:a1", place: "Berlin, Germany · Remote", remote: true, salary: "€120K – €160K", description: "Own accounts.", complete: true });
  });

  it("answers an unknown shape with nothing", () => {
    expect(postingsFromFeed({ name: "X", board: "GREENHOUSE", slug: "x" }, { nope: true })).toEqual([]);
    expect(postingsFromFeed({ name: "X", board: "LEVER_EU", slug: "x" }, {})).toEqual([]);
    expect(postingsFromFeed({ name: "X", board: "ASHBY", slug: "x" }, [])).toEqual([]);
  });
});

describe("posting ids", () => {
  it("name the board, company and role, and read back", () => {
    expect(brandPostingId("LEVER_EU", "Acme", "1:2")).toBe("lever_eu:acme:1:2");
    expect(brandPostingRef("lever_eu:acme:1:2")).toEqual({ board: "LEVER_EU", slug: "acme", id: "1:2" });
    expect(brandPostingRef("nope:acme:1")).toBeNull();
    expect(brandPostingRef("ashby:acme")).toBeNull();
  });
});

describe("reading feeds", () => {
  it("asks the company's feed", async () => {
    const requests = stubFetch(() => json(ashby));
    expect(await readFeed({ name: "OpenAI", board: "ASHBY", slug: "openai" })).toHaveLength(1);
    expect(requests[0].url.host).toBe("api.ashbyhq.com");
  });

  it("fetches a Greenhouse role's text and keeps its paragraphs", async () => {
    stubFetch(() => json({ content: "&lt;p&gt;About us&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Build &amp;amp; ship&lt;/li&gt;&lt;/ul&gt;" }));
    expect(await greenhouseRoleText("anthropic", "1")).toBe("About us\n• Build & ship");
    stubFetch(() => json({ content: null }));
    expect(await greenhouseRoleText("anthropic", "1")).toBeNull();
  });
});
