/**
 * Informationsklassning – vilken nivå en process eller systemskiss har.
 *
 * REGELN BOR HÄR. Appen, bryggan och exporterna frågar samma funktioner, så att
 * en nivå aldrig kan se olika ut på skärmen och i en exporterad bild.
 *
 * Tre saker hålls isär:
 *   1. MODELLEN – vilka nivåer som finns. Produkten har en neutral standard
 *      (konsekvensnivåerna 0–3 som i SKR:s KLASSA) och installationen kan
 *      lägga in en egen. Ingen organisations modell står i koden.
 *   2. INSTÄLLNINGEN – om klassning alls används, vilken modell som gäller och
 *      om nivån visas i exporten respektive på processen/skissen. Den skrivs
 *      bara av en administratör (server/installningsfiler.ts). AV som förval.
 *   3. KLASSNINGEN på en process eller skiss – nivåns id, plus namnet när den
 *      sattes (så att den går att läsa också om modellen byts), när och av vem.
 *
 * Klassningen sitter på PROCESSEN/SKISSEN, inte på en version: som
 * placeringen och publiceringen säger den hur innehållet ska hanteras, inte
 * vad det är (invariant 11:s undantag). Att sätta den ger ingen ny version.
 *
 * Modulen är beroendefri (ren TS, inget DOM): både bryggan och webbläsaren
 * laddar den. Allt som kommer utifrån byggs om fält för fält.
 */

export interface Klassningsnivå {
  /** Stabilt id inom modellen – härlett ur namnet när modellen skrivs som text. */
  id: string;
  namn: string;
  /** 0 = huvudnivå, 1 = undernivå till närmast föregående huvudnivå. */
  djup: 0 | 1;
}

export interface Klassningsmodell {
  id: string;
  namn: string;
  /** Varifrån modellen kommer – visas för administratören. */
  källa?: string;
  nivåer: Klassningsnivå[];
}

export interface Klassningsinställning {
  /** Används klassning alls i installationen? Förval: nej. */
  på: boolean;
  modell: Klassningsmodell;
  /** Visas nivån i exporterade bilder (revisionsrutan)? */
  visaIExport: boolean;
  /** Visas nivån på processen och skissen, för alla som läser den? */
  visaIVyn: boolean;
}

/** Klassningen på en process eller skiss. */
export interface Klassning {
  /** Nivåns id i modellen. */
  nivå: string;
  /** Nivåns namn när den sattes – visas om nivån inte längre finns i modellen. */
  namn: string;
  /** ISO-tidpunkt. Skrivs av bryggan. */
  satt: string;
  /** Den som satte nivån. Skrivs av bryggan. */
  sattAv?: string;
}

/* ------------------------------------------------------------------ */
/* Modellerna                                                          */
/* ------------------------------------------------------------------ */

const MAX = { nivåer: 40, namn: 120 } as const;

/** Ett id ur ett namn: gemener, a–z/0–9 och bindestreck. å/ä → a, ö → o. */
export function nivåId(namn: string): string {
  return (
    namn
      .toLowerCase()
      .replace(/[åä]/g, "a")
      .replace(/ö/g, "o")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "niva"
  );
}

/**
 * Produktens standardmodell: konsekvensnivåerna för konfidentialitet som i
 * SKR:s klassningsverktyg KLASSA (nivå 0–3). Organisationer formulerar
 * nivåerna lite olika – den som vill ha sina egna ord lägger in en egen modell.
 */
export const KLASSA_MODELL: Klassningsmodell = {
  id: "klassa-konfidentialitet",
  namn: "Konsekvensnivåer 0–3 (som i SKR:s KLASSA)",
  källa: "SKR:s KLASSA, konfidentialitet",
  nivåer: [
    { id: "niva-0", namn: "Nivå 0 – Ingen eller försumbar skada", djup: 0 },
    { id: "niva-1", namn: "Nivå 1 – Måttlig skada", djup: 0 },
    { id: "niva-2", namn: "Nivå 2 – Betydande skada", djup: 0 },
    { id: "niva-3", namn: "Nivå 3 – Allvarlig skada", djup: 0 },
  ],
};

/** Modellerna som följer med produkten. Den första är förvalet. */
export const INBYGGDA_MODELLER: readonly Klassningsmodell[] = [KLASSA_MODELL];

/** Id:t en installations egen modell har. */
export const EGEN_MODELL = "egen";

export const STANDARDINSTÄLLNING: Klassningsinställning = {
  på: false,
  modell: KLASSA_MODELL,
  visaIExport: true,
  visaIVyn: true,
};

const sträng = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Nivåerna i en form vi litar på: namn krävs, id:n unika, första nivån aldrig en undernivå. */
function läsNivåer(rå: unknown): Klassningsnivå[] {
  if (!Array.isArray(rå)) return [];
  const ut: Klassningsnivå[] = [];
  const sedda = new Set<string>();
  for (const n of rå.slice(0, MAX.nivåer)) {
    if (!n || typeof n !== "object") continue;
    const r = n as Record<string, unknown>;
    const namn = sträng(r.namn, MAX.namn).trim();
    if (!namn) continue;
    let id = typeof r.id === "string" && /^[a-z0-9-]{1,64}$/.test(r.id) ? r.id : nivåId(namn);
    for (let i = 2; sedda.has(id); i++) id = `${nivåId(namn).slice(0, 60)}-${i}`;
    sedda.add(id);
    ut.push({ id, namn, djup: r.djup === 1 && ut.length > 0 ? 1 : 0 });
  }
  return ut;
}

