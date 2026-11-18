"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action } from "@/lib/action";
import { addWatchedCompany, listWatchedCompanies, removeWatchedCompany, setWatchedCompanyEnabled } from "@/lib/brands/companies";

// Settings → Brand watch: the companies whose careers pages the Brand watch
// source reads.

const id = z.string().min(1).max(100);

/** Follows a company by its careers link or name, once its feed answers; says how many roles it lists. */
export const addBrand = action(z.object({ link: z.string().max(2000), name: z.string().max(100).optional() }), async (input) => {
  const company = await addWatchedCompany(input);
  revalidatePath("/settings");
  return { company, companies: await listWatchedCompanies() };
});

export const setBrandEnabled = action(z.object({ id, enabled: z.boolean() }), async ({ id, enabled }) => {
  await setWatchedCompanyEnabled(id, enabled);
  return listWatchedCompanies();
});

export const removeBrand = action(z.object({ id }), async ({ id }) => {
  await removeWatchedCompany(id);
  return listWatchedCompanies();
});
