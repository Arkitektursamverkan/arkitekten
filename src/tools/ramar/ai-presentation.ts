/**
 * AI-PRESENTATIONEN: ur en tolkad process görs en FÖRENKLAD process och en
 * RAMSERIE som berättar den – i ett uppdrag genom ark-bryggan.
 *
 * Samma arbetsdelning som tolkningen (se server/brygga.ts): appen lägger
 * en begäran i brevlådan, Claude Code svarar, och svaret är DATA. Ingenting
 * ritas av den som svarar:
 *
 *  - `förenklad` är en vanlig affärsprocesstolkning och går genom SAMMA väg som
 *    "Tolka med AI" (`svarTillDraft` → `compileAp`). Utlägget räknas av den
 *    avskalade stilen (avskalad.ts), aldrig av svaret.
 *  - `presentation` är ramar och en scen i lagringens egen form. Här får de
 *    sina id:n (skapas en gång och lagras – invariant 2) och varje mål
 *    kontrolleras mot bilden som faktiskt ritas: en markering som pekar på
 *    något som inte finns tas bort och REDOVISAS, den hamnar aldrig på fel
 *    objekt.
 *
 * Det som sparas är två vanliga poster: en affärsprocess i kategorin
 * Presentation och en ramserie i avskalad stil. Båda går att öppna och ändra
 * för hand efteråt, precis som om man gjort dem själv.
 *
 * INGENTING SKRIVS ÖVER. Varje körning ger en NY process och en NY ramserie
 * (…-presentation, …-presentation-2, …) – den förra kan vara ändrad för hand,
 * och den ska finnas kvar som den är (beslut 2026-10-01).
 */

import { compileAp, type ApModel } from "@/core/affarsprocess";
import { addManualEdge, removeEdge, type ProcessDraft } from "@/core/draft";
import {
  AP_FLOW_PREFIX,
  meddelaFlödenÄndrade,
  saveFlowVersion,
  type FlowStore,
  type SavedFlow,
} from "@/core/flow-store";
import {
  RAM_FÄRGER,
  RAM_VERKTYG,
  nyttRamId,
  serieId,
  type Markering,
  type Ram,
  type RamVerktyg,
  type Ramserie,
} from "@/core/ram";
import {
  FIGURTYPER,
  SCEN_BREDD,
  STAD_HÖJD,
  TEXTRUTA_BREDD,
  TEXTRUTA_MIN_BREDD,
  standardScen,
  type FigurTyp,
  type RamScen,
  type Scen,
  type ScenFigur,
} from "@/core/ram-scen";
import { meddelaRamarÄndrade, type RamStore } from "@/core/ram-store";
import { requestClaudeCodeUppdrag, svarTillDraft } from "@/tools/flowchart/ai/bridge";
import { bridgeInstruction } from "@/tools/flowchart/ai/prompt";
import type { AiDraftResponse } from "@/tools/flowchart/ai/schema";
import { PRESENTATIONSKATEGORI, avskalaAp, type AvskaladBild } from "./avskalad";

/** Uppdragets namn i `.ark/request.json`. */
export const PRESENTATION_UPPDRAG = "presentation";

/** En presentation tar längre tid att göra än en tolkning. */
const VÄNTETID_MS = 60 * 60 * 1000;

/** Bryggans id-regel (SAFE_ID i server/brygga.ts). */
const MAX_ID = 64;
const ID_SLUT = "-presentation";

/* ------------------------------------------------------------------ */
/* Begäran                                                             */
/* ------------------------------------------------------------------ */

/** Processen uppdraget gäller. */
export interface PresentationsKälla {
  /** Det sparade flödets id. */
  flödeId: string;
  namn: string;
  /** Beskrivningen processen kom ur (AI-beskrivningen, annars råtexten). */
  beskrivning: string;
  /** Det som faktiskt är ritat – se `apUnderlag`. */
  struktur: unknown;
}

