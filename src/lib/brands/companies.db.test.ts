import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";
import { clearJobSearchCache } from "@/lib/job-search/cache";
import { EMPTY_QUERY } from "@/lib/job-search/search";
import { createTestClient, resetDatabase } from "@/test/db";

import { addWatchedCompany, findBoard, listWatchedCompanies, MAX_WATCHED_COMPANIES, nameFrom, removeWatchedCompany, setWatchedCompanyEnabled } from "./companies";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
const prisma = () => db.client!;

const ashby = (title: string, location = "Berlin, Germany") => ({ jobs: [{ id: title, title, location, isRemote: false, publishedAt: "2026-11-01T00:00:00Z", jobUrl: `https://jobs.ashbyhq.com/acme/${title}`, descriptionPlain: "Text." }] });

beforeEach(async () => {
  await resetDatabase(prisma());
  clearJobSearchCache();
});
afterAll(() => prisma().$disconnect());

describe("findBoard", () => {
  it("reads a board link without guessing", async () => {
    const requests = stubFetch(() => json(ashby("Partner Lead")));
    expect(await findBoard("https://jobs.ashbyhq.com/acme/123", "")).toEqual({ board: "ASHBY", slug: "acme", roles: 1 });
    expect(requests).toHaveLength(1);
  });

  it("finds the board on the company's own careers page", async () => {
    stubFetch(() => json(ashby("Partner Lead")));
    const page = vi.fn(async () => ({ ok: true as const, html: '<a href="https://jobs.ashbyhq.com/acme-corp/1">Apply</a>', url: "https://acme.com/careers" }));
    expect(await findBoard("https://acme.com/careers", "", page)).toMatchObject({ board: "ASHBY", slug: "acme-corp" });
    expect(page).toHaveBeenCalledWith("https://acme.com/careers");
  });

  it("tries a name on each board until one answers", async () => {
    const requests = stubFetch(({ url }) => (url.host === "api.lever.co" ? json([{ id: "1", text: "Role", hostedUrl: "https://jobs.lever.co/acme/1" }]) : new Response("nope", { status: 404 })));
    expect(await findBoard("Acme", "Acme")).toEqual({ board: "LEVER", slug: "acme", roles: 1 });
    expect(requests.map(({ url }) => url.host)).toEqual(["boards-api.greenhouse.io", "api.ashbyhq.com", "api.lever.co"]);
  });

  it("doesn't take an empty Lever or Ashby answer for a company", async () => {
    stubFetch(({ url }) => (url.host === "api.ashbyhq.com" ? json({ jobs: [] }) : url.host.includes("lever") ? json([]) : new Response("", { status: 404 })));
    expect(await findBoard("Nobody", "Nobody")).toBeNull();
  });
});

describe("watched companies", () => {
  it("adds a company once its feed answers, named from the link, and only once", async () => {
    stubFetch(() => json(ashby("Partner Lead")));
    const added = await addWatchedCompany({ link: "https://jobs.ashbyhq.com/black-forest-labs" });
    expect(added).toMatchObject({ name: "Black Forest Labs", board: "ASHBY", slug: "black-forest-labs", enabled: true, roles: 1 });
    await expect(addWatchedCompany({ link: "https://jobs.ashbyhq.com/black-forest-labs", name: "BFL" })).rejects.toThrow("Black Forest Labs is already on the list.");
    expect(await listWatchedCompanies()).toHaveLength(1);
  });

  it("says what to try when there's no feed, or nothing to go on", async () => {
    stubFetch(() => new Response("", { status: 404 }));
    await expect(addWatchedCompany({ link: "", name: "Mistral AI" })).rejects.toThrow("Couldn't find a careers feed for that.");
    await expect(addWatchedCompany({ link: " " })).rejects.toThrow("Paste the company's careers link, or type its name.");
  });

  it("keeps to the limit, and switches and removes companies", async () => {
    await prisma().watchedCompany.createMany({ data: Array.from({ length: MAX_WATCHED_COMPANIES }, (_, i) => ({ name: `C${i}`, board: "ASHBY" as const, slug: `c${i}` })) });
    await expect(addWatchedCompany({ link: "Acme" }, prisma(), async () => ({ board: "ASHBY", slug: "acme", roles: 1 }))).rejects.toThrow(`at most ${MAX_WATCHED_COMPANIES}`);
    const [first] = await listWatchedCompanies();
    await setWatchedCompanyEnabled(first.id, false);
    expect((await listWatchedCompanies())[0].enabled).toBe(false);
    await removeWatchedCompany(first.id);
    expect(await listWatchedCompanies()).toHaveLength(MAX_WATCHED_COMPANIES - 1);
    await expect(setWatchedCompanyEnabled(first.id, true)).rejects.toThrow("no longer on the list");
  });

  it("names a company by what was typed, or else its board name", () => {
    expect(nameFrom("ElevenLabs", { board: "ASHBY", slug: "elevenlabs" })).toBe("ElevenLabs");
    expect(nameFrom("https://jobs.lever.co/acme_corp", { board: "LEVER", slug: "acme_corp" })).toBe("Acme Corp");
    expect(nameFrom("deepl.com", { board: "ASHBY", slug: "deepl" })).toBe("Deepl");
  });
});

