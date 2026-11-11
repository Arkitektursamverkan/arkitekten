/**
 * Avståndet mellan kolumnerna för de MARKERADE objekten – en regel, en plats
 * (invariant 1) för både flödesschemat och affärsprocessverktyget.
 *
 * Båda layouterna ställer objekten i kolumner (en per rank) med ett fast
 * mellanrum. Användaren markerar objekt och gör mellanrummen mellan dem
 * tätare eller glesare. Faktorn sparas per nod-id i
 * `ProcessDraft.kolumnAvstånd` och gäller avståndet till NÄSTA kolumn.
 *
 * Mellanrummet tillhör kolumnen, inte objektet: står två objekt i samma
 * kolumn (en gren under huvudflödet) delar de mellanrum. Därför sätts faktorn
 * på ALLA objekt i de berörda kolumnerna, och layouten tar den största om de
 * ändå skulle skilja sig (t.ex. efter att ett steg flyttats till en annan
 * kolumn).
 */

/** Tätast: kanterna måste fortfarande få plats att routas mellan objekten. */
export const AVSTÅND_MIN = 0.3;
export const AVSTÅND_MAX = 2;
export const AVSTÅND_STEG = 0.1;

/** Faktorn kläms och avrundas till ett steg, så att +/− alltid går jämnt. */
export function klämAvstånd(faktor: number): number {
  if (!Number.isFinite(faktor)) return 1;
  const k = Math.min(AVSTÅND_MAX, Math.max(AVSTÅND_MIN, faktor));
  // Heltal tiondelar och sedan division: k / 0,1 * 0,1 gav 0,30000000000000004,
  // som både sparades i filen och fick "tätast" att aldrig nås.
  const tiondelar = Math.round(k / AVSTÅND_STEG);
  return tiondelar / Math.round(1 / AVSTÅND_STEG);
}

/**
 * Faktor per kolumn ur objektens `avståndEfter`: den största bland kolumnens
 * objekt som har en, annars 1. Ett ogiltigt värde (ur en sparad fil) kläms.
 */
export function kolumnFaktorer(
  noder: Iterable<{ kolumn: number; avståndEfter?: number }>,
): Map<number, number> {
  const ut = new Map<number, number>();
  for (const n of noder) {
    if (n.avståndEfter === undefined) continue;
    const f = klämAvstånd(n.avståndEfter);
    ut.set(n.kolumn, Math.max(ut.get(n.kolumn) ?? 0, f));
  }
  return ut;
}

/**
 * Objekten vars faktor ska sättas när `valda` är markerade: alla objekt i
 * kolumnerna från den vänstraste markerade fram till (men inte med) den
 * högraste. Mellanrummen EMELLAN de markerade ändras alltså, också de som
 * går genom kolumner där inget är markerat. null = markeringen spänner inte
 * över två kolumner, och det finns inget mellanrum att ändra.
 */
export function avståndsMål(kolumnAv: ReadonlyMap<string, number>, valda: readonly string[]): string[] | null {
  const kolumner = valda.map((id) => kolumnAv.get(id)).filter((k): k is number => k !== undefined);
  if (!kolumner.length) return null;
  const från = Math.min(...kolumner);
  const till = Math.max(...kolumner);
  if (från === till) return null;
  return [...kolumnAv].filter(([, k]) => k >= från && k < till).map(([id]) => id);
}

/** Nuvarande faktor för markeringen: den första målnodens, annars 1. */
export function avståndFör(mål: readonly string[], kolumnAvstånd: Record<string, number> | undefined): number {
  for (const id of mål) {
    const f = kolumnAvstånd?.[id];
    if (f !== undefined) return klämAvstånd(f);
  }
  return 1;
}