/**
 * Den förenklade processens id – HÄRLETT ur källans (invariant 2), och LEDIGT:
 * finns det redan en presentation av processen får den nya en löpande ändelse.
 * Alltid en affärsprocess: den avskalade stilen finns bara där.
 */
export function presentationsFlödeId(källId: string, upptagna: Iterable<string> = []): string {
  const stam = källId.startsWith(AP_FLOW_PREFIX) ? källId.slice(AP_FLOW_PREFIX.length) : källId;
  const tagna = new Set(upptagna);
  for (let n = 1; ; n++) {
    const slut = n === 1 ? ID_SLUT : `${ID_SLUT}-${n}`;
    const plats = MAX_ID - AP_FLOW_PREFIX.length - slut.length;
    const id = AP_FLOW_PREFIX + (stam.slice(0, plats).replace(/-+$/, "") || "process") + slut;
    if (!tagna.has(id)) return id;
  }
}

/**
 * Underlaget för en affärsprocess: objekten och kopplingarna som de är RITADE.
 * Beskrivningen räcker inte – den som dragit om något på ytan efter tolkningen
 * har en process som texten inte längre beskriver.
 */
export function apUnderlag(m: ApModel) {
  return {
    titel: m.title,
    objekt: m.nodes.map((n) => ({
      id: n.id,
      sort: n.kind,
      namn: n.label,
      ...(n.beskrivning ? { beskrivning: n.beskrivning } : {}),
      ...(n.anchorId ? { hörTill: n.anchorId } : {}),
    })),
    kopplingar: m.relations.map((r) => ({
      från: r.source,
      till: r.target,
      sort: r.kind,
      ...(r.label ? { etikett: r.label } : {}),
      ...(r.huki ? { huki: r.huki } : {}),
    })),
  };
}

const FIGURNAMN: Record<FigurTyp, string> = {
  hyresgast: "en kund (boende, beställare – den processen är till för)",
  person: "en person i allmänhet (sökande, kund, medarbetare)",
  hantverkare: "en hantverkare",
  handlaggare: "en handläggare/tjänsteman",
  huvudkontor: "kontoret/organisationen (stor byggnad)",
  bostadshus: "ett bostadshus (stor byggnad)",
  dator: "en dator",
  mobil: "en mobil (app, Mina sidor)",
  system: "ett IT-system",
  moln: "en molntjänst/extern tjänst",
  dokument: "ett dokument (avtal, faktura, underlag)",
  mejl: "ett mejl/meddelande",
  nyckel: "nycklar",
  varning: "en varning/avvikelse",
  klar: "en klarmarkering",
  klocka: "en tidsfrist",
  servicebil: "en servicebil",
};

/**
 * Instruktionen som följer med begäran. Bryggan har ingen systemprompt –
 * `.ark/request.json` är allt den som svarar ser – så både uppdraget, svarets
 * form och affärsprocessens regler för den förenklade processen står här.
 */
