/**
 * KATEGORIREGISTRET – kategorier som finns utan att någon process ligger i
 * dem än, och förslag på nya.
 *
 * En kategori i katalogen är annars bara ett fält på processerna
 * (core/flow-tree.ts): den finns så länge något ligger i den. Det räcker inte
 * när strukturen ska kunna läggas upp i förväg, eller när den som inte får
 * ändra i den gemensamma katalogen ska kunna be om en ny kategori. Registret
 * är tillägget – trädet byggs som förut ur processerna, och registret fyller
 * på med det som ännu är tomt.
 *
 * REGLERNA (en regel, en plats – bryggan verkställer, appen frågar samma
 * funktioner):
 *  - En kategori i den GEMENSAMMA katalogen skapas av en administratör.
 *  - Var och en skapar kategorier i sin EGNA katalog (Mina processer).
 *  - Alla inloggade kan FÖRESLÅ en kategori i den gemensamma katalogen. En
 *    administratör godkänner (kategorin skapas) eller avslår (förslaget tas
 *    bort). Förslagen ser administratörerna, och den som föreslog sitt eget.
 *
 * Modulen är beroendefri, som core/behorighet.ts: både bryggan och
 * webbläsaren laddar den.
 */

import { ärAdmin, type Användare, type Yta, type Ägare } from "./behorighet";

export interface Kategoripost {
  namn: string;
  /** Ägaren av en kategori i en egen katalog. Saknas = gemensam katalog. */
  ägare?: Ägare;
  skapadAv?: Ägare;
  skapadAt: string;
}

export interface Kategoriförslag {
  id: string;
  namn: string;
  motivering?: string;
  föreslagenAv: Ägare;
  föreslagenAt: string;
}

export interface Kategoriregister {
  kategorier: Kategoripost[];
  förslag: Kategoriförslag[];
}

export const TOMT_REGISTER: Kategoriregister = { kategorier: [], förslag: [] };

export const KATEGORI_MAX = { namn: 80, motivering: 400, poster: 500 } as const;

export type Utfall<T> = { ok: true; värde: T } | { ok: false; status: number; fel: string };
const nej = (status: number, fel: string) => ({ ok: false as const, status, fel });

/** Namnet som det sparas: utan styrtecken, ihopdragna blanktecken, kapat. */
export function kategorinamn(rå: unknown): string {
  if (typeof rå !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return rå.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, KATEGORI_MAX.namn);
}

/** Två namn är samma kategori när de bara skiljer sig i skiftläge och blanktecken. */
export const sammaKategori = (a: string, b: string) => kategorinamn(a).toLowerCase() === kategorinamn(b).toLowerCase();

function person(rå: unknown): Ägare | undefined {
  const p = rå as Partial<Ägare> | null | undefined;
  return p && typeof p === "object" && typeof p.id === "string" && p.id
    ? { id: p.id.slice(0, 200), namn: typeof p.namn === "string" ? p.namn.slice(0, 200) : "" }
    : undefined;
}
const tid = (rå: unknown) => (typeof rå === "string" && !Number.isNaN(Date.parse(rå)) ? rå : new Date(0).toISOString());
const lista = (rå: unknown): Record<string, unknown>[] =>
  (Array.isArray(rå) ? rå : []).filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object").slice(0, KATEGORI_MAX.poster);

/** Registret ur något som kommit utifrån (filen). Allt okänt eller trasigt faller bort. */
export function läsKategoriregister(rå: unknown): Kategoriregister {
  const r = (rå && typeof rå === "object" ? rå : {}) as Record<string, unknown>;
  const kategorier: Kategoripost[] = [];
  for (const p of lista(r.kategorier)) {
    const namn = kategorinamn(p.namn);
    const ägare = person(p.ägare);
    if (!namn || kategorier.some((k) => sammaKategori(k.namn, namn) && k.ägare?.id === ägare?.id)) continue;
    const skapadAv = person(p.skapadAv);
    kategorier.push({ namn, ...(ägare ? { ägare } : {}), ...(skapadAv ? { skapadAv } : {}), skapadAt: tid(p.skapadAt) });
  }
  const förslag: Kategoriförslag[] = [];
  for (const p of lista(r.förslag)) {
    const namn = kategorinamn(p.namn);
    const föreslagenAv = person(p.föreslagenAv);
    if (!namn || !föreslagenAv || typeof p.id !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(p.id)) continue;
    if (förslag.some((f) => f.id === p.id)) continue;
    const motivering = typeof p.motivering === "string" ? p.motivering.trim().slice(0, KATEGORI_MAX.motivering) : "";
    förslag.push({ id: p.id, namn, ...(motivering ? { motivering } : {}), föreslagenAv, föreslagenAt: tid(p.föreslagenAt) });
  }
  return { kategorier, förslag };
}

/** Det användaren får se: de gemensamma kategorierna och sina egna; förslagen som administratör, annars bara sina. */
export function registretFör(reg: Kategoriregister, u: Användare): Kategoriregister {
  return {
    kategorier: reg.kategorier.filter((k) => !k.ägare || k.ägare.id === u.id),
    förslag: reg.förslag.filter((f) => ärAdmin(u) || f.föreslagenAv.id === u.id),
  };
}

/** De registrerade kategorierna i en yta, så som användaren ser dem. */
export function registreradeTitlar(reg: Kategoriregister, u: Användare | null | undefined, yta: Yta): string[] {
  return reg.kategorier
    .filter((k) => (yta === "gemensam" ? !k.ägare : Boolean(u && k.ägare?.id === u.id)))
    .map((k) => k.namn);
}

