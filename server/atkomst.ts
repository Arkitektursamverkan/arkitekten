/**
 * Serverns prövning av skrivningar i biblioteket – det bryggan gör innan en
 * fil i flows/ eller ramar/ skrivs. Rena funktioner (ingen disk, ingen HTTP)
 * så att varje regel kan bevisas med ett test.
 *
 * Reglerna själva bor i src/core/behorighet.ts. Här står det som bara servern
 * kan avgöra: vad som redan ligger i filen, och att ÄGARFÄLTEN (`ägare`,
 * `skapadAv`) och PUBLICERINGEN (`publicering`) aldrig följer med en vanlig
 * sparning från webbläsaren.
 */

import { läsPublicering } from "../src/core/publicering";
import {
  DEMO_KATEGORI,
  kanByttaYta,
  kanPublicera,
  kanRedigera,
  kanSkapa,
  ytaFör,
  ägareVidSkapande,
  type Användare,
  type HarSkapare,
  type HarYta,
  type Inloggningsläge,
  type Yta,
  type Ägare,
} from "../src/core/behorighet";

type Flöde = HarYta & {
  subcategory?: string;
  versions?: Array<{ id?: string; savedAt?: string; savedBy?: string }>;
  [k: string]: unknown;
};

export type Prövning<T> = { ok: true; värde: T } | { ok: false; status: number; fel: string };

const nej = (status: number, fel: string) => ({ ok: false as const, status, fel });

/** En ägare/skapare ur en fil – `undefined` om fältet saknas eller är trasigt. */
function personI(ä: unknown): Ägare | undefined {
  const p = ä as Partial<Ägare> | undefined;
  return p && typeof p.id === "string" ? { id: p.id, namn: String(p.namn ?? "") } : undefined;
}

/**
 * En PUT av ett helt flöde. Ger det som ska skrivas, eller varför inte.
 *
 * - Ägaren tas ALLTID ur filen (eller, för ett nytt flöde, ur reglerna) –
 *   aldrig ur begäran. Skaparen likaså: den som sparar ett NYTT flöde, och
 *   därefter det som står i filen. Ägaren byts när processen flyttas mellan
 *   ytor; skaparen står still för alltid. Flöden från före fältet har ingen. En klient som tappade fältet hade annars i tysthet
 *   flyttat en egen process till den gemensamma katalogen.
 * - Publiceringen tas likaså ur filen, aldrig ur begäran: den skrivs bara av
 *   `prövaPublicering` (admin + gemensam katalog, samma regel som
 *   `kanPublicera`). REGRESSION: en vanlig PUT bar publiceringen, så den som
 *   fick spara i Demo kunde skicka ut en process till EA-portalen.
 * - Byter sparningen yta ändå (kategorin sattes till eller från Demo) prövas
 *   det som ett byte av yta – och publiceringen följer inte med ut ur den
 *   gemensamma katalogen.
 * - Historiken får inte ha tappat filens senaste version. Två personer som
 *   sparar samma process samtidigt hade annars skrivit över varandras
 *   versioner (invariant 11) – den som kommer sist får ladda om i stället.
 */
export function prövaSparning(
  u: Användare,
  läge: Inloggningsläge,
  befintlig: Flöde | null,
  ny: Flöde,
): Prövning<Flöde> {
  const { ägare: _ignorerad, skapadAv: _ocksåIgnorerad, publicering: _serverns, ...kropp } = ny;
  if (!befintlig) {
    const ägare = ägareVidSkapande(u, läge, kropp);
    // I öppen drift finns bara den lokala användaren – ett namn som inte säger något.
    const skapadAv = läge === "öppen" ? undefined : { id: u.id, namn: u.namn };
    const ut: Flöde = { ...kropp, ...(ägare ? { ägare } : {}), ...(skapadAv ? { skapadAv } : {}) };
    if (!kanSkapa(u, ut))
      return nej(403, "Bara administratörer kan lägga processer direkt i den gemensamma katalogen.");
    return { ok: true, värde: stämplaSignatur(ut, u, läge, 0) };
  }

  if (!kanRedigera(u, befintlig))
    return nej(
      403,
      ytaFör(befintlig) === "gemensam"
        ? "Den gemensamma katalogen ändras bara av administratörer."
        : "Du har inte behörighet att ändra den här processen.",
    );

  const ägare = personI(befintlig.ägare);
  const skapadAv = personI(befintlig.skapadAv);
  const ut: Flöde = { ...kropp, ...(ägare ? { ägare } : {}), ...(skapadAv ? { skapadAv } : {}) };
  const till = ytaFör(ut);
  if (till !== ytaFör(befintlig) && !kanByttaYta(u, befintlig, till))
    return nej(403, `Du kan inte flytta processen till ${till === "demo" ? "Demo" : "den ytan"}.`);
  // Filens publicering står kvar – så länge processen ligger kvar i den gemensamma katalogen.
  if (befintlig.publicering !== undefined && till === "gemensam") ut.publicering = befintlig.publicering;

  const sista = befintlig.versions?.[befintlig.versions.length - 1];
  if (sista?.id && Array.isArray(ut.versions)) {
    const finns = ut.versions.some((v) => v.id === sista.id && v.savedAt === sista.savedAt);
    if (!finns)
      return nej(
        409,
        "Processen har sparats av någon annan sedan du öppnade den. Ladda om den – din ändring är inte sparad.",
      );
  }
  return { ok: true, värde: stämplaSignatur(ut, u, läge, befintlig.versions?.length ?? 0) };
}

