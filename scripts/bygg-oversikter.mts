/**
 * ÖVERSIKTSBILDERNA "vem triggar vad" – en per ärendetyp, HÄRLEDDA ur biblioteket.
 *
 * En box per process, placerad i banan för den som kan starta den. Inga pilar,
 * inga event: kartan visar vad som FINNS, inte i vilken ordning det sker.
 * Formen är avläst ur en översikt som gjordes för hand.
 *
 * VARFÖR HÄRLEDD OCH INTE HANDSKRIVEN: en översikt som skrivs av är sann den
 * dag den skrivs. Nästa flöde som tillkommer syns i menyn men inte i kartan,
 * och då ljuger kartan utan att någon märker det. Här kommer allt ur flödena:
 *
 *  - ärendetypen ur `ärendetypFör` – SAMMA indelning som menyn använder,
 *  - banan ur `flowActor` – startpunktens bana, alltså den som utför,
 *  - boxens text ur `kortnamn` – samma text som menyraden,
 *  - villkoret ur flödets VAKT: det beslut vars Nej-gren leder till ett
 *    "<åtgärden> går inte att välja". Det är husstilens signatur och sitter i
 *    hela biblioteket, även i de äldsta flödena.
 *
 * Bilderna skrivs som UTKAST. Fastslåendet är processägarens beslut.
 *
 *   npx tsx scripts/bygg-oversikter.mts            – bygger de som saknas
 *   npx tsx scripts/bygg-oversikter.mts --alla     – bygger om ALLA (utom
 *                                                    de fastslagna)
 *   npx tsx scripts/bygg-oversikter.mts --ordning <fil> – läsordningen per
 *                                                    ärendetyp (se nedan)
 */

import fs from "node:fs";
import path from "node:path";
import {
  compileDraft,
  edgeKey,
  laneDefaultPerspectives,
  type DraftStep,
  type ProcessDraft,
} from "@/core/draft";
import { flowActor } from "@/core/flow-store";
import { kortnamn, ärendetyper, ärendetypFör } from "@/core/flow-tree";
import { senasteFastslagna, normaliseraStatus } from "@/core/status";
import { validateModel } from "@/tools/flowchart/parser/validate";
import { filterByPerspective } from "@/tools/flowchart/perspective";
import { layoutModel, PAGE_FORMATS } from "@/tools/flowchart/layout/layout";

const KATALOG = "flows";
const NU = "2026-07-31T10:00:00.000Z";
const SKALA = 0.6;
const AV = "Claude Code";
/** Boxar per rad. Fler får inte plats på en Word-figurs bredd. */
const KOLUMNER = 4;

/**
 * Processernas ordning INOM en bana, per ärendetyp – den beslutade läsordningen.
 *
 * Bokstavsordning är default (kartan ska gå att läsa som en innehålls-
 * förteckning), men den säger ingenting om hur processerna hänger ihop.
 * Där en ordning är bestämd står den här, uttryckt i FLÖDES-ID så att den
 * inte glider när en boxtext skrivs om. Ett flöde som saknas i listan hamnar
 * sist i sin bana, i bokstavsordning – nytillkomna flöden syns alltså direkt
 * i stället för att tyst hamna på en godtycklig plats.
 */
const PROCESSORDNING = läsProcessordning();

/**
 * Ordningen är INSTALLATIONENS – den nämner dess flöden och hör inte hemma i
 * koden. Den läses ur en JSON-fil ({ "<ärendetyp>": ["<flödes-id>", …] }):
 * `--ordning <fil>`, annars `.lokalt/processordning.json` om den finns.
 * Saknas filen gäller bokstavsordning överallt.
 */
function läsProcessordning(): Record<string, string[]> {
  const i = process.argv.indexOf("--ordning");
  const fil = i >= 0 ? process.argv[i + 1] : path.join(".lokalt", "processordning.json");
  if (!fil || !fs.existsSync(fil)) {
    if (i >= 0) throw new Error(`Hittar inte ordningsfilen ${fil ?? "(ingen angiven)"}`);
    return {};
  }
  return JSON.parse(fs.readFileSync(fil, "utf8")) as Record<string, string[]>;
}

/** Banorna i översiktens ordning. Andra banor läggs sist, i bokstavsordning. */
const BANORDNING = [
  "Användare",
  "Godkännare",
  "Handläggare",
  "Handläggare/Godkännare",
  "Power Automate",
];

interface Fil {
  id: string;
  name: string;
  draft: ProcessDraft;
  versions?: unknown[];
}

