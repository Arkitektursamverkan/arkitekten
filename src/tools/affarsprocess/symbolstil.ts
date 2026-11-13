/**
 * SYMBOLSTILEN – hur affärsprocessens symboler ser ut: färger, typsnitt,
 * skugga, hörnradie, pilspets och – om stilen vill – egna symbolformer.
 *
 * Symbolernas MÅTT och fästpunkter bor i `former.ts` och är desamma för alla.
 * Allt som en organisation kan vilja ha på sitt eget sätt står här, som DATA:
 * produktens symboler finns i `standardsymboler.ts`, och en stil kan byta ut
 * vilken som helst av dem mot sin egen (`symboler`, formen i `symbolform.ts`).
 * En stil är
 * ett JSON-dokument som kan ligga i ett innehållspaket. Produkten har en
 * neutral standardstil; en installation lägger sina egna stilar i
 * `STILAR_DIR` och en administratör väljer bland dem (server/symbolstilar.ts).
 *
 * EN aktiv stil i taget, satt vid start – i webbläsaren av inloggningsgrinden,
 * på servern av flödestjänsten före varje scen. Canvasen, SVG-exporten och
 * scenen läser alla `symbolstil()`, så skärm, fil och portal ritar likadant
 * (invariant 1).
 *
 * Värdena sätts in i SVG-markup. `läsSymbolstil` släpper därför bara igenom
 * färger och typsnittsnamn av ofarlig form – ett paket kan inte smuggla in
 * element eller attribut.
 */

import type { ApNodeKind, ApRelationKind } from "@/core/affarsprocess";
import type { Huki } from "@/core/draft";

import type { Symbolnyckel } from "./standardsymboler";
import { läsSymbol, type Symbol } from "./symbolform";

export interface Formstil {
  fill: string;
  stroke: string;
  text: string;
  /** Ljusare detalj i symbolen (IT-stödets cylinderlock). Saknas = fyllningen, halvgenomskinlig. */
  ljus?: string;
}

/** De symboler en stil kan byta ut. */
const SYMBOLNYCKLAR: readonly Symbolnyckel[] = [
  "process", "aktivitet", "vo", "vo:dokument", "vo:meddelande", "regel", "roll", "intressent",
  "applikation", "arkiv", "krav", "tid", "forum", "plats", "problem", "risk", "mojlighet",
];

export interface Symbolstil {
  id: string;
  namn: string;
  beskrivning?: string;
  /** CSS-typsnittsstack, t.ex. "Segoe UI, Arial, sans-serif". */
  teckensnitt: string;
  former: Record<ApNodeKind, Formstil>;
  /** Namnet under en symbol (verksamhetsobjekt, aktör, IT-stöd …). */
  textUnderSymbol: string;
  relationer: Record<ApRelationKind, string>;
  /** Ansvarslinjerna – en färg per HUKI-bokstav. */
  huki: Record<Huki, string>;
  /** Kopplingarnas hörnradie i oskalade pixlar. 0 = räta vinklar. */
  hörnradie: number;
  /** Mjuk skugga under aktiviteten (produktens egen aktivitetssymbol). */
  skugga: boolean;
  /** Stilens egna symboler. En sort som saknas ritas med produktens. */
  symboler?: Partial<Record<Symbolnyckel, Symbol>>;
  /** Stilens egen pilspets: en bana i en ruta 10 × 10 med udden i (10, 5). */
  pilspets?: (string | number)[];
  /**
   * Hur pilar möter forumsymbolens kropp: som en ruta (förval) eller som en
   * ellips, för en stil vars forumsymbol är rund.
   */
  forumKontur?: "ruta" | "ellips";
}

