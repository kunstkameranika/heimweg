import { describe, expect, it } from "vitest";

import { boardFeedUrl, boardPageUrl, boardRefsIn, slugGuesses } from "./boards";

describe("boardRefsIn", () => {
  it.each([
    ["https://job-boards.greenhouse.io/anthropic", { board: "GREENHOUSE", slug: "anthropic" }],
    ["https://boards.greenhouse.io/anthropic/jobs/5456619008", { board: "GREENHOUSE", slug: "anthropic" }],
    ["https://boards.greenhouse.io/embed/job_board?for=figma&b=x", { board: "GREENHOUSE", slug: "figma" }],
    ["https://jobs.lever.co/spotify/2a55d6c9", { board: "LEVER", slug: "spotify" }],
    ["https://jobs.eu.lever.co/acme", { board: "LEVER_EU", slug: "acme" }],
    ["https://jobs.ashbyhq.com/ElevenLabs/a571b8e4", { board: "ASHBY", slug: "ElevenLabs" }],
    ["https://api.ashbyhq.com/posting-api/job-board/openai", { board: "ASHBY", slug: "openai" }],
  ])("reads %s", (link, ref) => {
    expect(boardRefsIn(link)).toEqual([ref]);
  });

  it("finds a careers page's board links in order, once each", () => {
    const html = `<a href="https://jobs.ashbyhq.com/acme/1">Job</a><a href="https://jobs.ashbyhq.com/acme/2">Job</a><script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>`;
    expect(boardRefsIn(html)).toEqual([{ board: "ASHBY", slug: "acme" }, { board: "GREENHOUSE", slug: "acme" }]);
  });

  it("ignores links that aren't a company's board", () => {
    expect(boardRefsIn("https://example.com/careers")).toEqual([]);
    expect(boardRefsIn("https://boards.greenhouse.io/embed/")).toEqual([]);
  });
});

describe("slugGuesses", () => {
  it("tries the joined, hyphenated and shortened forms of a name", () => {
    expect(slugGuesses("Black Forest Labs")).toEqual(expect.arrayContaining(["blackforestlabs", "black-forest-labs", "blackforest", "black"]));
    expect(slugGuesses("ElevenLabs")[0]).toBe("elevenlabs");
    expect(slugGuesses("https://www.deepl.com/careers")).toContain("deepl");
    expect(slugGuesses("  ")).toEqual([]);
  });
});

describe("board addresses", () => {
  it("names each board's feed and page", () => {
    expect(boardFeedUrl("GREENHOUSE", "anthropic").href).toBe("https://boards-api.greenhouse.io/v1/boards/anthropic/jobs");
    expect(boardFeedUrl("LEVER", "spotify").href).toBe("https://api.lever.co/v0/postings/spotify?mode=json");
    expect(boardFeedUrl("LEVER_EU", "acme").host).toBe("api.eu.lever.co");
    expect(boardFeedUrl("ASHBY", "openai").href).toContain("api.ashbyhq.com/posting-api/job-board/openai");
    expect(boardPageUrl("ASHBY", "openai")).toBe("https://jobs.ashbyhq.com/openai");
    expect(boardPageUrl("GREENHOUSE", "a b")).toBe("https://job-boards.greenhouse.io/a%20b");
    expect(boardPageUrl("LEVER", "x")).toBe("https://jobs.lever.co/x");
    expect(boardPageUrl("LEVER_EU", "x")).toBe("https://jobs.eu.lever.co/x");
  });
});