/**
 * En NY version utan signatur får den inloggades namn. Med inloggning vet vi
 * vem som sparade – fältet i panelen behöver inte fyllas i för hand. Äldre
 * versioner rörs aldrig.
 */
function stämplaSignatur(f: Flöde, u: Användare, läge: Inloggningsläge, antalFöre: number): Flöde {
  if (läge === "öppen" || !Array.isArray(f.versions) || f.versions.length <= antalFöre) return f;
  const versions = f.versions.map((v, i) =>
    i >= antalFöre && !v.savedBy?.trim() ? { ...v, savedBy: u.namn } : v,
  );
  return { ...f, versions };
}

export interface YtByte {
  till: Yta;
  category?: string;
  subcategory?: string;
}

/**
 * Byter yta: egen → gemensam är den vanliga vägen ("dela när den är klar").
 * Som en flytt i katalogen (invariant 11, undantaget PLACERINGEN): posten
 * SPRIDS, historiken och `savedAt` står still, ingen ny version.
 */
export function bytYta(u: Användare, befintlig: Flöde, byte: YtByte): Prövning<Flöde> {
  if (!["gemensam", "demo", "egen"].includes(byte.till)) return nej(400, "Okänd yta.");
  if (!kanByttaYta(u, befintlig, byte.till))
    return nej(403, "Du har inte behörighet att flytta processen dit.");
  // Publiceringen följer inte med: bara den gemensamma katalogen publiceras
  // (kanPublicera), och en process som flyttats dit igen publiceras på nytt.
  const { ägare: _gammal, publicering: _publicering, ...kropp } = befintlig;
  const kategori = byte.category?.trim() || undefined;
  const under = byte.subcategory === undefined ? befintlig.subcategory : byte.subcategory.trim() || undefined;
  const utanDemo = (k: string | undefined) =>
    k && k.toLowerCase() === DEMO_KATEGORI.toLowerCase() ? undefined : k;
  switch (byte.till) {
    case "egen":
      return {
        ok: true,
        värde: {
          ...kropp,
          ägare: { id: u.id, namn: u.namn },
          category: utanDemo(kategori ?? befintlig.category),
          subcategory: under,
        },
      };
    case "demo":
      return { ok: true, värde: { ...kropp, category: DEMO_KATEGORI, subcategory: under } };
    case "gemensam":
      return {
        ok: true,
        värde: { ...kropp, category: utanDemo(kategori ?? befintlig.category), subcategory: under },
      };
  }
}

/**
 * Publicerar (eller avpublicerar, `null`) en process i EA-portalen.
 *
 * Bara administratören, och bara i den gemensamma katalogen – `kanPublicera`,
 * samma regel som gömmer knappen. Som placeringen (invariant 11): posten
 * SPRIDS, ingen ny version och ingen ny `savedAt`.
 */
export function prövaPublicering(u: Användare, befintlig: Flöde, publicering: unknown): Prövning<Flöde> {
  if (!kanPublicera(u, befintlig))
    return nej(403, "Bara administratörer publicerar, och bara processer i den gemensamma katalogen.");
  if (publicering === null) {
    const { publicering: _borttagen, ...resten } = befintlig;
    return { ok: true, värde: resten };
  }
  const p = läsPublicering(publicering);
  if (!p) return nej(400, "Publiceringen saknar nod, processägare eller beskrivning.");
  return { ok: true, värde: { ...befintlig, publicering: p } };
}

/** Ramserien som ska skrivas: skaparen sätts vid skapandet och följer sedan med. */
export function prövaRamserie<T extends HarSkapare>(
  u: Användare,
  befintlig: HarSkapare | null,
  ny: T,
): T {
  const { skapadAv: _ignorerad, ...kropp } = ny;
  const skapadAv = befintlig ? befintlig.skapadAv : { id: u.id, namn: u.namn };
  return (skapadAv ? { ...kropp, skapadAv } : kropp) as T;
}