interface Process {
  id: string;
  text: string;
  bana: string;
  villkor: string;
  /** Flödets id – för spårbarhet och för att kunna se vad som utelämnats. */
  flöde: string;
}

// ---------------------------------------------------------------------------
// Läsning ur biblioteket
// ---------------------------------------------------------------------------

function läsFlöden(): Fil[] {
  return fs
    .readdirSync(KATALOG)
    .filter((f) => f.endsWith(".json") && !f.startsWith("ap-"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(KATALOG, f), "utf8")) as Fil)
    .filter((f) => !f.id.includes("oversikt"));
}

/**
 * Flödets VAKT: beslutet vars Nej-gren leder till "… går inte att välja".
 * Saknas ett sådant steg har flödet inget statusvillkor.
 */
function vaktFör(draft: ProcessDraft): DraftStep | undefined {
  const spärr = draft.steps.find((s) => /går inte att (välja|starta|göra)/i.test(s.text));
  if (!spärr?.branchOf) return undefined;
  return draft.steps.find((s) => s.id === spärr.branchOf!.stepId);
}

/** Underlagets villkor omskrivet till en mening som står bra som not. */
function villkorstext(vakt: DraftStep | undefined, draft: ProcessDraft, bana: string): string {
  if (!vakt) {
    if (bana === "Power Automate" || bana === "Integrationer") {
      // Triggern ÄR villkoret för ett flöde ingen människa startar – och den
      // står redan i start-eventet. "Schemalagt" rakt av var dessutom fel för
      // de flöden som triggas av en ny post i en lista, inte av en klocka.
      const trigger = draft.steps.find((s) => s.type === "start")?.text?.trim();
      return trigger ? `Startas automatiskt: ${trigger.toLowerCase()}.` : "Ingen människa startar den.";
    }
    // Väljer flödet ett BEFINTLIGT ärende krävs det ett; annars inte.
    const påBefintligt = draft.steps.some((s) => /befintlig/i.test(s.text));
    return påBefintligt
      ? "Inget statusvillkor i underlaget."
      : "Inget befintligt ärende krävs.";
  }
  let t = (vakt.sourceText ?? vakt.text).trim();
  t = t.replace(/^om\s+/i, "").replace(/\?$/, "");
  t = t.replace(/status på ärendet/gi, "status");
  // "och om handläggaren …" läser illa efter "Kräver att …".
  t = t.replace(/\soch om\s/gi, " och att ");
  const versal = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  let m = /^status\s+inte\s+(?:är\s+)?(.+)$/i.exec(t);
  if (m) return `Kräver att status inte är ${versal(m[1])}.`;
  m = /^status\s*(?:är|=)?\s*(.+)$/i.exec(t);
  if (m) return `Kräver status ${versal(m[1])}.`;
  return `Kräver ${t}.`;
}

/** Processerna i en ärendetyp, i den ordning de ska stå i kartan. */
function processerFör(typId: string, flöden: Fil[]): Process[] {
  const typ = ärendetyper().find((t) => t.id === typId)!;
  const hör = (f: Fil) =>
    ärendetypFör(f.id).id === typId ||
    // De DELADE flödena ("<typ> och <annan typ> – ny kommentar") hamnar i
    // Gemensamt i menyn, men de finns på riktigt i båda ärendetyperna och ska
    // därför synas i båda kartorna.
    f.name.toLowerCase().startsWith(`${typ.titel.toLowerCase()} och `) ||
    f.name.toLowerCase().includes(` och ${typ.titel.toLowerCase()} `);

  return flöden
    .filter(hör)
    .map((f) => {
      const bana = flowActor(f.draft) ?? "Övrigt";
      const vakt = vaktFör(f.draft);
      const delat = ärendetypFör(f.id).id !== typId;
      const villkor = villkorstext(vakt, f.draft, bana);
      return {
        id: `p_${f.id.replace(/-/g, "_")}`,
        text: kortnamn(f.name, typ.titel),
        bana,
        villkor: delat ? `${villkor} Delas med de andra ärendetyperna.` : villkor,
      flöde: f.id,
      };
    })
    // Den bestämda ordningen där en sådan finns, annars samma ordning som menyn:
    // kartan ska gå att läsa som en innehållsförteckning, och man ska hitta
    // samma sak på samma plats.
    .sort((a, b) => {
      const vald = PROCESSORDNING[typId] ?? [];
      const ia = vald.indexOf(a.flöde);
      const ib = vald.indexOf(b.flöde);
      // Olistade sorteras sist – men mot varandra på texten, inte på ett
      // gemensamt jokervärde (då hade de hamnat i inläsningsordning).
      if (ia !== -1 || ib !== -1) return (ia === -1 ? vald.length : ia) - (ib === -1 ? vald.length : ib);
      return a.text.localeCompare(b.text, "sv");
    });
}

