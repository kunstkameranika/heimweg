import { describe, expect, it } from "vitest";

import { AGENT_MAX_SOURCE_REQUESTS_PER_DAY, MAX_AGENT_SEARCHES, MAX_AGENT_SEARCHES_TEXT } from "./limits";

describe("agent limits", () => {
  it("allows ten searches, each able to run once a day", () => {
    expect(MAX_AGENT_SEARCHES).toBe(10);
    expect(AGENT_MAX_SOURCE_REQUESTS_PER_DAY).toBe(MAX_AGENT_SEARCHES);
    expect(MAX_AGENT_SEARCHES_TEXT).toBe("Keep at most ten Agent searches.");
  });
});