/** Standardstilen: neutral, läsbar i svartvitt, utan förebild i någon annan produkt. */
export const NEUTRAL_STIL: Symbolstil = {
  id: "neutral",
  namn: "Neutral",
  beskrivning: "Standardstilen.",
  teckensnitt: "Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif",
  former: {
    process: { fill: "#dbe7f5", stroke: "#4f6f99", text: "#1f2d3d" },
    aktivitet: { fill: "#f4f7fb", stroke: "#4f6f99", text: "#1f2d3d" },
    vo: { fill: "#e2e8f0", stroke: "#475569", text: "#1f2937" },
    regel: { fill: "#fde68a", stroke: "#b45309", text: "#422006" },
    roll: { fill: "#60a5fa", stroke: "#1d4ed8", text: "#1e3a8a" },
    intressent: { fill: "#93c5fd", stroke: "#1d4ed8", text: "#1e3a8a" },
    applikation: { fill: "#9ca3af", stroke: "#4b5563", text: "#1f2937", ljus: "#d1d5db" },
    arkiv: { fill: "#9ca3af", stroke: "#4b5563", text: "#1f2937" },
    krav: { fill: "#ddd6fe", stroke: "#6d28d9", text: "#2e1065" },
    tid: { fill: "#ffffff", stroke: "#4b5563", text: "#1f2937" },
    forum: { fill: "#e5e7eb", stroke: "#9ca3af", text: "#1f2937" },
    plats: { fill: "#34d399", stroke: "#047857", text: "#064e3b" },
    problem: { fill: "#ffffff", stroke: "#b91c1c", text: "#b91c1c" },
    risk: { fill: "#fff7ed", stroke: "#c2410c", text: "#7c2d12" },
    mojlighet: { fill: "#ffffff", stroke: "#15803d", text: "#15803d" },
    textobjekt: { fill: "none", stroke: "none", text: "#374151" },
  },
  textUnderSymbol: "#374151",
  relationer: {
    flode: "#4f6f99",
    huki: "#2563eb",
    samverkar: "#111827",
    adresserar: "#6d28d9",
    styr: "#6b7280",
    stodjer: "#6b7280",
    bestar: "#6b7280",
  },
  huki: { H: "#b91c1c", U: "#2563eb", K: "#0f766e", I: "#ca8a04" },
  hörnradie: 4,
  skugga: false,
};

let aktiv: Symbolstil = NEUTRAL_STIL;

/** Den stil som gäller just nu. */
export const symbolstil = (): Symbolstil => aktiv;

/** Byter aktiv stil; null = standardstilen. */
export function sättSymbolstil(stil: Symbolstil | null): void {
  aktiv = stil ?? NEUTRAL_STIL;
}

