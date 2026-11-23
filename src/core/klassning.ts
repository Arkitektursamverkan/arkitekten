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
 *   4. SKYDDSKLASSERNA – vem som får se vad. En nivå kan kräva en skyddsklass
 *      ("Känsliga personuppgifter"); bara den som har klassen (och
 *      administratören) ser en process eller skiss med den nivån. En nivå utan
 *      skyddsklass kräver inget extra. Regeln står i core/behorighet.ts
 *      (`fårSeKlassning`); här står bara vilka klasser som finns.
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

/**
 * En skyddsklass: nivåerna som kräver den och vilka som har den. Samma
 * klass (samma id) tilldelas i EA-portalen, där den är en behörighet som
 * delas ut med rollerna – Arkitekten skickar kravet med varje bild.
 */
export interface Skyddsklass {
  /** Stabilt id – härlett ur namnet, och det portalen känner klassen under. */
  id: string;
  namn: string;
  /** Nivåerna (id i modellen) som kräver klassen. En nivå hör till högst en klass. */
  nivåer: string[];
  /**
   * Vilka som har klassen i Arkitekten: e-postadress, Entra-kontots
   * objekt-id eller en Entra-grupps objekt-id (då har alla i gruppen den),
   * med gemener. Bara administratören ser listan.
   */
  behöriga: string[];
}

export interface Klassningsinställning {
  /** Används klassning alls i installationen? Förval: nej. */
  på: boolean;
  modell: Klassningsmodell;
  /** Visas nivån i exporterade bilder (revisionsrutan)? */
  visaIExport: boolean;
  /** Visas nivån på processen och skissen, för alla som läser den? */
  visaIVyn: boolean;
  /** Vem som får se vad. Tom = alla som ser processen ser nivån (som förut). */
  skyddsklasser: Skyddsklass[];
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

const MAX = { nivåer: 40, namn: 120, klasser: 20, behöriga: 500 } as const;

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
  skyddsklasser: [],
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
  const modell = läsModell(r.modell) ?? KLASSA_MODELL;
  return {
    på: r.på === true,
    modell,
    visaIExport: r.visaIExport !== false,
    visaIVyn: r.visaIVyn !== false,
    skyddsklasser: läsSkyddsklasser(r.skyddsklasser, modell),
  };
}

/** En behörig: e-post eller objekt-id, gemener, inga blanksteg. */
export function läsBehörig(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase().slice(0, 200).replace(/\s+/g, "") : "";
}

/**
 * Skyddsklasserna i en form vi litar på. Nivåer som inte finns i modellen
 * släpps (de kan ändå inte väljas), och en nivå hör till högst EN klass –
 * den första som tar den. Id:t är unikt.
 */
function läsSkyddsklasser(rå: unknown, modell: Klassningsmodell): Skyddsklass[] {
  if (!Array.isArray(rå)) return [];
  const finns = new Set(modell.nivåer.map((n) => n.id));
  const tagna = new Set<string>();
  const ider = new Set<string>([OKÄND_SKYDDSKLASS]);
  const ut: Skyddsklass[] = [];
  for (const k of rå.slice(0, MAX.klasser)) {
    if (!k || typeof k !== "object") continue;
    const r = k as Record<string, unknown>;
    const namn = sträng(r.namn, MAX.namn).trim();
    if (!namn) continue;
    const bas = nivåId(namn);
    let id = typeof r.id === "string" && /^[a-z0-9-]{1,64}$/.test(r.id) && !ider.has(r.id) ? r.id : bas;
    for (let i = 2; ider.has(id); i++) id = `${bas.slice(0, 60)}-${i}`;
    ider.add(id);
    const nivåer = (Array.isArray(r.nivåer) ? r.nivåer : [])
      .filter((n): n is string => typeof n === "string" && finns.has(n) && !tagna.has(n));
    nivåer.forEach((n) => tagna.add(n));
    const behöriga = [...new Set((Array.isArray(r.behöriga) ? r.behöriga : []).map(läsBehörig).filter(Boolean))].slice(
      0,
      MAX.behöriga,
    );
    ut.push({ id, namn, nivåer, behöriga });
  }
  return ut;
}

/** Kravet för en nivå som inte finns i modellen: bara administratören ser den. */
export const OKÄND_SKYDDSKLASS = "okand";

/**
 * Skyddsklassen en nivå kräver: klassen, `OKÄND_SKYDDSKLASS` för en nivå som
 * inte finns i modellen (den har bytts – hellre dold än öppen), eller
 * undefined när nivån inte kräver något. Avstängd klassning kräver aldrig något.
 */
export function skyddsklassFör(
  inst: Klassningsinställning,
  nivå: string | undefined,
): Skyddsklass | typeof OKÄND_SKYDDSKLASS | undefined {
  if (!inst.på || !nivå) return undefined;
  if (!nivåI(inst.modell, nivå)) return OKÄND_SKYDDSKLASS;
  return inst.skyddsklasser.find((k) => k.nivåer.includes(nivå));
}

/**
 * Klassningen som den lämnas ut till EA-portalen (flödestjänsten): nivån och
 * kravet. Följer med OAVSETT om nivån visas i exporten – vem som får se en
 * bild får aldrig hänga på ett visningsval.
 */
export interface KlassningUtåt {
  nivå: string;
  namn: string;
  /** Skyddsklassens id, "okand", eller null när nivån inte kräver något. */
  skyddsklass: string | null;
  skyddsklassNamn?: string;
}

export function klassningUtåt(inst: Klassningsinställning, k: Klassning | undefined): KlassningUtåt | undefined {
  if (!inst.på || !k) return undefined;
  const klass = skyddsklassFör(inst, k.nivå);
  return {
    nivå: k.nivå,
    namn: nivåI(inst.modell, k.nivå)?.namn ?? k.namn,
    skyddsklass: klass === undefined ? null : klass === OKÄND_SKYDDSKLASS ? klass : klass.id,
    ...(klass && klass !== OKÄND_SKYDDSKLASS ? { skyddsklassNamn: klass.namn } : {}),
  };
}

/** Inställningen som en icke-administratör får se den: utan listorna över behöriga. */
export function utanBehöriga(inst: Klassningsinställning): Klassningsinställning {
  return { ...inst, skyddsklasser: inst.skyddsklasser.map((k) => ({ ...k, behöriga: [] })) };
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
