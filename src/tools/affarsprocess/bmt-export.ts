/**
 * BMT-exporten i appen: hämtar installationens MALL från servern
 * (`/__ark/bmt/mall`, server/bmt-mall.ts), bygger filen i webbläsaren med
 * `byggBmt` och laddar ner den. Knappen visas bara när servern säger att en
 * mall finns (`bmtMall` i `/__ark/status`).
 */

import { useEffect, useState } from "react";
import { compileAp, lyftUtChecklistor } from "@/core/affarsprocess";
import type { ProcessDraft } from "@/core/draft";
import { läsZip } from "@/core/zip";
import { byggBmt, inställningarUrMall } from "./bmt";
import { layoutAp } from "./layout-affarsprocess";

let delad: Promise<boolean> | null = null;

/** Finns en mall för BMT-exporten i installationen? Frågas en gång per sidladdning. */
export function useBmtMall(): boolean {
  const [finns, setFinns] = useState(false);
  useEffect(() => {
    let levande = true;
    delad ??= fetch("/__ark/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { bmtMall?: boolean } | null) => Boolean(s?.bmtMall))
      .catch(() => false);
    void delad.then((v) => levande && setFinns(v));
    return () => {
      levande = false;
    };
  }, []);
  return finns;
}

export interface BmtExportKälla {
  draft: ProcessDraft;
  /** Det sparade flödets id – ger stabila id:n, så att en ny export uppdaterar. */
  flödeId: string | null;
  namn: string;
  /** När versionen sparades; ett osparat utkast får "nu". */
  sparad?: string;
}

/** Bygger .bmt-filen. Kastar ett begripligt fel när mallen saknas eller är trasig. */
export async function byggBmtFil(k: BmtExportKälla): Promise<Uint8Array> {
  const svar = await fetch("/__ark/bmt/mall");
  if (!svar.ok) {
    const fel = (await svar.json().catch(() => null)) as { error?: string } | null;
    throw new Error(fel?.error ?? "Mallen för BMT-exporten gick inte att hämta.");
  }
  const mall = await läsZip(new Uint8Array(await svar.arrayBuffer()));
  // Checklistor i kraven blir rutiner även i filen – samma lyft som inspektören gör.
  const draft = lyftUtChecklistor(k.draft);
  const lo = layoutAp(compileAp(draft), { edgeStyles: draft.edgeStyles });
  return byggBmt(
    lo,
    {
      // Ett osparat flöde har inget id än: då blir filen en ny modell varje gång.
      flödeId: k.flödeId ?? `osparad-${Date.now()}`,
      namn: k.namn,
      sparad: k.sparad ? new Date(k.sparad) : new Date(),
    },
    inställningarUrMall(mall),
  );
}

export async function laddaNerBmt(k: BmtExportKälla, filnamn: string): Promise<void> {
  const data = await byggBmtFil(k);
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filnamn;
  a.click();
  URL.revokeObjectURL(url);
}