export function presentationsInstruktion(): string {
  return `UPPDRAG: "${PRESENTATION_UPPDRAG}" – förenkla processen och gör en presentation av den.

Det här är INTE en vanlig tolkning. \`rawText\` är ett JSON-underlag: processens
beskrivning och de objekt och kopplingar som är ritade i Arkitekten. Leverera
TVÅ saker i samma svar:

{
  "requestId": "<id ur begäran>",
  "förenklad": { … },       // den förenklade processen
  "presentation": { … }     // ramarna som berättar den
}

── 1. "förenklad" ─────────────────────────────────────────────────────────────
Samma berättelse som originalet, gjord för att VISAS på en skärm i ett rum:

- 5–9 aktiviteter på huvudspåret och högst 2 regler. Slå ihop steg som alltid
  sker tillsammans, stryk det som bara betyder något för den som modellerar.
- Varje aktivitet har EN utförande roll: \`[Roll: X U]\`. Rollen blir ZONEN
  steget ritas i – håll antalet roller nere (2–4) och låt samma roll heta
  likadant överallt. IT-stödet (\`[IT: …]\`) blir rutans undertext.
- Korta namn: verb + substantiv, högst tre–fyra ord. Regler är frågor.
- Första steget får \`[In: …]\` (det som startar processen) och sista steget
  \`[Ut: …]\` (resultatet). Mellanliggande verksamhetsobjekt ritas inte i den
  avskalade bilden – sätt dem bara där de bär berättelsen.
- Formen är en vanlig affärsprocesstolkning, precis som svaret på "Tolka med AI":
  helst fullt strukturerad (\`aiText\`, \`title\`, \`subtitle\`, \`lanes\`, \`steps\`)
  med EGNA, talande steg-id:n (\`publicera\`, \`visa\`, \`godkand\`) – de blir
  målen ramarna pekar på – annars bara \`{ "aiText": "…" }\`.
- Grenar återförenas automatiskt med nästa steg på huvudspåret. Ska en gren i
  stället gå TILLBAKA (en slinga) eller ta slut, lägg till
    "kopplingar": { "taBort":   [ { "från": "nasta", "till": "kredit" } ],
                    "läggTill": [ { "från": "nasta", "till": "visa" } ] }
  i "förenklad". Det är samma handgrepp som att ta bort och dra en pil på ytan.

── 2. "presentation" ──────────────────────────────────────────────────────────
{
  "namn": "…",                       // seriens namn (valfritt)
  "scen": { "bakgrund": { "typ": "stad" }, "figurer": [ … ] },
  "ramar": [ … ]
}

En RAM per moment i berättelsen: en startram (vad som utlöser processen), en
ram per steg och beslut, grenarna var för sig, och en slutram. Räkna med
ungefär lika många ramar som den förenklade processen har rutor, plus två.

  { "rubrik": "Steg 1 · Ärendet registreras",
    "text": "Två–tre meningar som talaren kan säga till bilden.",
    "markeringar": [                 // FLÖDET: vad som lyfts fram i processen
      { "mål": { "typ": "nod",  "id": "<objektets id>" },       "verktyg": "puls", "färg": "#f59f00" },
      { "mål": { "typ": "kant", "id": "<kopplingens nyckel>" }, "verktyg": "puls", "färg": "#f59f00" } ],
    "scen": {                        // BILDEN: vad som händer i scenen
      "markeringar": [ { "figur": "<figur-id>", "verktyg": "blink", "färg": "#e8590c" } ],
      "pulser":      [ { "från": "<figur-id>", "till": "<figur-id>", "färg": "#f59f00", "text": "Ärende" } ],
      "bubblor":     [ { "figur": "<figur-id>", "text": "Välkommen in!" } ],
      "dolda":       [ "<figur-id>", … ],          // figurer som INTE syns i ramen
      "textrutor":   [ { "x": 40, "y": 40, "bredd": 520, "rubrik": "KUNDCENTER · Steg 1", "text": "…" } ],
      "pulspunkter": [ { "x": 383, "y": 524, "färg": "#e8590c" } ],
      "figurLägen":  { "<figur-id>": { "x": 450, "y": 652 } }   // egen plats i just den här ramen
    } }

Verktygen är ${RAM_VERKTYG.map((v) => `"${v.id}" (${v.namn.toLowerCase()})`).join(", ")}.
Husets färger: ${RAM_FÄRGER.join(", ")}. Håll en färg för huvudspåret,
en för avslag/nej och en för klart – färgen ska betyda samma sak i varje ram.

MÅLEN är objekten och kopplingarna i den AVSKALADE bilden av den förenklade
processen – inte alla objekt i affärsprocessmodellen. Kör kontrollskriptet (nedan): det
skriver ut exakt vilka id:n och nycklar som finns. En koppling nycklas
"källa->mål" och med regelns svar "källa->mål#Ja".

SCENEN är ${SCEN_BREDD} × ${STAD_HÖJD}. Med bakgrunden "stad" står människor på marken
kring y ≈ 650, byggnader kring y ≈ 550, och himlen (moln, externa tjänster) är
fri kring y ≈ 230. "tom" ger en tom yta. En figur är
{ "id", "typ", "namn", "x", "y", "skala"? } där x/y är figurens MITT. Typerna:
${FIGURTYPER.map((t) => `  ${t} – ${FIGURNAMN[t]}`).join("\n")}
Välj figurer efter processens aktörer och system (en per roll, en per viktigt
IT-stöd), ge dem egna id:n, och låt scenen växa: dölj en figur med "dolda"
tills ramen där den kommer in i berättelsen. Figurerna står på samma plats
genom hela serien – annars hoppar bilden mellan ramarna.

Förlaga: en befintlig ramserie i ramar/, om installationen har någon – läs
den för form och ton.

── Arbetsgång ─────────────────────────────────────────────────────────────────
1. Skriv "förenklad" till .ark/utkast.json och kör
     npx tsx scripts/presentation.mts
   – den kompilerar processen och listar bildens objekt-id:n och kopplingsnycklar.
2. Lägg till "presentation" i utkastet och kör skriptet igen tills det inte har
   några anmärkningar. \`--png <fil>\` ritar den avskalade bilden.
3. \`npx tsx scripts/presentation.mts --skicka\` lägger svaret i brevlådan med
   rätt requestId. Appen sparar då processen och ramserien.

── Affärsprocessens regler för "förenklad" ─────────────────────────────────────
${bridgeInstruction("affarsprocess")}`;
}

