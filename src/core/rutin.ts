/**
 * RUTIN – arbetsbeskrivningen bakom ett krav i affärsprocessverktyget.
 *
 * En rutin lagras som ren text (`ProcessDraft.apRutiner`), en rad per moment,
 * så att den går att klistra in rakt ur ett dokument och rätta för hand. Den
 * här modulen gör texten till den lista som VISAS – en plats, så att
 * rutinvyn och en framtida export numrerar likadant.
 *
 * - Varje icke-tom rad är ett moment.
 * - En INDRAGEN rad (blanksteg/tabb), eller en rad som börjar med "-", "•"
 *   eller "*", är en underpunkt till momentet före.
 * - En inklistrad numrering ("1.", "2)") skalas bort; vyn numrerar själv.
 */

export interface RutinMoment {
  text: string;
  /** Underpunkter – valen eller förklaringarna under momentet. */
  under: string[];
}

const PUNKT = /^[-•*]\s+/;
const NUMMER = /^\d+\s*[.)]\s+/;

export function tolkaRutin(text: string): RutinMoment[] {
  const moment: RutinMoment[] = [];
  for (const rad of text.split(/\r?\n/)) {
    const trimmad = rad.trim();
    if (!trimmad) continue;
    const underpunkt = /^\s/.test(rad) || PUNKT.test(trimmad);
    const ren = trimmad.replace(PUNKT, "").replace(NUMMER, "").trim();
    if (!ren) continue;
    // En underpunkt utan moment före har inget att hänga under – då är den
    // själv ett moment (en text som börjar indragen ska inte försvinna).
    if (underpunkt && moment.length > 0) moment[moment.length - 1].under.push(ren);
    else moment.push({ text: ren, under: [] });
  }
  return moment;
}

/**
 * Motsatsen till `tolkaRutin`: momenten tillbaka till den text som lagras.
 * Byggaren i rutinvyn redigerar moment, men det som sparas är fortfarande
 * raderna – EN lagringsform, så att en byggd och en inklistrad rutin är samma
 * sak. Tomma rader skrivs inte. Ett moment utan egen text kan inte bära
 * underpunkter (de hade hängt sig på momentet FÖRE); då blir de egna moment
 * hellre än att försvinna.
 */
export function skrivRutin(moment: readonly RutinMoment[]): string {
  const rader: string[] = [];
  for (const m of moment) {
    const text = m.text.trim();
    const under = m.under.map((u) => u.trim()).filter(Boolean);
    if (text) rader.push(text, ...under.map((u) => `  ${u}`));
    else rader.push(...under);
  }
  return rader.join("\n");
}

/* ------------------------------------------------------------------ */
/* Bildstödet – härlett ur texten, aldrig lagrat                       */
/* ------------------------------------------------------------------ */

/**
 * En rad med pilar är en KLICKVÄG ("Gå till Lösningar → eDiscovery → Ärenden").
 * Den visas som en kedja av brickor i stället för löpande text – det är så man
 * läser den: ett klick i taget. En rad utan pil ger en enda del.
 */
export function rutinStig(text: string): string[] {
  return text
    .split(/\s*(?:→|->)\s*/)
    .map((d) => d.trim())
    .filter(Boolean);
}

/** Vad momentet ber en GÖRA – väljer symbolen framför det. */
export type RutinSort =
  | "navigera"
  | "klicka"
  | "skriv"
  | "logga-in"
  | "öppna"
  | "ladda-ner"
  | "steg";

/**
 * Ordningen är regeln: första träffen vinner, och de smala mönstren står före
 * de breda ("ladda ner" före "klicka", för "Klicka på Exportera" ÄR en
 * nedladdning; "gå till" före "ladda ner", för "Gå till Data → Hämta data" är
 * en väg dit, inte hämtningen). Läses ur momentets egna ord – en rutin som klistras in får
 * sitt bildstöd utan att någon märker upp den.
 */
const SORTER: Array<[RutinSort, RegExp]> = [
  ["logga-in", /\blogga in\b/i],
  ["navigera", /^(gå till|navigera|välj fliken)\b/i],
  ["ladda-ner", /\b(ladda ner|ladda ned|exportera|hämta)\b/i],
  ["öppna", /^(öppna|starta)\b/i],
  ["skriv", /^(ange|skriv|fyll i|skapa|namnge)\b/i],
  ["klicka", /^(klicka|markera|välj|tryck|kryssa)\b/i],
];

export function rutinSort(text: string): RutinSort {
  return SORTER.find(([, mönster]) => mönster.test(text.trim()))?.[0] ?? "steg";
}

/** Längsta underpunkt som ännu är ett VAL (en bricka) och inte en mening. */
const VAL_MAXLÄNGD = 24;

/**
 * Hur underpunkterna under ett moment ska visas:
 *  - "val"  – korta alternativ ("Nyckelord", "Datum") → brickor på rad
 *  - "steg" – delmoment att göra i tur och ordning → en lista
 * Blandas de är det en lista: en bricka bredvid en hel mening läses som en
 * rubrik, inte som ett alternativ.
 */
export function underpunktSort(under: readonly string[]): "val" | "steg" {
  const korta = under.every((u) => u.length <= VAL_MAXLÄNGD && rutinStig(u).length === 1);
  return under.length > 1 && korta ? "val" : "steg";
}

/**
 * En underpunkt som FÖRKLARAR i stället för att be en göra något: ett
 * villkor ("Om du vill …") eller en beskrivning ("Statistik - visar …").
 * Den ritas som en upplysning, så att den inte läses som ett moment man
 * missat.
 */
export function ärUpplysning(text: string): boolean {
  return /^(om|obs|tips|notera)\b/i.test(text.trim()) || /^\S+(\s\S+)?\s+[-–]\s+\S/.test(text.trim());
}

/* ------------------------------------------------------------------ */
/* Checklistan i ett krav – "[Krav: Rutin X – ☐ moment ☐ moment]"      */
/* ------------------------------------------------------------------ */

/**
 * Kryssrutorna som inleder ett moment i en checklista. Både tomma och
 * förbockade godtas – bocken hör till läsningen, inte till rutinen, så en
 * inklistrad "☑" blir ett vanligt moment.
 */
const KRYSSRUTA = /[☐☑☒□■✓✔]/;
const KRYSSRUTOR = /\s*[☐☑☒□■✓✔]\s*/;

/** Sant när kravets text bär en checklista som kan bli en rutin. */
export function harChecklista(text: string): boolean {
  return KRYSSRUTA.test(text);
}

/**
 * Delar ett krav med inskriven checklista i kravets NAMN och rutinens TEXT:
 *
 *   "Rutin uppdatering brandväggar – ☐ Ladda ner firmware ☐ Ta backup"
 *     → { namn: "Rutin uppdatering brandväggar",
 *         rutin: "Ladda ner firmware\nTa backup" }
 *
 * Så skriver man – och AI:n – en checklista i löptexten, där rutinen inte
 * har någon egen plats. Ett streck eller kolon mellan namnet och första
 * rutan skalas bort. Saknas namn före rutorna (texten BÖRJAR med en ruta)
 * heter kravet "Rutin". Returnerar null när texten inte har någon checklista.
 */
export function delaChecklista(text: string): { namn: string; rutin: string } | null {
  if (!harChecklista(text)) return null;
  const [före, ...moment] = text.split(KRYSSRUTOR);
  const namn = före.replace(/[\s–—:-]+$/, "").trim() || "Rutin";
  const rutin = skrivRutin(
    moment.map((m) => m.trim()).filter(Boolean).map((m) => ({ text: m, under: [] })),
  );
  return { namn, rutin };
}