// ---------------------------------------------------------------------------
// Radbrytning
// ---------------------------------------------------------------------------

/**
 * Ordnar boxarna så att varje bana får högst KOLUMNER per rad.
 *
 * Mekaniken bakom raderna sitter i `computeRanks`: en HELT lös nod ärver
 * kolumnen efter föregående nod bara om de ligger i SAMMA bana – vid ett
 * banbyte börjar räkningen om. Rad två skapas alltså genom att gå varvet runt
 * banorna en gång till.
 *
 * Fällan: slutar ett varv på samma bana som nästa varv börjar med, sker inget
 * banbyte och raden fortsätter i stället för att brytas. Därför roteras
 * banordningen i varvet före så att den banan hamnar först i stället.
 */
function ordnaIRader(processer: Process[]): Process[] {
  const banor = [...new Set(processer.map((p) => p.bana))].sort((a, b) => {
    const ia = BANORDNING.indexOf(a);
    const ib = BANORDNING.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, "sv");
  });

  // varv[r][bana] = banans r:te grupp om högst KOLUMNER boxar.
  const varv: Array<Array<{ bana: string; poster: Process[] }>> = [];
  for (const bana of banor) {
    const iBanan = processer.filter((p) => p.bana === bana);
    for (let r = 0; r * KOLUMNER < iBanan.length; r++) {
      (varv[r] ??= []).push({ bana, poster: iBanan.slice(r * KOLUMNER, (r + 1) * KOLUMNER) });
    }
  }
  for (const rad of varv) {
    rad.sort((a, b) => banor.indexOf(a.bana) - banor.indexOf(b.bana));
  }
  // Rotera bort krocken över varvgränsen.
  for (let r = 0; r + 1 < varv.length; r++) {
    const sist = varv[r][varv[r].length - 1];
    const först = varv[r + 1][0];
    if (sist.bana !== först.bana || varv[r].length < 2) continue;
    varv[r].unshift(varv[r].pop()!);
  }
  return varv.flat().flatMap((g) => g.poster);
}

// ---------------------------------------------------------------------------
// Draften
// ---------------------------------------------------------------------------

function byggDraft(titel: string, processer: Process[]): ProcessDraft {
  const ordnade = ordnaIRader(processer);
  const banor = [...new Set(ordnade.map((p) => p.bana))].sort((a, b) => {
    const ia = BANORDNING.indexOf(a);
    const ib = BANORDNING.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, "sv");
  });

  const steps: DraftStep[] = ordnade.map((p, i) => ({
    id: p.id,
    type: "activity",
    text: p.text,
    laneId: p.bana,
    sourceIndex: i,
    sourceText: `${p.text} (${p.bana})`,
    note: p.villkor,
    ...(p.text.length > 22 ? { textSize: 0.85 } : {}),
  }));
  steps.push({
    id: "slut",
    type: "end",
    text: "Klart",
    laneId: banor[banor.length - 1],
    sourceIndex: steps.length,
    // Notationen kräver ett slut. Kartan har inget – därför utanför systemvyn.
    perspectives: ["business"],
    note: "Notationen kräver ett slut-event. Kartan har inget – därför ligger det utanför systemvyn.",
  });

  return {
    title: titel,
    subtitle: "En box per process, i banan för den som kan starta den",
    lanes: banor.map((id, order) => ({
      id,
      title: id,
      order,
      perspectives: laneDefaultPerspectives(id),
    })),
    steps,
    // Inga pilar: varje kedjekoppling kompileringen skulle göra tas bort.
    removedEdges: steps.slice(0, -1).map((s, i) => edgeKey(s.id, steps[i + 1].id)),
    meta: {
      sourceText: "",
      aiText: "",
      origin: "manual",
      sourceFragments: ordnade.map((p) => `${p.text} (${p.bana})`),
      warnings: [],
    },
  };
}