/* ------------------------------------------------------------------ */
/* Svaret                                                              */
/* ------------------------------------------------------------------ */

export interface FörenkladProcess {
  namn: string;
  /** Pilformatet – flödets råtext. */
  rawText: string;
  draft: ProcessDraft;
  modell: ApModel;
  /** Den avskalade bilden: det som faktiskt ritas, och därmed vad ramarna kan peka på. */
  bild: AvskaladBild;
  /** Kopplingsändringar ur svaret som inte gick att göra. */
  anmärkningar: string[];
}

export interface ByggdPresentation {
  flödeId: string;
  källNamn: string;
  process: FörenkladProcess;
  serie: Ramserie;
  /** Det som rättades eller ströks ur svaret, och det som ser ofullständigt ut. */
  anmärkningar: string[];
}

const ärObjekt = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const tal = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const FÄRG = /^#[0-9a-f]{6}$/i;
const färgEller = (v: unknown, reserv: string): string => (typeof v === "string" && FÄRG.test(v) ? v : reserv);
const VERKTYG = new Set<string>(RAM_VERKTYG.map((v) => v.id));
const verktygEller = (v: unknown): RamVerktyg => (VERKTYG.has(v as string) ? (v as RamVerktyg) : "puls");

/** Svaret kan komma inbäddat i `aiText` (bryggans råväg) – plocka fram objektet. */
function somObjekt(svar: unknown): Record<string, unknown> {
  if (typeof svar === "string") {
    try {
      return somObjekt(JSON.parse(svar));
    } catch {
      throw new Error("Svaret var inte giltig JSON.");
    }
  }
  if (!ärObjekt(svar)) throw new Error("Svaret var inte ett objekt.");
  return svar;
}

/**
 * Den förenklade processen ur svaret – samma väg som en vanlig tolkning, och
 * märkt som affärsprocess. Kastar om svaret inte bär någon process.
 */
