/**
 * Granskar sidbrytningen mot regelverket i docs/sidbrytningsregler.md,
 * för exempel­flödet och alla sparade flöden, i Word-format.
 *
 *   npx tsx scripts/granska-sidor.mts
 */

import fs from "node:fs";
import path from "node:path";
import { compileDraft } from "@/core/draft";
import { filterByPerspective } from "@/tools/flowchart/perspective";
import { layoutModel, PAGE_FORMATS } from "@/tools/flowchart/layout/layout";
import { granskaSidor, rapportSomText } from "@/tools/flowchart/layout/page-rules";
import { textToDraft } from "@/tools/flowchart/parser/toDraft";

const fmt = PAGE_FORMATS.word;

function granska(namn: string, draft: Parameters<typeof compileDraft>[0]) {
  const model = filterByPerspective(compileDraft(draft), "system");
  const lo = layoutModel(model, { pageWidth: fmt.width, scale: 1 });
  console.log(`\n=== ${namn} (${lo.pages.length} del/ar i Word-format)`);
  console.log(rapportSomText(granskaSidor(model, lo)));
}

const flowsDir = path.join(process.cwd(), "flows");
for (const fil of fs.readdirSync(flowsDir).filter((f) => f.endsWith(".json"))) {
  const flow = JSON.parse(fs.readFileSync(path.join(flowsDir, fil), "utf8"));
  // Affärsprocesserna delar mapp men har en egen layoutmotor och egna regler –
  // samma avgränsning som page-rules.test.ts.
  if (fil.startsWith("ap-") || flow?.draft?.diagramType === "affarsprocess") continue;
  granska(flow.name ?? fil, flow.draft);
}

granska(
  "Exempelflödet",
  textToDraft(`Driftfråga ny
Fel uppkommer → Medarbetare → Startar portalen → Väljer ny driftfråga från startsidan → Fyller i formulär för driftfråga → Väljer skicka in formuläret för driftfråga → Handläggare utses automatiskt utifrån det system som valts → Kommer till en sida med tack för ditt ärende → Får via mejl bekräftelse på att driftfråga har inkommit

Driftfråga inkommer i SP-listan "Inkorgen" → Power Automate flödet "DRF nytt ärende" triggas (↓ Om klassificering = Hög prioritet → Teamschatt skapas med alla handläggare på IT → Chattmeddelande genereras för det specifika ärendet) → Mejlbekräftelse skickas till användaren → Mejl skickas till handläggaren → Loggpost skapas`),
);