function rawTextFör(titel: string, processer: Process[], banor: string[]): string {
  const rader = banor.map(
    (b) =>
      `${b}:\n${processer
        .filter((p) => p.bana === b)
        .map((p) => `  - ${p.text} – ${p.villkor}`)
        .join("\n")}`,
  );
  return [
    `${titel}`,
    "",
    "En box per process, placerad i banan för den som kan starta den.",
    "Statusvillkoret ligger som not på varje box.",
    "",
    ...rader,
    "",
    "Kartan är HÄRLEDD ur flödesbiblioteket (scripts/bygg-oversikter.mts):",
    "processerna, banorna och villkoren kommer ur flödena själva. Tillkommer",
    "ett flöde räcker det att köra om skriptet.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Kör
// ---------------------------------------------------------------------------

const alla = process.argv.includes("--alla");
const flöden = läsFlöden();
const optioner = {
  pageWidth: PAGE_FORMATS.word.width,
  pageHeight: null,
  scale: SKALA,
  shrinkToContent: true,
  spacing: 1,
};

let skrivna = 0;
for (const typ of ärendetyper()) {
  // "Gemensamt" är ingen ärendetyp – det är en hög med det som gäller flera.
  if (typ.id === "gemensamt") continue;

  const fil = path.join(KATALOG, `${typ.id}-oversikt.json`);
  const fanns = fs.existsSync(fil);
  const målfil = fil;
  if (fs.existsSync(målfil)) {
    /**
     * EN FASTSLAGEN BILD ÄR PROCESSÄGARENS BESLUT och rörs aldrig, inte ens med
     * --alla. Skriptet skrev en gång över en handgjord, fastslagen
     * karta: historiken överlevde, men flödet stod plötsligt på ett utkast
     * som ingen bett om. Fastslagenheten är spärren, inte flaggan.
     */
    const nuvarande = JSON.parse(fs.readFileSync(målfil, "utf8")) as {
      versions?: Array<{ status?: string }>;
    };
    const sista = nuvarande.versions?.[nuvarande.versions.length - 1];
    if (senasteFastslagna(nuvarande.versions ?? []) && normaliseraStatus(sista?.status) === "fastslagen") {
      console.log(`FREDAD ${typ.titel} – översikten är fastslagen, rörs inte`);
      continue;
    }
    if (!alla) {
      console.log(`hoppar över ${typ.titel} – har redan en översikt (${målfil})`);
      continue;
    }
  }

  const processer = processerFör(typ.id, flöden);
  if (processer.length === 0) {
    console.log(`hoppar över ${typ.titel} – inga flöden`);
    continue;
  }

  const titel = `${typ.titel} – vem triggar vad`;
  const draft = byggDraft(titel, processer);
  const banor = draft.lanes.map((l) => l.id);
  const rawText = rawTextFör(titel, processer, banor);
  draft.meta.sourceText = rawText;
  draft.meta.aiText = banor
    .map((b) => `${b}: ${processer.filter((p) => p.bana === b).map((p) => p.text).join(" · ")}`)
    .join("\n");
  const aiText = `${titel}\n${draft.meta.aiText}`;

  const modell = compileDraft(draft);
  const kontroll = validateModel(modell);
  const vy = filterByPerspective(modell, "system");
  const lay = layoutModel(vy, optioner);
  // Bevis att radbrytningen höll: ingen box får hamna bortom kolumn KOLUMNER.
  const kolumner = new Set(lay.nodes.map((n) => Math.round(n.x))).size;

  const befintlig = fs.existsSync(målfil)
    ? (JSON.parse(fs.readFileSync(målfil, "utf8")) as { versions?: unknown[] })
    : null;
  const versions = [...(befintlig?.versions ?? [])];
  versions.push({
    id: `v${versions.length + 1}`,
    savedAt: NU,
    label: "Härledd ur flödesbiblioteket",
    savedBy: AV,
    status: "utkast",
    rawText,
    aiText,
    draft,
  });

  fs.writeFileSync(
    målfil,
    JSON.stringify(
      {
        id: path.basename(målfil, ".json"),
        name: `${typ.titel} - översikt, vem triggar vad`,
        savedAt: NU,
        rawText,
        aiText,
        draft,
        view: {
          perspective: "system",
          pageFormat: "word",
          scale: SKALA,
          colorMode: "type",
          spacing: 1,
          textScale: 1,
        },
        versions,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  skrivna++;
  console.log(
    `${kontroll.ok ? "OK " : "FEL"} ${typ.titel.padEnd(24)} ${String(processer.length).padStart(2)} processer · ` +
      `${banor.length} banor · ${kolumner} kolumn(er) · ${lay.pages.length} del(ar) → ${målfil}`,
  );
  for (const b of banor) {
    const i = processer.filter((p) => p.bana === b).length;
    console.log(`      ${b}: ${i}`);
  }
}

console.log(`\n${skrivna} översikt(er) skrivna.`);