export function byggFörenklad(svar: unknown, källa: Pick<PresentationsKälla, "namn" | "beskrivning">): FörenkladProcess {
  const o = somObjekt(svar);
  const f = o["förenklad"] ?? o["forenklad"];
  if (!ärObjekt(f) || !text(f.aiText)) {
    throw new Error('Svaret saknar "förenklad" med en beskrivning i `aiText`.');
  }
  const tolkad = svarTillDraft(f as unknown as AiDraftResponse | { aiText: string }, källa.beskrivning);
  if (!tolkad.steps.length) throw new Error("Den förenklade processen har inga steg.");

  // Slingor och grenar som tar slut: samma draft-helpers som när man tar bort
  // och drar en pil på ytan (invariant 4) – svaret skriver aldrig i fälten själv.
  const anmärkningar: string[] = [];
  const steg = new Set(tolkad.steps.map((s) => s.id));
  const k = ärObjekt(f.kopplingar) ? f.kopplingar : {};
  const ändar = (rå: unknown, vad: string): { från: string; till: string; etikett?: string }[] =>
    lista(rå)
      .filter(ärObjekt)
      .map((e) => ({ från: text(e["från"]), till: text(e.till), ...(text(e.etikett) ? { etikett: text(e.etikett) } : {}) }))
      .filter((e) => {
        if (steg.has(e.från) && steg.has(e.till)) return true;
        anmärkningar.push(`Förenklad: kan inte ${vad} kopplingen "${e.från}" → "${e.till}" – stegen finns inte.`);
        return false;
      });
  let ändrad = tolkad;
  for (const e of ändar(k.taBort, "ta bort")) ändrad = removeEdge(ändrad, e.från, e.till, e.etikett);
  for (const e of ändar(k["läggTill"], "lägga till")) ändrad = addManualEdge(ändrad, e.från, e.till);

  // Helpers märker draften som handjusterad; den här kom ur AI:n.
  const draft: ProcessDraft = { ...ändrad, meta: { ...ändrad.meta, origin: "ai" }, diagramType: "affarsprocess" };
  const modell = compileAp(draft);
  return {
    namn: `${källa.namn} (presentation)`,
    rawText: text(f.aiText) + "\n",
    draft,
    modell,
    bild: avskalaAp(modell),
    anmärkningar,
  };
}

/** Ett id som inte redan är taget. Id:n skapas här EN gång och lagras sedan. */
function unikt(prefix: string, tagna: Set<string>, önskat?: unknown): string {
  let id = text(önskat);
  while (!id || tagna.has(id)) id = nyttRamId(prefix);
  tagna.add(id);
  return id;
}

function byggScen(rå: unknown, anm: string[]): Scen {
  if (!ärObjekt(rå)) return standardScen();
  const b = ärObjekt(rå.bakgrund) ? rå.bakgrund.typ : rå.bakgrund;
  // En uppladdad bild går inte genom brevlådan – bara de ritade bakgrunderna.
  const bakgrund: Scen["bakgrund"] = { typ: b === "tom" ? "tom" : "stad" };
  const typer = new Set<string>(FIGURTYPER);
  const sedda = new Set<string>();
  const figurer: ScenFigur[] = [];
  for (const f of lista(rå.figurer)) {
    if (!ärObjekt(f)) continue;
    const id = text(f.id);
    const x = tal(f.x);
    const y = tal(f.y);
    if (!id || sedda.has(id) || x === null || y === null) {
      anm.push(`Scenen: en figur ströks (${id ? `"${id}" saknar läge eller finns två gånger` : "saknar id"}).`);
      continue;
    }
    if (!typer.has(f.typ as string)) {
      anm.push(`Scenen: figuren "${id}" har en okänd typ ("${String(f.typ)}") och ströks.`);
      continue;
    }
    sedda.add(id);
    const skala = tal(f.skala);
    figurer.push({
      id,
      typ: f.typ as FigurTyp,
      namn: typeof f.namn === "string" ? f.namn : "",
      // Inom scenen – en figur utanför bilden syns inte och går inte att ta tag i.
      x: Math.round(Math.min(SCEN_BREDD, Math.max(0, x))),
      y: Math.round(Math.min(STAD_HÖJD, Math.max(0, y))),
      ...(skala !== null && skala > 0 ? { skala } : {}),
    });
  }
  return figurer.length ? { bakgrund, figurer } : { ...standardScen(), bakgrund };
}

