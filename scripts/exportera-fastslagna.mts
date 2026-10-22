/**
 * Exporterar varje flödesschema som har en FASTSLAGEN version till SVG i
 * Word-format – EN fil per flöde, med alla delar i.
 *
 * Vad som exporteras är den fastslagna versionens INNEHÅLL, inte det som råkar
 * ligga i editorn: en huvudversion är det som gäller, och det är den man vill ha
 * i ett styrdokument. Står flödet på ett senare utkast exporteras alltså ändå
 * huvudversionen, och revisionsrutan i bilden säger vilken.
 *
 * Formatet tvingas till Word oavsett vad flödet är sparat med – figurbredden är
 * det som avgör om texten går att läsa när Word skalat ned bilden till
 * spaltbredden. Övriga vyval (skala, täthet, färgläge, perspektiv) är flödets
 * egna, så filen ser ut som skärmen.
 *
 *   npx tsx scripts/exportera-fastslagna.mts
 */

import fs from "node:fs";
import path from "node:path";
import { compileDraft } from "../src/core/draft";
import { senasteFastslagna } from "../src/core/status";
import { filterByPerspective } from "../src/tools/flowchart/perspective";
import { layoutModel, PAGE_FORMATS } from "../src/tools/flowchart/layout/layout";
import { renderSvgSized } from "../src/tools/flowchart/export/svg";
import { revisionAvVersion } from "../src/tools/flowchart/export/revision";
import type { ColorMode } from "../src/tools/flowchart/theme";
import type { Perspective } from "../src/core/model";

const FLÖDEN = "flows";
const UT = path.join("Export", "fastslagna");

/** Filnamnssäkert men LÄSBART – man ska känna igen flödet i Utforskaren. */
function filnamn(namn: string): string {
  return namn
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

fs.mkdirSync(UT, { recursive: true });
// Töm mappen först: en gammal fil från ett flöde som döpts om eller inte längre
// är fastslaget ska inte ligga kvar och se aktuell ut.
for (const f of fs.readdirSync(UT)) fs.unlinkSync(path.join(UT, f));

const rader: string[] = [];
let filer = 0;

for (const fil of fs.readdirSync(FLÖDEN).filter((f) => f.endsWith(".json") && !f.startsWith("ap-"))) {
  const flow = JSON.parse(fs.readFileSync(path.join(FLÖDEN, fil), "utf8"));
  const fast = senasteFastslagna(flow.versions ?? []);
  if (!fast) continue;

  const v = flow.view ?? {};
  // Den FASTSLAGNA versionens innehåll – inte flödets nuvarande.
  const modell = filterByPerspective(
    compileDraft(fast.version.draft),
    (v.perspective as Perspective) ?? "system",
  );
  const fmt = PAGE_FORMATS.word;
  const lo = layoutModel(modell, {
    pageWidth: fmt.width,
    pageHeight: fmt.width && fmt.aspect ? fmt.width * fmt.aspect : null,
    scale: v.scale ?? 1,
    shrinkToContent: fmt.aspect === null,
    spacing: v.spacing ?? 1,
  });
  // Bilden ÄR den fastslagna versionen – aldrig "ändrad sedan dess".
  const revision = revisionAvVersion(flow, fast.index, false);

  const delar = lo.pages.length;
  // HELA flödet i EN fil. Delarna ligger kvar som delar inuti bilden – de hör
  // till Word-formatet och bär sina "till del N"-hänvisningar – men flödet är
  // en sak och blir en fil.
  const { svg } = renderSvgSized(
    modell,
    lo,
    (v.colorMode as ColorMode) ?? "type",
    v.textScale ?? 1,
    revision,
  );
  fs.writeFileSync(path.join(UT, `${filnamn(flow.name)}.svg`), svg);
  filer++;
  rader.push(
    `| ${flow.name} | ${fast.beteckning} | ${(fast.version.savedAt ?? "").slice(0, 10)} | ${
      fast.version.savedBy ?? "–"
    } | ${delar} |`,
  );
  console.log(`${flow.name} → ${fast.beteckning} (${delar} ${delar === 1 ? "del" : "delar"})`);
}

// En innehållsförteckning, så man ser vad mappen innehåller utan att öppna filerna.
fs.writeFileSync(
  path.join(UT, "INNEHÅLL.md"),
  [
    "# Fastslagna systemprocesser",
    "",
    "SVG i Word-format – EN fil per flöde, med alla delar i. Klistras in med Ctrl+V i Word.",
    "Varje bild bär en revisionsruta med version, datum och vem som justerade.",
    "",
    "Mappen skrivs om i sin helhet av `npx tsx scripts/exportera-fastslagna.mts`.",
    "",
    "| Flöde | Version | Fastslagen | Av | Delar |",
    "| --- | --- | --- | --- | --- |",
    ...rader.sort(),
    "",
  ].join("\n"),
);

console.log(`\n${rader.length} flöden, ${filer} SVG-filer i ${UT}/`);
