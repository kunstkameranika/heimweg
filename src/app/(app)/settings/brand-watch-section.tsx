"use client";

import { useState, useTransition } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { BOARD_NAMES, boardPageUrl } from "@/lib/brands/boards";
import type { WatchedCompanyView } from "@/lib/brands/companies";

import { addBrand, removeBrand, setBrandEnabled } from "./brand-actions";
import { SettingsSectionIntro } from "./settings-screen";

/**
 * Settings → Brand watch: the companies whose open roles Dossier reads
 * straight from their careers pages. A recurring search with Brand watch as
 * its source looks through all of them.
 */
export function BrandWatchSection({ initial }: { initial: WatchedCompanyView[] }) {
  const track = useTrackSave();
  const [companies, setCompanies] = useState(initial);
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const add = () =>
    startTransition(async () => {
      setError(null);
      const result = await track(addBrand({ link, name: name || undefined }));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCompanies(result.data.companies);
      setLink("");
      setName("");
      const { company } = result.data;
      toast(`${company.name} added: ${company.roles} open ${company.roles === 1 ? "role" : "roles"} on ${BOARD_NAMES[company.board]}.`);
    });
  const toggle = (company: WatchedCompanyView, enabled: boolean) =>
    startTransition(async () => {
      const result = toastResult(await track(setBrandEnabled({ id: company.id, enabled })));
      if (result.ok) setCompanies(result.data);
    });
  const remove = (company: WatchedCompanyView) =>
    startTransition(async () => {
      const result = toastResult(await track(removeBrand({ id: company.id })));
      if (result.ok) setCompanies(result.data);
    });

  return (
    <>
      <SettingsSectionIntro title="Brand watch">
        The companies you&apos;d most like to work for. Dossier reads every open role straight from their careers pages, and a recurring search with
        Brand watch as its source finds the ones that fit, in Settings → Job agent.
      </SettingsSectionIntro>

      <Card padding="none" className="flex flex-col gap-4 px-7 py-[26px]">
        <form
          aria-label="Add a company"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <fieldset disabled={pending} className="grid min-w-0 grid-cols-1 items-start gap-4 sm:grid-cols-2">
            <Input
              label="Careers page or job ad link"
              hint="Or just the company's name"
              value={link}
              spellCheck={false}
              placeholder="https://jobs.ashbyhq.com/elevenlabs"
              onChange={(event) => setLink(event.target.value)}
            />
            <Input label="Name (optional)" value={name} maxLength={100} placeholder="ElevenLabs" onChange={(event) => setName(event.target.value)} />
          </fieldset>
          {error && <p role="alert" className="text-meta text-error">{error}</p>}
          <div>
            <Button type="submit" disabled={pending || (!link.trim() && !name.trim())}>
              {pending ? "Looking for its careers feed…" : "Add company"}
            </Button>
          </div>
          <p className="text-meta text-muted">
            Works for companies hiring through Greenhouse, Lever or Ashby, which most tech and AI companies use. For the rest, FreeHire and JSearch still find their roles.
          </p>
        </form>

        <h3 className="border-t border-line pt-4 text-field font-medium">Following ({companies.length})</h3>
        {companies.length === 0 ? (
          <p className="text-meta text-muted">No companies yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {companies.map((company) => (
              <li key={company.id} className="flex flex-wrap items-center justify-between gap-3">
                <Toggle
                  label={company.name}
                  description={
                    <a href={boardPageUrl(company.board, company.slug)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      {BOARD_NAMES[company.board]}
                    </a>
                  }
                  checked={company.enabled}
                  disabled={pending}
                  onCheckedChange={(enabled) => toggle(company, enabled)}
                />
                <Button variant="danger-text" size="sm" aria-label={`Remove ${company.name}`} disabled={pending} onClick={() => remove(company)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