function byggRamScen(rå: unknown, figurer: Set<string>, tagna: Set<string>, var_: string, anm: string[]): RamScen {
  const o = ärObjekt(rå) ? rå : {};
  const finns = (id: unknown, vad: string): id is string => {
    if (typeof id === "string" && figurer.has(id)) return true;
    anm.push(`${var_}: ${vad} pekar på figuren "${String(id)}", som inte finns i scenen – struket.`);
    return false;
  };
  const figurLägen: RamScen["figurLägen"] = {};
  for (const [id, läge] of Object.entries(ärObjekt(o.figurLägen) ? o.figurLägen : {})) {
    const x = ärObjekt(läge) ? tal(läge.x) : null;
    const y = ärObjekt(läge) ? tal(läge.y) : null;
    if (x === null || y === null || !finns(id, "ett eget läge")) continue;
    figurLägen[id] = { x: Math.round(x), y: Math.round(y) };
  }
  return {
    markeringar: lista(o.markeringar)
      .filter(ärObjekt)
      .filter((m) => finns(m.figur, "en markering"))
      .map((m) => ({ figur: m.figur as string, verktyg: verktygEller(m.verktyg), färg: färgEller(m.färg, RAM_FÄRGER[0]) })),
    pulser: lista(o.pulser)
      .filter(ärObjekt)
      .filter((p) => finns(p.från, "en puls") && finns(p.till, "en puls") && p.från !== p.till)
      .map((p) => ({
        id: unikt("puls", tagna),
        från: p.från as string,
        till: p.till as string,
        färg: färgEller(p.färg, RAM_FÄRGER[0]),
        ...(text(p.text) ? { text: text(p.text) } : {}),
      })),
    bubblor: lista(o.bubblor)
      .filter(ärObjekt)
      .filter((b) => text(b.text) && finns(b.figur, "en pratbubbla"))
      .map((b) => ({ figur: b.figur as string, text: text(b.text) })),
    dolda: [...new Set(lista(o.dolda).filter((d): d is string => finns(d, "\"dolda\"")))],
    textrutor: lista(o.textrutor)
      .filter(ärObjekt)
      .filter((t) => tal(t.x) !== null && tal(t.y) !== null && (text(t.text) || text(t.rubrik)))
      .map((t) => ({
        id: unikt("text", tagna),
        x: Math.round(tal(t.x)!),
        y: Math.round(tal(t.y)!),
        bredd: Math.max(TEXTRUTA_MIN_BREDD, Math.round(tal(t.bredd) ?? TEXTRUTA_BREDD)),
        rubrik: text(t.rubrik),
        text: text(t.text),
        ...(tal(t.skala) ? { skala: tal(t.skala)! } : {}),
        ...(typeof t.bakgrund === "string" && FÄRG.test(t.bakgrund) ? { bakgrund: t.bakgrund } : {}),
        ...(typeof t["textfärg"] === "string" && FÄRG.test(t["textfärg"]) ? { textfärg: t["textfärg"] } : {}),
      })),
    pulspunkter: lista(o.pulspunkter)
      .filter(ärObjekt)
      .filter((p) => tal(p.x) !== null && tal(p.y) !== null)
      .map((p) => ({
        id: unikt("punkt", tagna),
        x: Math.round(tal(p.x)!),
        y: Math.round(tal(p.y)!),
        färg: färgEller(p.färg, RAM_FÄRGER[0]),
        ...(tal(p.storlek) ? { storlek: tal(p.storlek)! } : {}),
      })),
    figurLägen,
  };
}

/**
 * Den förenklade bildens objekt och kopplingar som text – det enda en ram får
 * peka på. EN utskrift: kontrollskriptet visar den för Claude Code och
 * servern (scripts/ark-ai.ts) skickar den till modellen, så båda ser samma id:n.
 */
