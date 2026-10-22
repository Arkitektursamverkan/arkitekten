/**
 * Migrerar sparade flöden i flows/ till den BPMN-korrekta strukturen.
 *
 * Kör `--dry` först för att se vad som skulle ändras utan att skriva något.
 * Utan flagga skrivs resultatet som en NY VERSION i varje flöde – det gamla
 * innehållet finns kvar i historiken och går att återgå till i appen.
 *
 *   npx tsx scripts/migrate-flows.mts --dry
 *   npx tsx scripts/migrate-flows.mts
 */

import fs from "node:fs";
import path from "node:path";
import { migrateDraft } from "@/core/migrate";
import { compileDraft } from "@/core/draft";
import { validateModel } from "@/tools/flowchart/parser/validate";
import type { SavedFlow } from "@/core/flow-store";

const DRY = process.argv.includes("--dry");
const DIR = "flows";

/** Kort BPMN-status för en draft, så före/efter går att jämföra. */
function status(flow: SavedFlow, draft = flow.draft) {
  const m = compileDraft(draft);
  const rep = validateModel(m);
  const iFlödet = m.edges.filter(
    (e) => m.dataStores.some((d) => d.id === e.source || d.id === e.target),
  ).length;
  return {
    meddelandeflöden: m.messageFlows.length,
    datalagerIFlödet: iFlödet,
    avvikelser: rep.bpmn.filter((i) => i.level === "error").length,
    varningar: rep.bpmn.filter((i) => i.level === "warn").length,
    ohanterade: rep.unaccounted.length,
  };
}

let ändrade = 0;
for (const fil of fs.readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const sökväg = path.join(DIR, fil);
  const flow: SavedFlow = JSON.parse(fs.readFileSync(sökväg, "utf8"));

  const före = status(flow);
  const { draft, changes } = migrateDraft(flow.draft);
  const efter = status(flow, draft);

  console.log(`\n=== ${flow.name} (${fil})`);
  if (changes.length === 0) {
    console.log("   inget att rätta");
    continue;
  }
  for (const c of changes) console.log("   •", c);
  console.log(
    `   före:  ${före.meddelandeflöden} meddelandeflöden, ${före.datalagerIFlödet} datalager i flödet, ` +
      `${före.avvikelser} fel / ${före.varningar} varningar, ${före.ohanterade} ohanterade fragment`,
  );
  console.log(
    `   efter: ${efter.meddelandeflöden} meddelandeflöden, ${efter.datalagerIFlödet} datalager i flödet, ` +
      `${efter.avvikelser} fel / ${efter.varningar} varningar, ${efter.ohanterade} ohanterade fragment`,
  );

  if (DRY) continue;

  // Spara som ny version – det gamla går att återgå till i appen.
  const version = {
    id: `v${(flow.versions?.length ?? 0) + 1}`,
    savedAt: new Date().toISOString(),
    label: "BPMN-migrering",
    rawText: flow.rawText,
    aiText: flow.aiText,
    draft,
  };
  const uppdaterad: SavedFlow = {
    ...flow,
    savedAt: version.savedAt,
    draft,
    versions: [...(flow.versions ?? []), version],
  };
  fs.writeFileSync(sökväg, JSON.stringify(uppdaterad, null, 2), "utf8");
  ändrade++;
}

console.log(
  DRY ? "\n(torrkörning – inget skrevs)" : `\n${ändrade} flöden migrerade, gamla versionen kvar i historiken`,
);
