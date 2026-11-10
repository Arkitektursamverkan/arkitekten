/**
 * Exporterar EN ärendetyps fastslagna flödesscheman till SVG i Word-format,
 * sorterade i en mapp per kategori.
 *
 * Skillnaden mot `exportera-fastslagna.mts` är bara ordningen på filerna: här
 * blir det en övermapp för ärendetypen och en undermapp per målgrupp
 * (Översikt, Användaren, Handläggaren, Godkännaren …), så att den som ska
 * skriva ett kapitel om avvikelser hittar sina bilder utan att läsa filnamn.
 *
 * INDELNINGEN ÄR MENYNS – `byggFlödesträd` i core/flow-tree.ts är enda källan.
 * Att gissa kategorin ur filnamnet hade gett fel svar för "Åtgärdas" och
 * "Lås upp formulär", som inte nämner någon roll men utförs av godkännaren,
 * och en mapp i Utforskaren som inte stämmer med appens meny är värre än
 * ingen mapp alls.
 *
 * Innehållet är den FASTSLAGNA versionen (samma regel som exportera-fastslagna:
 * en huvudversion är det som gäller i ett styrdokument), och formatet tvingas
 * till Word oavsett vad flödet är sparat med.
 *
 *   npx tsx scripts/exportera-arendetyp.mts avvikelse
 */

import fs from "node:fs";
import path from "node:path";
import { compileDraft } from "../src/core/draft";
import { senasteFastslagna, versionsBeteckning } from "../src/core/status";
import { flowActor, type FlowSummary } from "../src/core/flow-store";
import { byggFlödesträd, ärendetyper } from "../src/core/flow-tree";
import { filterByPerspective } from "../src/tools/flowchart/perspective";
import { layoutModel, PAGE_FORMATS } from "../src/tools/flowchart/layout/layout";
import { renderSvgSized } from "../src/tools/flowchart/export/svg";
import { revisionAvVersion } from "../src/tools/flowchart/export/revision";
import type { ColorMode } from "../src/tools/flowchart/theme";
import type { Perspective } from "../src/core/model";

const FLÖDEN = "flows";
const UT = "Export";

const valdTyp = (process.argv[2] ?? "avvikelse").toLowerCase();
const typ = ärendetyper().find((t) => t.id === valdTyp);
if (!typ) {
  console.error(
    `Okänd ärendetyp "${valdTyp}". Välj en av: ${ärendetyper().map((t) => t.id).join(", ")}`,
  );
  process.exit(1);
}

/** Filnamnssäkert men LÄSBART – man ska känna igen flödet i Utforskaren. */
function filnamn(namn: string): string {
  return namn
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// Läs in ärendetypens flöden och bygg de sammanfattningar menyn grupperar på.
const flödenPerId = new Map<string, any>();
const summaries: FlowSummary[] = [];

for (const fil of fs.readdirSync(FLÖDEN).filter((f) => f.endsWith(".json") && !f.startsWith("ap-"))) {
  const flow = JSON.parse(fs.readFileSync(path.join(FLÖDEN, fil), "utf8"));
  const id: string = flow.id ?? fil.replace(/\.json$/, "");
  if (!typ.test(id)) continue;
  const versions = flow.versions ?? [];
  if (!senasteFastslagna(versions)) continue;
  flödenPerId.set(id, flow);
  summaries.push({
    id,
    name: flow.name,
    savedAt: flow.savedAt ?? "",
    stepCount: flow.draft?.steps?.length ?? 0,
    versionCount: versions.length,
    status: versions[versions.length - 1]?.status,
    beteckning: versionsBeteckning(versions, versions.length - 1),
    actor: flowActor(flow.draft),
  });
}

const grenar = byggFlödesträd(summaries);
const gren = grenar.find((g) => g.id === typ.id);
if (!gren) {
  console.error(`Inga fastslagna flöden för "${typ.titel}".`);
  process.exit(1);
}

const öVER = path.join(UT, filnamn(gren.titel));
// Skriv om mappen i sin helhet: en fil från ett flöde som döpts om, bytt
// kategori eller inte längre är fastslaget ska inte ligga kvar och se aktuell ut.
fs.rmSync(öVER, { recursive: true, force: true });
fs.mkdirSync(öVER, { recursive: true });

const rader: string[] = [];
let filer = 0;

for (const grupp of gren.målgrupper) {
  const mapp = path.join(öVER, filnamn(grupp.titel));
  fs.mkdirSync(mapp, { recursive: true });
  console.log(`\n${grupp.titel}`);

  for (const post of grupp.flöden) {
    const flow = flödenPerId.get(post.flow.id)!;
    const fast = senasteFastslagna(flow.versions ?? [])!;

    const v = flow.view ?? {};
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
    const { svg } = renderSvgSized(
      modell,
      lo,
      (v.colorMode as ColorMode) ?? "type",
      v.textScale ?? 1,
      revision,
    );
    fs.writeFileSync(path.join(mapp, `${filnamn(flow.name)}.svg`), svg);
    filer++;
    rader.push(
      `| ${grupp.titel} | ${post.kortnamn} | ${fast.beteckning} | ${(
        fast.version.savedAt ?? ""
      ).slice(0, 10)} | ${delar} |`,
    );
    console.log(`  ${post.kortnamn} → ${fast.beteckning} (${delar} ${delar === 1 ? "del" : "delar"})`);
  }
}

// En innehållsförteckning, så man ser vad mappen innehåller utan att öppna filerna.
fs.writeFileSync(
  path.join(öVER, "INNEHÅLL.md"),
  [
    `# ${gren.titel} – fastslagna systemprocesser`,
    "",
    "SVG i Word-format – EN fil per flöde, med alla delar i. Klistras in med Ctrl+V i Word.",
    "Varje bild bär en revisionsruta med version, datum och vem som justerade.",
    "",
    "Undermapparna är samma kategorier som flödesbibliotekets meny: översikten först,",
    "sedan en mapp per målgrupp – den bana där flödet startar, alltså den som utför processen.",
    "",
    `Mappen skrivs om i sin helhet av \`npx tsx scripts/exportera-arendetyp.mts ${typ.id}\`.`,
    "",
    "| Kategori | Flöde | Version | Fastslagen | Delar |",
    "| --- | --- | --- | --- | --- |",
    ...rader,
    "",
  ].join("\n"),
);

console.log(`\n${filer} SVG-filer i ${öVER}/`);