export function beskrivFörenklad({ bild }: FörenkladProcess): string {
  const steg = bild.rutor.filter((r) => r.sort === "steg").length;
  const regler = bild.rutor.filter((r) => r.sort === "regel").length;
  const rader = [
    `FÖRENKLAD: ${steg} steg, ${regler} regler, ${bild.zoner.length} zoner · ` +
      `${Math.round(bild.bredd)} × ${Math.round(bild.höjd)} px (${(bild.bredd / bild.höjd).toFixed(2)}:1)`,
    `  zoner: ${bild.zoner.map((z) => z.namn).join(" · ")}`,
    '  objekt (mål med typ "nod"):',
  ];
  for (const r of bild.rutor) {
    const nr = r.nr ? `${r.nr}.` : r.sort === "regel" ? "◇" : "•";
    rader.push(
      `    ${nr.padEnd(3)} ${r.id.padEnd(24)} ${r.rubrik}${r.undertext ? `  [${r.undertext}]` : ""}  – ${bild.zoner[r.zon]?.namn}`,
    );
  }
  rader.push('  kopplingar (mål med typ "kant"):');
  for (const k of bild.kanter) rader.push(`        ${k.nyckel}`);
  return rader.join("\n");
}

/**
 * Gör om svaret till en förenklad process och en ramserie – utan att spara.
 * Ren funktion: samma kod körs av appen och av `scripts/presentation.mts`,
 * så det kontrollskriptet godkänner är det appen kommer att spara.
 */
export function byggPresentation(
  svar: unknown,
  källa: Pick<PresentationsKälla, "flödeId" | "namn" | "beskrivning">,
  upptagnaSerier: Iterable<string> = [],
  upptagnaFlöden: Iterable<string> = [],
): ByggdPresentation {
  const o = somObjekt(svar);
  const process = byggFörenklad(o, källa);
  const p = o.presentation;
  if (!ärObjekt(p) || !lista(p.ramar).some(ärObjekt)) {
    throw new Error('Svaret saknar "presentation" med minst en ram.');
  }

  const anmärkningar: string[] = [...process.anmärkningar];
  const scen = byggScen(p.scen, anmärkningar);
  const figurer = new Set(scen.figurer.map((f) => f.id));
  const noder = new Set(process.bild.rutor.map((r) => r.id));
  const kanter = new Set(process.bild.kanter.map((k) => k.nyckel));
  const tagna = new Set<string>();

  const ramar: Ram[] = lista(p.ramar)
    .filter(ärObjekt)
    .map((r, i) => {
      const rubrik = text(r.rubrik) || `Ram ${i + 1}`;
      const var_ = `Ram ${i + 1} ("${rubrik}")`;
      const markeringar: Markering[] = [];
      for (const m of lista(r.markeringar).filter(ärObjekt)) {
        const mål = m["mål"] ?? m.mal;
        const typ = ärObjekt(mål) && mål.typ === "kant" ? "kant" : "nod";
        const id = ärObjekt(mål) ? text(mål.id) : "";
        if (!(typ === "kant" ? kanter : noder).has(id)) {
          anmärkningar.push(
            `${var_}: ${typ === "kant" ? "kopplingen" : "objektet"} "${id}" finns inte i den avskalade bilden – markeringen ströks.`,
          );
          continue;
        }
        if (markeringar.some((x) => x.mål.typ === typ && x.mål.id === id)) continue; // ett mål, en markering
        markeringar.push({ mål: { typ, id }, verktyg: verktygEller(m.verktyg), färg: färgEller(m.färg, RAM_FÄRGER[4]) });
      }
      return {
        id: unikt("ram", tagna),
        rubrik,
        ...(text(r.text) ? { text: text(r.text) } : {}),
        ...(r["strålkastare"] === true ? { strålkastare: true } : {}),
        ...(r.zooma === true ? { zooma: true } : {}),
        markeringar,
        scen: byggRamScen(r.scen, figurer, tagna, var_, anmärkningar),
      };
    });

  // Det som ser OFULLSTÄNDIGT ut – rådgivande, hindrar ingenting.
  const lyfta = new Set(ramar.flatMap((r) => r.markeringar.filter((m) => m.mål.typ === "nod").map((m) => m.mål.id)));
  for (const ruta of process.bild.rutor) {
    if (ruta.sort !== "ände" && !lyfta.has(ruta.id)) {
      anmärkningar.push(`"${ruta.rubrik}" (${ruta.id}) lyfts aldrig fram i någon ram.`);
    }
  }
  for (const f of scen.figurer) {
    if (ramar.every((r) => r.scen!.dolda.includes(f.id))) {
      anmärkningar.push(`Figuren "${f.id}" är dold i varje ram – den syns aldrig.`);
    }
  }

  const namn = text(p.namn) || `${källa.namn} – presentation`;
  const tagnaFlöden = [...upptagnaFlöden];
  const flödeId = presentationsFlödeId(källa.flödeId, tagnaFlöden);
  // Namnet säger vilken i ordningen det är, så att de går att skilja åt i katalogen.
  const nr = /-(\d+)$/.exec(flödeId)?.[1];
  return {
    flödeId,
    källNamn: källa.namn,
    process: nr ? { ...process, namn: `${källa.namn} (presentation ${nr})` } : process,
    serie: {
      id: serieId(namn, upptagnaSerier),
      namn,
      flödeId,
      savedAt: new Date().toISOString(),
      stil: "avskalad",
      scen,
      ramar,
    },
    anmärkningar,
  };
}

