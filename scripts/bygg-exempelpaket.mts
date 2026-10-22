/**
 * Bygger exempelpaketet `innehallspaket/exempel/` – det neutrala innehåll en
 * ny installation kan lägga in (`npx tsx server/innehallspaket.mts import exempel`).
 *
 * Processerna tolkas av regelmotorn ur texten nedan, så paketet följer alltid
 * med när mellanlagret ändras: kör skriptet igen och committa resultatet.
 * Tidsstämplarna är fasta, så samma kod ger samma filer.
 *
 *   npx tsx scripts/bygg-exempelpaket.mts
 */

import fs from "node:fs";
import path from "node:path";
import type { ProcessDraft } from "@/core/draft";
import { textToDraft } from "@/tools/flowchart/parser/toDraft";
import { FORMAT, VERSION } from "../server/innehallspaket.mjs";

const UT = path.resolve("innehallspaket/exempel");
const TID = "2026-10-22T08:00:00.000Z";

const PROCESSER: Array<{ id: string; namn: string; kategori: string; affärsprocess?: boolean; text: string }> = [
  {
    id: "ap-exempel-rekrytering",
    namn: "Rekrytering",
    kategori: "Exempel",
    affärsprocess: true,
    text: [
      "Rekrytering\n" + "Behov av ny medarbetare [Ut: Behov fastställt]",
      "→ Ta fram kravprofil [Roll: Rekryterande chef U] [Ut: Kravprofil]",
      "→ Annonsera tjänsten [Roll: HR-specialist U] [IT: Rekryteringssystemet] [Ut: Ansökningar]",
      "→ Genomför urval [Roll: Rekryterande chef H] [Roll: HR-specialist K] [Krav: Likabehandling] [Ut: Slutkandidat]",
      "→ Erbjud anställning [Roll: HR-specialist U] [Tid: Inom 5 dagar] [Ut: Anställningsavtal]",
    ].join(" "),
  },
  {
    id: "exempel-bestall-behorighet",
    namn: "Beställ behörighet",
    kategori: "Exempel",
    text: [
      "Beställ behörighet\n" + "Medarbetare behöver behörighet → Öppnar portalen → Fyller i beställningen → Skickar in",
      "→ Chefen granskar beställningen",
      "(↓ Om chefen godkänner → Behörigheten läggs upp → Bekräftelse till medarbetaren)",
      "(↓ Om chefen avslår → Avslag till medarbetaren)",
    ].join(" "),
  },
];

function flöde(p: (typeof PROCESSER)[number]) {
  const tolkad = textToDraft(p.text);
  const draft: ProcessDraft = p.affärsprocess ? { ...tolkad, diagramType: "affarsprocess" } : tolkad;
  return {
    id: p.id,
    name: p.namn,
    category: p.kategori,
    savedAt: TID,
    rawText: p.text,
    draft,
    versions: [
      { id: `${p.id}-v1`, savedAt: TID, label: "Exempel", status: "fastslagen", rawText: p.text, draft },
    ],
  };
}

fs.rmSync(UT, { recursive: true, force: true });
fs.mkdirSync(path.join(UT, "flows"), { recursive: true });
for (const p of PROCESSER) fs.writeFileSync(path.join(UT, "flows", `${p.id}.json`), JSON.stringify(flöde(p), null, 2));
fs.writeFileSync(
  path.join(UT, "pack.json"),
  JSON.stringify(
    {
      format: FORMAT,
      version: VERSION,
      namn: "Exempel",
      beskrivning: "En affärsprocess och en systemprocess att utgå från.",
      antal: { flows: PROCESSER.length },
    },
    null,
    2,
  ) + "\n",
);
console.log(`Byggt ${UT}: ${PROCESSER.length} processer.`);
