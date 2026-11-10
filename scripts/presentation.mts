/**
 * Kontrollerar – och skickar – svaret på ett PRESENTATIONSUPPDRAG.
 *
 * Appens knapp "Förenkla och presentera" lägger en begäran i `.ark/request.json`
 * med `uppdrag: "presentation"`. Den som svarar (Claude Code) skriver sitt svar
 * till ett UTKAST, inte rakt i brevlådan: appen plockar upp `response.json` i
 * samma stund som den finns, och då ska den vara färdig.
 *
 * Skriptet kör utkastet genom SAMMA kod som appen (`byggPresentation` i
 * src/tools/ramar/ai-presentation.ts), så det som godkänns här är det som
 * sparas. Det skriver aldrig till `flows/` eller `ramar/` – det gör appen.
 *
 * Brevlådan hittas själv: `.ark/` i öppen drift, annars användarens låda
 * (`.ark/anvandare/<hash>/`, listas med `npx tsx scripts/brevlada.mts`).
 *
 *   npx tsx scripts/presentation.mts                 # .ark/utkast.json
 *   npx tsx scripts/presentation.mts <utkast.json>
 *   npx tsx scripts/presentation.mts --png <fil>     # rita den avskalade bilden
 *   npx tsx scripts/presentation.mts --skicka        # lägg svaret i brevlådan
 *
 * Finns bara "förenklad" i utkastet listas processens objekt och kopplingar –
 * det är de id:n ramarnas markeringar ska peka på.
 */

import fs from "node:fs";
import path from "node:path";
import { väntandeBegäranden } from "../server/brevlada";
import { Resvg } from "@resvg/resvg-js";
import {
  PRESENTATION_UPPDRAG,
  beskrivFörenklad,
  byggFörenklad,
  byggPresentation,
  type ByggdPresentation,
} from "@/tools/ramar/ai-presentation";
import { renderAvskaladSvg } from "@/tools/ramar/avskalad";
import { ramScen } from "@/core/ram-scen";

const args = process.argv.slice(2);
/**
 * Brevlådan. `--ark <katalog>` pekar ut en annan – för att prova utan att röra
 * den riktiga. Annars den delade (`.ark/`, öppen drift) om en begäran ligger
 * där, och i annat fall den användarlåda (`.ark/anvandare/<hash>/`) där ett
 * presentationsuppdrag senast lades och ännu väntar (server/brevlada.ts).
 */
const ARK_ROT = process.env.ARK_DIR?.trim() || ".ark";
function väljBrevlåda(): string {
  if (args.includes("--ark")) return args[args.indexOf("--ark") + 1];
  if (fs.existsSync(`${ARK_ROT}/request.json`)) return ARK_ROT;
  const väntande = väntandeBegäranden(ARK_ROT).filter((b) => b.uppdrag === PRESENTATION_UPPDRAG);
  return väntande[0] ? path.relative(process.cwd(), väntande[0].katalog) : ARK_ROT;
}
const ARK = väljBrevlåda();
const BEGÄRAN = `${ARK}/request.json`;
const SVAR = `${ARK}/response.json`;

const SKICKA = args.includes("--skicka");
const PNG = args.includes("--png") ? args[args.indexOf("--png") + 1] : null;
const utkastFil =
  args.find((a, i) => !a.startsWith("--") && !["--png", "--ark"].includes(args[i - 1])) ?? (args.includes("--ark") ? `${ARK}/utkast.json` : `${ARK_ROT}/utkast.json`);

const läs = (fil: string) => {
  if (!fs.existsSync(fil)) {
    console.error(`Hittar inte ${fil}.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(fil, "utf8"));
};

const begäran = läs(BEGÄRAN);
if (begäran.uppdrag !== PRESENTATION_UPPDRAG) {
  console.error(`${BEGÄRAN} är inte ett presentationsuppdrag (uppdrag: "${begäran.uppdrag ?? "tolkning"}").`);
  process.exit(1);
}
let beskrivning = "";
try {
  beskrivning = String(JSON.parse(begäran.rawText).beskrivning ?? "");
} catch {
  beskrivning = String(begäran.rawText ?? "");
}
const källa = {
  flödeId: String(begäran.källa?.flödeId ?? ""),
  namn: String(begäran.källa?.namn ?? "Processen"),
  beskrivning,
};

const utkast = läs(utkastFil);
console.log(`Begäran ${begäran.id} · "${källa.namn}" (${källa.flödeId || "osparad"}) · utkast: ${utkastFil}\n`);

/* ---- Processen ---- */

const process_ = byggFörenklad(utkast, källa);
const { bild } = process_;
console.log(beskrivFörenklad(process_));

if (PNG) {
  const png = new Resvg(renderAvskaladSvg(bild), { fitTo: { mode: "width", value: 1600 } }).render().asPng();
  fs.writeFileSync(PNG, png);
  console.log(`\n  bild → ${PNG}`);
}

/* ---- Presentationen ---- */

if (!utkast.presentation) {
  console.log('\nUtkastet har ingen "presentation" än – lägg till ramarna och kör igen.');
  process.exit(SKICKA ? 1 : 0);
}

let byggd: ByggdPresentation;
try {
  // De upptagna id:na läses ur projektet, så att skriptet säger samma id som appen väljer.
  const idn = (kat: string) => (fs.existsSync(kat) ? fs.readdirSync(kat).map((f) => f.replace(/\.json$/, "")) : []);
  byggd = byggPresentation(utkast, källa, idn("ramar"), idn("flows"));
} catch (e) {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

const { serie } = byggd;
console.log(`\nPRESENTATION: "${serie.namn}" · ${serie.ramar.length} ramar · ${serie.scen!.figurer.length} figurer`);
console.log(`  figurer: ${serie.scen!.figurer.map((f) => `${f.id} (${f.typ})`).join(", ")}`);
serie.ramar.forEach((r, i) => {
  const rs = ramScen(r);
  const synliga = serie.scen!.figurer.length - rs.dolda.length;
  console.log(
    `  ${String(i + 1).padStart(2)}. ${r.rubrik}\n` +
      `      flöde: ${r.markeringar.map((m) => m.mål.id).join(", ") || "–"}\n` +
      `      bild:  ${synliga} figurer, ${rs.pulser.length} pulser, ${rs.bubblor.length} bubblor, ${rs.textrutor.length} textrutor`,
  );
});

if (byggd.anmärkningar.length) {
  console.log(`\n! ${byggd.anmärkningar.length} anmärkning(ar):`);
  for (const a of byggd.anmärkningar) console.log(`  - ${a}`);
} else {
  console.log("\n✓ Inga anmärkningar.");
}
console.log(`\nSparas av appen som NYA poster: flows/${byggd.flödeId}.json och ramar/${serie.id}.json.`);

if (SKICKA) {
  // requestId är korrelationen: ett svar på en avbruten begäran kasseras av bryggan.
  fs.writeFileSync(SVAR, JSON.stringify({ ...utkast, requestId: begäran.id }, null, 2), "utf8");
  console.log(`→ ${SVAR} (requestId ${begäran.id})`);
}