describe("Brand watch as a job source", () => {
  it("finds the fitting roles across companies, skipping one that doesn't answer", async () => {
    await prisma().watchedCompany.createMany({
      data: [
        { name: "Acme", board: "ASHBY", slug: "acme" },
        { name: "Broken", board: "LEVER", slug: "broken" },
        { name: "Off", board: "ASHBY", slug: "off", enabled: false },
      ],
    });
    const requests = stubFetch(({ url }) => (url.pathname.endsWith("/acme") ? json({ jobs: [...ashby("Head of Partnerships").jobs, ...ashby("Engineer").jobs, ...ashby("Partner Manager", "Tokyo").jobs] }) : new Response("", { status: 500 })));
    const { brands } = await import("@/lib/job-search/brands");
    const page = await brands.search({ ...EMPTY_QUERY, keywords: "partner", place: "Berlin", country: "de" }, {}, null);
    expect(page.postings.map((posting) => posting.title)).toEqual(["Head of Partnerships"]);
    expect(page.next).toBeNull();
    expect(requests.map(({ url }) => url.pathname)).toEqual(["/posting-api/job-board/acme", "/v0/postings/broken"]);
    // A second search within half an hour reads the kept feed.
    await brands.search({ ...EMPTY_QUERY, keywords: "engineer", country: "de" }, {}, null);
    expect(requests.filter(({ url }) => url.pathname.endsWith("/acme"))).toHaveLength(1);
  });

  it("says to add companies first, and fails when none answers", async () => {
    const { brands } = await import("@/lib/job-search/brands");
    await expect(brands.search({ ...EMPTY_QUERY, keywords: "x", country: "de" }, {}, null)).rejects.toThrow("Add the companies to watch in Settings → Brand watch first.");
    await prisma().watchedCompany.create({ data: { name: "Broken", board: "LEVER", slug: "broken" } });
    stubFetch(() => new Response("", { status: 503 }));
    await expect(brands.search({ ...EMPTY_QUERY, keywords: "x", country: "de" }, {}, null)).rejects.toThrow("Brand watch isn't answering");
  });

  it("leaves out roles older than the search asks, and gets a Greenhouse role's text", async () => {
    await prisma().watchedCompany.create({ data: { name: "Acme", board: "ASHBY", slug: "acme" } });
    stubFetch(() => json(ashby("Partner Lead")));
    const { brands } = await import("@/lib/job-search/brands");
    expect((await brands.search({ ...EMPTY_QUERY, keywords: "partner", country: "de", postedWithin: "day" }, {}, null)).postings).toEqual([]);
    stubFetch(() => json({ content: "&lt;p&gt;Hi&lt;/p&gt;" }));
    const base = { source: "BRANDS" as const, title: "", company: "", place: "", remote: null, salary: "", postedAt: null, url: "", via: "", complete: false };
    expect(await brands.details({ ...base, externalId: "greenhouse:anthropic:1", description: "" }, {})).toBe("Hi");
    expect(await brands.details({ ...base, externalId: "ashby:acme:1", description: "" }, {})).toBeNull();
    expect(await brands.details({ ...base, externalId: "ashby:acme:1", description: "Kept" }, {})).toBe("Kept");
    await expect(brands.test({})).resolves.toBeUndefined();
  });
});