export function läsModell(rå: unknown): Klassningsmodell | null {
  if (!rå || typeof rå !== "object") return null;
  const r = rå as Record<string, unknown>;
  const inbyggd = INBYGGDA_MODELLER.find((m) => m.id === r.id);
  if (inbyggd) return inbyggd;
  const nivåer = läsNivåer(r.nivåer);
  if (!nivåer.length) return null;
  const källa = sträng(r.källa, MAX.namn).trim();
  return {
    id: EGEN_MODELL,
    namn: sträng(r.namn, MAX.namn).trim() || "Egen modell",
    ...(källa ? { källa } : {}),
    nivåer,
  };
}

/** Inställningen ur en fil eller en begäran. Allt okänt faller tillbaka på förvalet. */
export function läsKlassningsinställning(rå: unknown): Klassningsinställning {
  if (!rå || typeof rå !== "object") return STANDARDINSTÄLLNING;
  const r = rå as Record<string, unknown>;
  return {
    på: r.på === true,
    modell: läsModell(r.modell) ?? KLASSA_MODELL,
    visaIExport: r.visaIExport !== false,
    visaIVyn: r.visaIVyn !== false,
  };
}

/**
 * En modell som TEXT – så skriver administratören in sin egen: en nivå per
 * rad, och en indragen rad (blanksteg, tab eller `\` först) är en undernivå
 * till raden ovanför.
 */
export function modellTillText(m: Klassningsmodell): string {
  return m.nivåer.map((n) => `${n.djup ? "  " : ""}${n.namn}`).join("\n");
}

export function textTillNivåer(text: string): Klassningsnivå[] {
  const rader = text
    .split(/\r?\n/)
    .map((rad) => ({ under: /^(\s+|\\)/.test(rad), namn: rad.replace(/^[\s\\]+/, "").trim() }))
    .filter((r) => r.namn);
  return läsNivåer(rader.map((r) => ({ namn: r.namn, djup: r.under ? 1 : 0 })));
}

/* ------------------------------------------------------------------ */
/* Klassningen på en process eller skiss                                */
/* ------------------------------------------------------------------ */

export function läsKlassning(rå: unknown): Klassning | undefined {
  if (!rå || typeof rå !== "object") return undefined;
  const r = rå as Record<string, unknown>;
  const nivå = typeof r.nivå === "string" && /^[a-z0-9-]{1,64}$/.test(r.nivå) ? r.nivå : "";
  const namn = sträng(r.namn, MAX.namn).trim();
  if (!nivå || !namn) return undefined;
  const satt = typeof r.satt === "string" && !Number.isNaN(Date.parse(r.satt)) ? r.satt : new Date(0).toISOString();
  const sattAv = sträng(r.sattAv, 200).trim();
  return { nivå, namn, satt, ...(sattAv ? { sattAv } : {}) };
}

/** Nivån i modellen, eller undefined. */
export function nivåI(m: Klassningsmodell, id: string | undefined): Klassningsnivå | undefined {
  return id ? m.nivåer.find((n) => n.id === id) : undefined;
}

/**
 * Det som står i bild för klassningen: modellens nuvarande namn på nivån,
 * annars namnet när den sattes. Tom sträng när klassning är avstängd eller
 * inget är valt – då visas ingenting.
 */
export function klassningsText(inst: Klassningsinställning, k: Klassning | undefined): string {
  if (!inst.på || !k) return "";
  return nivåI(inst.modell, k.nivå)?.namn ?? k.namn;
}

/** Texten i en exporterad bild – bara när administratören valt att visa den där. */
export function klassningIExport(inst: Klassningsinställning, k: Klassning | undefined): string {
  return inst.visaIExport ? klassningsText(inst, k) : "";
}

export class Klassningsfel extends Error {}

/**
 * Klassningen som ska skrivas när någon begär `begärd` (null = ta bort).
 * Bryggan anropar den – webbläsarens tidpunkt och namn litar den aldrig på.
 *
 * - Avstängd klassning: det som står i filen står kvar, oavsett begäran.
 * - Samma nivå som förut: den befintliga står kvar (tid och person rörs inte).
 * - En ny nivå måste finnas i modellen; den stämplas med tid och den inloggade.
 */
export function prövaKlassning(
  inst: Klassningsinställning,
  befintlig: Klassning | undefined,
  begärd: unknown,
  vem: string | undefined,
  nu: string = new Date().toISOString(),
): Klassning | undefined {
  if (!inst.på) return befintlig;
  if (begärd === null || begärd === undefined) return undefined;
  const id = typeof begärd === "object" ? (begärd as Record<string, unknown>).nivå : undefined;
  if (typeof id !== "string" || !id) return undefined;
  if (befintlig?.nivå === id) return befintlig;
  const nivå = nivåI(inst.modell, id);
  if (!nivå) throw new Klassningsfel(`Klassningsnivån ${id} finns inte i modellen.`);
  return { nivå: nivå.id, namn: nivå.namn, satt: nu, ...(vem?.trim() ? { sattAv: vem.trim() } : {}) };
}
