/**
 * FIGURFÖRTECKNINGEN – vad symbolerna i en bild betyder.
 *
 * Kontraktet bor i `core/` därför att förteckningen har TVÅ mottagare: appens
 * egen faktaruta (`shell/Figurforteckning.tsx`) och SCENEN som lämnar huset
 * till EA-portalen (`core/scen.ts`). Räknade de två fram sin lista var för sig
 * skulle portalen förr eller senare förklara en symbol som Arkitekten ritar
 * annorlunda – precis den glidning invariant 1 finns för att förhindra.
 *
 * Symbolen bärs därför som FÄRDIG SVG, av samma skäl som `ScenNod.svg`: form,
 * färg och proportioner är redan valda av `former.ts` respektive `theme.ts`,
 * och en mottagare som ritar om dem ur data ritar något annat än bilden visar.
 * Fragmentet står i lokala koordinater 0,0–w×h och är SJÄLVSTÄNDIGT – det
 * refererar inga `defs`, så det går att rita var som helst, också utanför
 * ritytan där pilspetsarnas markörer inte finns.
 */

export interface Figur {
  /** Stabil nyckel – symbolens egen typ ("aktivitet", "huki-U"), aldrig ett löpnummer. */
  nyckel: string;
  /** Symbolens namn. */
  namn: string;
  /** Vad symbolen betyder i processen. */
  betydelse: string;
  /** Hur många det finns i bilden. */
  antal: number;
  /** Symbolen färdigritad i lokala koordinater 0,0–w×h. */
  svg: string;
  w: number;
  h: number;
}

export interface FigurGrupp {
  titel: string;
  figurer: Figur[];
  /** Något som gäller hela gruppen – t.ex. att HUKI bärs av färgen. */
  hint?: string;
}

/** Måttet ett linjeprov ritas i. */
export const LINJE_MÅTT = { w: 30, h: 14 } as const;

export interface LinjeIkonVal {
  färg: string;
  /** `stroke-dasharray`, för de kopplingar som faktiskt är streckade. */
  streckad?: string;
  /** Öppen (V-formad) spets i stället för fylld triangel. */
  öppenSpets?: boolean;
}

/**
 * Ett linjeprov: kopplingens färg och streckning med sin pilspets.
 *
 * Spetsen ritas som en egen `<path>` och INTE med `marker-end`. En markör
 * skulle kräva att mottagarens dokument har rätt `defs` – det har ritytan men
 * inte en faktaruta i en verktygsrad, och inte heller portalens
 * teckenförklaring om den ligger utanför scenens `<svg>`. En pilspets som
 * ibland försvinner är sämre än en som alltid ritas.
 */
export function linjeIkon({ färg, streckad, öppenSpets }: LinjeIkonVal): Figur["svg"] {
  const streck = `<line x1="1" y1="7" x2="${streckad ? 24 : 22}" y2="7" stroke="${färg}" stroke-width="1.8"${
    streckad ? ` stroke-dasharray="${streckad}"` : ""
  }/>`;
  const spets = öppenSpets
    ? `<path d="M22,3.2 L28.4,7 L22,10.8" fill="none" stroke="${färg}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M21.5,3 L29,7 L21.5,11 Z" fill="${färg}"/>`;
  return streck + spets;
}

/**
 * Lägger en form i en ruta med luft omkring, så konturen inte kapas av
 * fragmentets egen kant. Måtten växer med marginalen – fragmentet ska alltid
 * rymmas inom 0,0–w×h, annars kan mottagaren inte sätta en viewBox utan att
 * känna till våra marginaler.
 */
export function medMarginal(svg: string, w: number, h: number, m = 2) {
  return { svg: `<g transform="translate(${m},${m})">${svg}</g>`, w: w + m * 2, h: h + m * 2 };
}
