/**
 * Rättar rutor som bär två likadana sidhänvisningar ("från del 2" två gånger).
 *
 * Går både en sekvenspil och en streckad association över samma snitt till
 * samma ruta staplas två märken med samma text på varandra. Regeln – behåll
 * flödets märke, dölj artefaktens – bor i
 * `layout/dubbla-hanvisningar.ts` och delas med skriptet som skapar
 * avvikelseflödena. Den här rättningen är för flöden som redan ligger på disk
 * och som ändrats i appen efteråt: ett drag i en pil kan flytta ett snitt och
 * väcka dubbelmärket igen, långt efter att flödet skapades.
 *
 * HISTORIKEN SKRIVS INTE OM. Rättningen läggs som en NY version, precis som en
 * sparning i appen – de gamla versionerna står kvar som de var.
 *
 * STATUSEN ÄR ETT BESLUT, inte skriptets. Ett fastslaget flöde rörs bara när
 * `--status` är UTSATT: en rättning som läggs som utkast degraderar 1.0 till
 * 1.1 och syns inte i exporten (den exporterar huvudversionen), medan en ny
 * fastslagen blir 2.0. Båda är fel svar att gissa på någon annans räkning –
 * jämför resonemanget i ratta-slutbanor.mts.
 *
 * Vakten frågar därför efter ett UTTRYCKLIGT val, inte efter ett visst svar.
 * Utelämnad flagga betyder "ingen har bestämt" och lämnar fastslagna orörda;
 * `--status=utkast` är ett lika giltigt beslut som `--status=fastslagen` och
 * släpps igenom. Utan den skillnaden gick det inte att medvetet välja utkast
 * på ett fastslaget flöde – flaggans frånvaro och valet "utkast" såg likadana
 * ut för skriptet.
 *
 *   npx tsx scripts/ratta-dubbla-hanvisningar.mts                       # torrkörning
 *   npx tsx scripts/ratta-dubbla-hanvisningar.mts --skriv               # utkast, bara ej fastslagna
 *   npx tsx scripts/ratta-dubbla-hanvisningar.mts --skriv --status=utkast
 *   npx tsx scripts/ratta-dubbla-hanvisningar.mts --skriv --status=fastslagen
 *   ... --bara=avvikelse-byt-avdelning                                  # ett flöde
 */

import fs from "node:fs";
import path from "node:path";
import { compileDraft, type EdgeSides } from "../src/core/draft";
import { nuvarandeStatus, versionsBeteckningar, type FlowStatus } from "../src/core/status";
import { filterByPerspective } from "../src/tools/flowchart/perspective";
import { layoutModel, PAGE_FORMATS } from "../src/tools/flowchart/layout/layout";
import { döljDubblaHänvisningar } from "../src/tools/flowchart/layout/dubbla-hanvisningar";
import type { Perspective } from "../src/core/model";

const SKRIV = process.argv.includes("--skriv");
/** Uttryckligt statusval, eller null när ingen har bestämt. Se filhuvudet. */
const VALD_STATUS: FlowStatus | null = process.argv.includes("--status=fastslagen")
  ? "fastslagen"
  : process.argv.includes("--status=utkast")
    ? "utkast"
    : null;
const STATUS: FlowStatus = VALD_STATUS ?? "utkast";
const BARA = process.argv.find((a) => a.startsWith("--bara="))?.slice("--bara=".length);
const DIR = "flows";
const NÄR = new Date().toISOString();
const AV = "Claude Code";

let ändrade = 0;
/** Fastslagna som behöver rättas men inte fick röras – se filhuvudet. */
const hoppade: string[] = [];

for (const fil of fs.readdirSync(DIR).filter((f) => f.endsWith(".json") && !f.startsWith("ap-"))) {
  if (BARA && !fil.startsWith(BARA)) continue;
  const sökväg = path.join(DIR, fil);
  const flow = JSON.parse(fs.readFileSync(sökväg, "utf8"));
  const draft = flow.draft;

  let modell;
  try {
    modell = compileDraft(draft);
  } catch (e) {
    console.log(`⚠ ${fil}: går inte att kompilera, hoppas över (${e})`);
    continue;
  }

  // Samma vy och samma sidbrytning som exporten – det är där märkena syns.
  const v = flow.view ?? {};
  const vy = filterByPerspective(modell, (v.perspective as Perspective) ?? "system");
  const lay = layoutModel(vy, {
    pageWidth: PAGE_FORMATS.word.width,
    pageHeight: null,
    scale: v.scale ?? 1,
    shrinkToContent: true,
    spacing: v.spacing ?? 1,
  });

  const döljer = döljDubblaHänvisningar(modell, lay);
  // Bara det som inte redan är dolt – annars ser ett rättat flöde ändrat ut.
  const nya = Object.entries(döljer).filter(([nyckel, flaggor]) => {
    const nu = (draft.edgeStyles ?? {})[nyckel] as EdgeSides | undefined;
    return (
      (flaggor.hideRefIn && !nu?.hideRefIn) || (flaggor.hideRefOut && !nu?.hideRefOut)
    );
  });
  if (nya.length === 0) continue;

  const versioner = Array.isArray(flow.versions) ? flow.versions : [];
  const status = nuvarandeStatus(versioner);
  console.log(`\n${fil}`);
  for (const [nyckel, f] of nya) {
    console.log(`   ${nyckel}: döljer ${f.hideRefIn ? "in" : ""}${f.hideRefOut ? "ut" : ""}-märket`);
  }

  // Vakten kräver ett UTTRYCKLIGT val, inte ett visst svar – utelämnad flagga
  // betyder att ingen bestämt, och då lämnas det fastslagna flödet i fred.
  if (status === "fastslagen" && VALD_STATUS === null) {
    hoppade.push(fil.replace(".json", ""));
    console.log(
      "   → HOPPAS ÖVER: huvudversionen är fastslagen, kör med --status=utkast eller --status=fastslagen",
    );
    continue;
  }

  if (!SKRIV) continue;

  // Sprid draften – bygg den ALDRIG om fält för fält, då tappas allt vi inte
  // känner till (autoPositions, extraEdges, removedEdges …).
  const nyDraft = {
    ...draft,
    edgeStyles: { ...(draft.edgeStyles ?? {}), ...Object.fromEntries(nya.map(([k, f]) => [k, { ...(draft.edgeStyles ?? {})[k], ...f }])) },
  };

  // Rättningen läggs PÅ historiken, aldrig i den. Samma form som appens
  // sparning skriver (se saveFlowVersion i core/flow-store.ts).
  versioner.push({
    id: `v${versioner.length + 1}`,
    savedAt: NÄR,
    label: "Dubbel sidhänvisning dold",
    savedBy: AV,
    status: STATUS,
    rawText: flow.rawText,
    aiText: flow.aiText,
    draft: nyDraft,
  });
  flow.versions = versioner;
  flow.draft = nyDraft;
  flow.savedAt = NÄR;
  fs.writeFileSync(sökväg, JSON.stringify(flow, null, 2) + "\n", "utf8");
  ändrade++;
  const b = versionsBeteckningar(versioner);
  console.log(`   → skrivet som version ${b[b.length - 1]} (${STATUS})`);
}

console.log(
  `\n${ändrade} flöden ${SKRIV ? "rättade" : "skulle rättas (torrkörning)"}.` +
    (hoppade.length ? ` ${hoppade.length} fastslagna orörda: ${hoppade.join(", ")}` : ""),
);
