import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { CareersBoard } from "@/generated/prisma/enums";
import { ActionError } from "@/lib/action";
import { JobSearchError } from "@/lib/job-search/errors";
import { fetchHtml } from "@/lib/posting-fetch";
import { prisma } from "@/lib/prisma";

import { BOARD_NAMES, boardRefsIn, slugGuesses, type BoardRef } from "./boards";
import { readFeed } from "./feeds";

// The companies Brand watch follows (Settings → Brand watch). A company is
// added by its careers link or its name; Dossier works out which board its
// feed is on and checks that it answers before keeping it.

export const MAX_WATCHED_COMPANIES = 40;

export type WatchedCompanyView = { id: string; name: string; board: CareersBoard; slug: string; enabled: boolean };

export async function listWatchedCompanies(db: PrismaClient = prisma): Promise<WatchedCompanyView[]> {
  return db.watchedCompany.findMany({
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, board: true, slug: true, enabled: true },
  });
}

const BOARDS: CareersBoard[] = ["GREENHOUSE", "ASHBY", "LEVER", "LEVER_EU"];

/** The number of roles a board lists for `ref`, or null when it has no such company. */
async function openRoles(ref: BoardRef, name: string): Promise<number | null> {
  try {
    const roles = await readFeed({ ...ref, name });
    // Lever and Ashby answer an unknown company with an empty list or an error.
    return roles.length > 0 ? roles.length : ref.board === "GREENHOUSE" ? 0 : null;
  } catch (error) {
    if (error instanceof JobSearchError) return null;
    throw error;
  }
}

export type FoundBoard = BoardRef & { roles: number };

/**
 * Where a company's roles are: from a board link, from the board links on
 * its own careers page, or by trying its name on each board.
 */
export async function findBoard(input: string, name: string, fetchPage = fetchHtml): Promise<FoundBoard | null> {
  const candidates: BoardRef[] = boardRefsIn(input);
  if (!candidates.length && /^https?:\/\//i.test(input.trim())) {
    const page = await fetchPage(input.trim());
    if (page.ok) candidates.push(...boardRefsIn(page.html));
  }
  if (!candidates.length) {
    const guesses = slugGuesses(name || input);
    for (const slug of guesses) for (const board of BOARDS) candidates.push({ board, slug });
  }
  for (const ref of candidates.slice(0, 24)) {
    const roles = await openRoles(ref, name);
    if (roles !== null) return { ...ref, roles };
  }
  return null;
}

/** "https://jobs.lever.co/spotify" → "Spotify"; a typed name stays as it is. */
export function nameFrom(input: string, found: BoardRef): string {
  const typed = input.trim();
  if (typed && !/^https?:\/\/|\.\w{2,}\//i.test(typed) && !/^[\w-]+\.[a-z]{2,}$/i.test(typed)) return typed.slice(0, 100);
  return found.slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 100);
}

/** Follows a company, once its feed answers. */
export async function addWatchedCompany(input: { link: string; name?: string }, db: PrismaClient = prisma, find = findBoard): Promise<WatchedCompanyView & { roles: number }> {
  const link = input.link.trim();
  const name = input.name?.trim() ?? "";
  if (!link && !name) throw new ActionError("Paste the company's careers link, or type its name.");
  if (await db.watchedCompany.count() >= MAX_WATCHED_COMPANIES) throw new ActionError(`Brand watch follows at most ${MAX_WATCHED_COMPANIES} companies.`);
  const found = await find(link || name, name);
  if (!found) {
    throw new ActionError(
      `Couldn't find a careers feed for that. Brand watch reads companies hiring through ${Object.values(BOARD_NAMES).filter((board) => board !== "Lever (EU)").join(", ")}; try the link of one of its job ads.`,
    );
  }
  const existing = await db.watchedCompany.findUnique({ where: { board_slug: { board: found.board, slug: found.slug } } });
  if (existing) throw new ActionError(`${existing.name} is already on the list.`);
  const company = await db.watchedCompany.create({
    data: { name: nameFrom(name || link, found), board: found.board, slug: found.slug },
    select: { id: true, name: true, board: true, slug: true, enabled: true },
  });
  return { ...company, roles: found.roles };
}

export async function setWatchedCompanyEnabled(id: string, enabled: boolean, db: PrismaClient = prisma): Promise<void> {
  const { count } = await db.watchedCompany.updateMany({ where: { id }, data: { enabled } });
  if (!count) throw new ActionError("That company is no longer on the list.");
}

export async function removeWatchedCompany(id: string, db: PrismaClient = prisma): Promise<void> {
  await db.watchedCompany.deleteMany({ where: { id } });
}