/** Får användaren skapa en kategori direkt i ytan? Gemensam: administratören. Egen: alla. */
export function kanSkapaKategori(u: Användare | null | undefined, yta: Yta): boolean {
  if (!u) return false;
  return yta === "egen" || ärAdmin(u);
}

/**
 * Skapar en kategori. `finns` är namnen på de kategorier som redan finns i
 * ytan genom sina processer – en kategori med samma namn skapas inte en gång till.
 */
export function skapaKategori(
  reg: Kategoriregister,
  u: Användare,
  val: { namn: unknown; yta: unknown },
  finns: string[],
  nu: string,
): Utfall<Kategoriregister> {
  const yta = val.yta === "egen" ? "egen" : val.yta === "gemensam" ? "gemensam" : null;
  if (!yta) return nej(400, "Okänd yta.");
  const namn = kategorinamn(val.namn);
  if (!namn) return nej(400, "Kategorin behöver ett namn.");
  if (!kanSkapaKategori(u, yta))
    return nej(403, "Bara administratörer skapar kategorier i den gemensamma katalogen. Föreslå kategorin i stället.");
  const iYtan = [...finns, ...registreradeTitlar(reg, u, yta)];
  if (iYtan.some((k) => sammaKategori(k, namn))) return nej(409, `Kategorin ”${namn}” finns redan.`);
  if (reg.kategorier.length >= KATEGORI_MAX.poster) return nej(400, "Registret är fullt.");
  const jag = { id: u.id, namn: u.namn };
  const post: Kategoripost = { namn, ...(yta === "egen" ? { ägare: jag } : {}), skapadAv: jag, skapadAt: nu };
  return { ok: true, värde: { ...reg, kategorier: [...reg.kategorier, post] } };
}

/** Tar bort en REGISTRERAD kategori (en tom – processerna i en kategori rörs aldrig härifrån). */
export function taBortKategori(reg: Kategoriregister, u: Användare, val: { namn: unknown; yta: unknown }): Utfall<Kategoriregister> {
  const yta = val.yta === "egen" ? "egen" : val.yta === "gemensam" ? "gemensam" : null;
  if (!yta) return nej(400, "Okänd yta.");
  if (!kanSkapaKategori(u, yta)) return nej(403, "Bara administratörer tar bort kategorier i den gemensamma katalogen.");
  const namn = kategorinamn(val.namn);
  const träff = (k: Kategoripost) => sammaKategori(k.namn, namn) && (yta === "gemensam" ? !k.ägare : k.ägare?.id === u.id);
  if (!reg.kategorier.some(träff)) return nej(404, "Kategorin finns inte i registret.");
  return { ok: true, värde: { ...reg, kategorier: reg.kategorier.filter((k) => !träff(k)) } };
}

/** Föreslår en kategori i den gemensamma katalogen. `id` ges av bryggan. */
export function föreslåKategori(
  reg: Kategoriregister,
  u: Användare,
  val: { namn: unknown; motivering?: unknown },
  finns: string[],
  nu: string,
  id: string,
): Utfall<Kategoriregister> {
  const namn = kategorinamn(val.namn);
  if (!namn) return nej(400, "Kategorin behöver ett namn.");
  if ([...finns, ...registreradeTitlar(reg, u, "gemensam")].some((k) => sammaKategori(k, namn)))
    return nej(409, `Kategorin ”${namn}” finns redan i den gemensamma katalogen.`);
  if (reg.förslag.some((f) => sammaKategori(f.namn, namn))) return nej(409, `Kategorin ”${namn}” är redan föreslagen.`);
  if (reg.förslag.length >= KATEGORI_MAX.poster) return nej(400, "Det finns för många obehandlade förslag.");
  const motivering = typeof val.motivering === "string" ? val.motivering.trim().slice(0, KATEGORI_MAX.motivering) : "";
  const förslag: Kategoriförslag = {
    id,
    namn,
    ...(motivering ? { motivering } : {}),
    föreslagenAv: { id: u.id, namn: u.namn },
    föreslagenAt: nu,
  };
  return { ok: true, värde: { ...reg, förslag: [...reg.förslag, förslag] } };
}

/**
 * Administratörens beslut. Godkänt: kategorin skapas i den gemensamma
 * katalogen (om den inte hunnit skapas ändå). Förslaget tas bort i båda fallen.
 * Den som föreslog kan dra tillbaka sitt eget förslag (`godkänn` false).
 */
export function beslutaFörslag(
  reg: Kategoriregister,
  u: Användare,
  id: string,
  godkänn: boolean,
  finns: string[],
  nu: string,
): Utfall<Kategoriregister> {
  const förslag = reg.förslag.find((f) => f.id === id);
  if (!förslag) return nej(404, "Förslaget finns inte.");
  const eget = förslag.föreslagenAv.id === u.id;
  if (!ärAdmin(u) && !(eget && !godkänn)) return nej(403, "Bara administratörer beslutar om förslag.");
  const kvar = reg.förslag.filter((f) => f.id !== id);
  if (!godkänn) return { ok: true, värde: { ...reg, förslag: kvar } };
  const redan = [...finns, ...registreradeTitlar(reg, u, "gemensam")].some((k) => sammaKategori(k, förslag.namn));
  const post: Kategoripost = { namn: förslag.namn, skapadAv: förslag.föreslagenAv, skapadAt: nu };
  return { ok: true, värde: { kategorier: redan ? reg.kategorier : [...reg.kategorier, post], förslag: kvar } };
}
