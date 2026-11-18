import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { WatchedCompanyView } from "@/lib/brands/companies";

import { addBrand, removeBrand, setBrandEnabled } from "./brand-actions";
import { BrandWatchSection } from "./brand-watch-section";

vi.mock("./brand-actions", () => ({ addBrand: vi.fn(), removeBrand: vi.fn(), setBrandEnabled: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean; error?: string }) => result }));

const anthropic: WatchedCompanyView = { id: "a", name: "Anthropic", board: "GREENHOUSE", slug: "anthropic", enabled: true };
const openai: WatchedCompanyView = { id: "o", name: "OpenAI", board: "ASHBY", slug: "openai", enabled: true };

beforeEach(() => vi.clearAllMocks());

describe("Settings → Brand watch", () => {
  it("lists the companies with their careers page", () => {
    render(<BrandWatchSection initial={[anthropic]} />);
    expect(screen.getByRole("heading", { name: "Brand watch" })).toBeInTheDocument();
    expect(screen.getByText("Following (1)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Greenhouse" })).toHaveAttribute("href", "https://job-boards.greenhouse.io/anthropic");
  });

  it("adds a company by its link and says how many roles it has", async () => {
    const user = userEvent.setup();
    render(<BrandWatchSection initial={[]} />);
    expect(screen.getByText("No companies yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add company" })).toBeDisabled();
    vi.mocked(addBrand).mockResolvedValueOnce({ ok: true, data: { company: { ...openai, roles: 837 }, companies: [openai] } });
    await user.type(screen.getByLabelText("Careers page or job ad link"), "https://jobs.ashbyhq.com/openai");
    await user.click(screen.getByRole("button", { name: "Add company" }));
    expect(addBrand).toHaveBeenCalledWith({ link: "https://jobs.ashbyhq.com/openai", name: undefined });
    expect(toast).toHaveBeenCalledWith("OpenAI added: 837 open roles on Ashby.");
    expect(await screen.findByRole("switch", { name: "OpenAI" })).toBeChecked();
    expect(screen.getByLabelText("Careers page or job ad link")).toHaveValue("");
  });

  it("shows why a company couldn't be added", async () => {
    const user = userEvent.setup();
    render(<BrandWatchSection initial={[]} />);
    vi.mocked(addBrand).mockResolvedValueOnce({ ok: false, error: "Couldn't find a careers feed for that." });
    await user.type(screen.getByLabelText("Name (optional)"), "Mistral AI");
    await user.click(screen.getByRole("button", { name: "Add company" }));
    expect(addBrand).toHaveBeenCalledWith({ link: "", name: "Mistral AI" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't find a careers feed for that.");
  });

  it("pauses and removes companies", async () => {
    const user = userEvent.setup();
    render(<BrandWatchSection initial={[anthropic, openai]} />);
    vi.mocked(setBrandEnabled).mockResolvedValueOnce({ ok: true, data: [{ ...anthropic, enabled: false }, openai] });
    await user.click(screen.getByRole("switch", { name: "Anthropic" }));
    expect(setBrandEnabled).toHaveBeenCalledWith({ id: "a", enabled: false });
    expect(await screen.findByRole("switch", { name: "Anthropic" })).not.toBeChecked();
    vi.mocked(removeBrand).mockResolvedValueOnce({ ok: true, data: [anthropic] });
    await user.click(screen.getByRole("button", { name: "Remove OpenAI" }));
    expect(removeBrand).toHaveBeenCalledWith({ id: "o" });
    expect(await screen.findByText("Following (1)")).toBeInTheDocument();
  });
});