/* ------------------------------------------------------------------ */
/* Sparningen                                                          */
/* ------------------------------------------------------------------ */

/**
 * Sparar den förenklade processen och ramserien – båda som NYA poster.
 *
 * Processen går genom `saveFlowVersion` som all annan sparning. Id:t är valt
 * ledigt (`presentationsFlödeId`); skulle det ändå hinna bli taget lägger
 * sparningen till en version i stället för att skriva över (invariant 11).
 */
export async function sparaPresentation(
  flöden: FlowStore,
  ramar: RamStore,
  b: ByggdPresentation,
): Promise<{ flöde: SavedFlow; serie: Ramserie }> {
  const flöde = await saveFlowVersion(flöden, {
    id: b.flödeId,
    name: b.process.namn,
    category: PRESENTATIONSKATEGORI,
    rawText: b.process.rawText,
    draft: b.process.draft,
    view: { perspective: "business", pageFormat: "free", scale: 1, spacing: 1, textScale: 1 },
    label: `Förenklad ur "${b.källNamn}" (AI)`,
  });
  await ramar.save(b.serie);
  meddelaFlödenÄndrade();
  meddelaRamarÄndrade();
  return { flöde, serie: b.serie };
}

/** Hela uppdraget: begäran, väntan på Claude Code, bygge och sparning. */
export async function begärPresentation(
  källa: PresentationsKälla,
  lagring: { flöden: FlowStore; ramar: RamStore },
  signal?: AbortSignal,
): Promise<{ flöde: SavedFlow; serie: Ramserie; anmärkningar: string[] }> {
  const svar = await requestClaudeCodeUppdrag({
    uppdrag: PRESENTATION_UPPDRAG,
    payload: JSON.stringify({ namn: källa.namn, beskrivning: källa.beskrivning, process: källa.struktur }, null, 2),
    instruction: presentationsInstruktion(),
    källa: { flödeId: källa.flödeId, namn: källa.namn },
    diagramType: "affarsprocess",
    signal,
    timeoutMs: VÄNTETID_MS,
  });
  const serier = (await lagring.ramar.list()).map((s) => s.id);
  const sparade = (await lagring.flöden.list()).map((f) => f.id);
  const byggd = byggPresentation(svar, källa, serier, sparade);
  return { ...(await sparaPresentation(lagring.flöden, lagring.ramar, byggd)), anmärkningar: byggd.anmärkningar };
}