const FÄRG = /^(#[0-9a-fA-F]{3,8}|none)$/;
const TYPSNITT = /^[\p{L}\p{N} ,'-]{1,200}$/u;
const ID = /^[a-z0-9-]{1,64}$/;

function färg(v: unknown, reserv: string, fält: string): string {
  if (v === undefined) return reserv;
  if (typeof v !== "string" || !FÄRG.test(v)) throw new Error(`Ogiltig färg i ${fält}: ${String(v).slice(0, 40)}`);
  return v;
}

/**
 * En stil ur ett paket (okänd JSON). Det som saknas tas ur standardstilen, så
 * ett paket kan nöja sig med att ange det som skiljer. Allt prövas – en ogiltig
 * färg eller ett konstigt typsnitt ger ett fel i stället för trasig SVG.
 */
export function läsSymbolstil(json: unknown): Symbolstil {
  if (!json || typeof json !== "object") throw new Error("Symbolstilen är inte ett objekt.");
  const j = json as Record<string, any>;
  if (typeof j.id !== "string" || !ID.test(j.id)) throw new Error("Symbolstilen saknar ett giltigt id (a–z, 0–9, -).");
  if (typeof j.namn !== "string" || !j.namn.trim()) throw new Error(`Symbolstilen ${j.id} saknar namn.`);
  const n = NEUTRAL_STIL;
  const former = {} as Record<ApNodeKind, Formstil>;
  for (const kind of Object.keys(n.former) as ApNodeKind[]) {
    const f = j.former?.[kind] ?? {};
    former[kind] = {
      fill: färg(f.fill, n.former[kind].fill, `former.${kind}.fill`),
      stroke: färg(f.stroke, n.former[kind].stroke, `former.${kind}.stroke`),
      text: färg(f.text, n.former[kind].text, `former.${kind}.text`),
    };
    const ljus = f.ljus === undefined ? n.former[kind].ljus : färg(f.ljus, "", `former.${kind}.ljus`);
    if (ljus) former[kind].ljus = ljus;
  }
  const relationer = {} as Record<ApRelationKind, string>;
  for (const kind of Object.keys(n.relationer) as ApRelationKind[])
    relationer[kind] = färg(j.relationer?.[kind], n.relationer[kind], `relationer.${kind}`);
  const huki = {} as Record<Huki, string>;
  for (const h of Object.keys(n.huki) as Huki[]) huki[h] = färg(j.huki?.[h], n.huki[h], `huki.${h}`);
  const teckensnitt = j.teckensnitt ?? n.teckensnitt;
  if (typeof teckensnitt !== "string" || !TYPSNITT.test(teckensnitt))
    throw new Error(`Ogiltigt typsnitt i symbolstilen ${j.id}.`);
  const hörnradie = j.hörnradie ?? n.hörnradie;
  if (typeof hörnradie !== "number" || !(hörnradie >= 0 && hörnradie <= 30))
    throw new Error(`Hörnradien i symbolstilen ${j.id} ska vara ett tal mellan 0 och 30.`);
  // Egna symboler: bara kända sorter, och varje ritdel prövas (symbolform.ts).
  const symboler: Partial<Record<Symbolnyckel, Symbol>> = {};
  if (j.symboler !== undefined) {
    if (!j.symboler || typeof j.symboler !== "object" || Array.isArray(j.symboler))
      throw new Error(`Symbolerna i symbolstilen ${j.id} ska vara ett objekt.`);
    for (const nyckel of Object.keys(j.symboler)) {
      if (!SYMBOLNYCKLAR.includes(nyckel as Symbolnyckel))
        throw new Error(`Okänd symbol i symbolstilen ${j.id}: ${nyckel.slice(0, 40)}.`);
      symboler[nyckel as Symbolnyckel] = läsSymbol(j.symboler[nyckel], `symboler.${nyckel}`);
    }
  }
  let pilspets: (string | number)[] | undefined;
  if (j.pilspets !== undefined) {
    // Samma prövning som en bana – men bara tal, rutan är alltid 10 × 10.
    const [bana] = läsSymbol([{ form: "bana", d: j.pilspets }], "pilspets");
    const d = bana.form === "bana" ? bana.d : [];
    if (d.some((v) => typeof v !== "string" && typeof v !== "number"))
      throw new Error(`Pilspetsen i symbolstilen ${j.id} får bara innehålla kommandon och tal.`);
    pilspets = d as (string | number)[];
  }
  if (j.forumKontur !== undefined && j.forumKontur !== "ruta" && j.forumKontur !== "ellips")
    throw new Error(`Okänd forumkontur i symbolstilen ${j.id}: ${String(j.forumKontur).slice(0, 20)}.`);
  return {
    id: j.id,
    namn: j.namn.trim().slice(0, 80),
    ...(typeof j.beskrivning === "string" ? { beskrivning: j.beskrivning.slice(0, 300) } : {}),
    teckensnitt,
    former,
    textUnderSymbol: färg(j.textUnderSymbol, n.textUnderSymbol, "textUnderSymbol"),
    relationer,
    huki,
    hörnradie,
    skugga: j.skugga === undefined ? n.skugga : Boolean(j.skugga),
    ...(Object.keys(symboler).length ? { symboler } : {}),
    ...(pilspets ? { pilspets } : {}),
    ...(j.forumKontur ? { forumKontur: j.forumKontur } : {}),
  };
}
