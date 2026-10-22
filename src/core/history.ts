/**
 * Ångra/gör om för mellanlagret.
 *
 * Draften är oföränderlig – varje ändring ger ett nytt objekt – så historiken
 * behöver inte veta någonting om VAD som ändrades. Den sparar hela tillstånd.
 * Det är billigt nog: en draft är några tiotal kilobyte, och gränsen håller
 * minnet i schack.
 *
 * En finess: ändringar som kommer tätt slås ihop. Utan det blev varje pixel i
 * ett drag ett eget ångra-steg, och en enda flytt krävde hundra tryck på
 * ångra för att ta tillbaka.
 */

/** Så många steg bakåt går det att ångra. */
export const HISTORY_LIMIT = 100;

/** Ändringar närmare varandra än så räknas som en enda (ms). */
export const HISTORY_MERGE_MS = 400;

export interface History<T> {
  /** Nuvarande tillstånd. */
  nuvarande: T;
  /** Äldre tillstånd, äldst först. */
  bakåt: T[];
  /** Ångrade tillstånd, närmast först. */
  framåt: T[];
  /** När `nuvarande` sattes – styr sammanslagningen. */
  stämpel: number;
}

export function skapaHistorik<T>(start: T): History<T> {
  return { nuvarande: start, bakåt: [], framåt: [], stämpel: 0 };
}

/**
 * Lägger ett nytt tillstånd i historiken.
 *
 * `nu` är tidsstämpeln (skickas in så funktionen förblir ren och testbar).
 * Kommer ändringen tätt inpå den förra ersätts den i stället för att läggas
 * till – annars blir ett musdrag hundra ångra-steg.
 */
export function lägg<T>(h: History<T>, nästa: T, nu: number): History<T> {
  if (Object.is(nästa, h.nuvarande)) return h;
  const slåIhop = h.bakåt.length > 0 && nu - h.stämpel < HISTORY_MERGE_MS;
  const bakåt = slåIhop ? h.bakåt : [...h.bakåt, h.nuvarande].slice(-HISTORY_LIMIT);
  return { nuvarande: nästa, bakåt, framåt: [], stämpel: nu };
}

/**
 * Lägger ett tillstånd som ALLTID blir ett eget ångra-steg.
 *
 * Används för hela hopp – att öppna ett flöde, tolka om texten, återställa –
 * där sammanslagning med föregående ändring vore fel.
 */
export function läggBrytpunkt<T>(h: History<T>, nästa: T, nu: number): History<T> {
  if (Object.is(nästa, h.nuvarande)) return h;
  return {
    nuvarande: nästa,
    bakåt: [...h.bakåt, h.nuvarande].slice(-HISTORY_LIMIT),
    framåt: [],
    stämpel: nu,
  };
}

export function kanÅngra<T>(h: History<T>): boolean {
  return h.bakåt.length > 0;
}

export function kanGöraOm<T>(h: History<T>): boolean {
  return h.framåt.length > 0;
}

export function ångra<T>(h: History<T>): History<T> {
  if (!h.bakåt.length) return h;
  const bakåt = h.bakåt.slice(0, -1);
  const nuvarande = h.bakåt[h.bakåt.length - 1];
  return { nuvarande, bakåt, framåt: [h.nuvarande, ...h.framåt], stämpel: 0 };
}

export function göraOm<T>(h: History<T>): History<T> {
  if (!h.framåt.length) return h;
  const [nuvarande, ...framåt] = h.framåt;
  return { nuvarande, bakåt: [...h.bakåt, h.nuvarande].slice(-HISTORY_LIMIT), framåt, stämpel: 0 };
}
