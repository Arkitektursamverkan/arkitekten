/**
 * PRODUKTENS EGNA SYMBOLER – standardstilens former, en per objektsort.
 *
 * Skrivna i samma form som ett stilpakets (`symbolform.ts`), så att en
 * installation som vill ha egna symboler har ett komplett exempel att utgå
 * från. Ikonerna ritas i ikonzonen överst i rutan (ca 28 × 28 kring mitten);
 * rutformerna (process, aktivitet, krav, forum) fyller hela sin ruta.
 */

import type { Mått, Symbol } from "./symbolform";

/** Ett x-läge räknat från symbolens mitt. */
const X = (dx: number): Mått => [dx, 0.5];
/** Ett läge räknat från höger- respektive underkanten. */
const H = (dx: number): Mått => [dx, 1];
const N = (dy: number): Mått => [dy, 0, 1];

/** Pratbubblans kropp slutar här; resten av höjden är svansen (se `FORUM_SVANS`). */
const KROPP = (dy: number): Mått => [dy, 0, 0.82];

export type Symbolnyckel =
  | "process" | "aktivitet" | "vo" | "vo:dokument" | "vo:meddelande" | "regel" | "roll" | "intressent"
  | "applikation" | "arkiv" | "krav" | "tid" | "forum" | "plats" | "problem" | "risk" | "mojlighet";

const person: Symbol = [
  { form: "cirkel", x: X(0), y: 10.5, r: 5.8, linje: "linje", bredd: 1.2 },
  {
    form: "bana",
    d: ["M", X(-11), 27.5, "C", X(-11), 20, X(-6.5), 17.5, X(0), 17.5, "C", X(6.5), 17.5, X(11), 20, X(11), 27.5, "Z"],
    linje: "linje",
    bredd: 1.2,
  },
];

export const STANDARDSYMBOLER: Record<Symbolnyckel, Symbol> = {
  // Delprocessen: en ruta med dubbla sidolinjer – "här finns mer att öppna".
  process: [
    { form: "rektangel", x: 0.8, y: 0.8, b: H(-1.6), h: N(-1.6), r: 3, linje: "linje", bredd: 1.6 },
    { form: "linje", x1: 9, y1: 0.8, x2: 9, y2: N(-0.8), linje: "linje", bredd: 1.3 },
    { form: "linje", x1: H(-9), y1: 0.8, x2: H(-9), y2: N(-0.8), linje: "linje", bredd: 1.3 },
  ],
  // Aktiviteten: en ruta med en markerad vänsterkant.
  aktivitet: [
    { form: "rektangel", x: 0.5, y: 0.5, b: H(-1), h: N(-1), r: 4, linje: "linje", bredd: 1 },
    {
      form: "bana",
      d: ["M", 4.5, 0.5, "H", 6.5, "V", N(-0.5), "H", 4.5, "A", 4, 4, 0, 0, 1, 0.5, N(-4.5), "V", 4.5, "A", 4, 4, 0, 0, 1, 4.5, 0.5, "Z"],
      fyll: "linje",
    },
  ],
  // Verksamhetsobjektet: en lutad ruta – det som lämnas vidare.
  vo: [{ form: "polygon", punkter: [X(-9), 6, X(14), 6, X(9), 26, X(-14), 26], linje: "linje", bredd: 1.4, rund: true }],
  // Dokument: ett blad med vågig underkant och två textrader.
  "vo:dokument": [
    { form: "bana", d: ["M", X(-11), 4, "h", 22, "v", 20, "q", -5.5, -5, -11, 0, "t", -11, 0, "Z"], linje: "linje", bredd: 1.4, rund: true },
    { form: "linje", x1: X(-6), y1: 10, x2: X(6), y2: 10, linje: "linje", bredd: 1.1, rund: true },
    { form: "linje", x1: X(-6), y1: 14.5, x2: X(3), y2: 14.5, linje: "linje", bredd: 1.1, rund: true },
  ],
  // Meddelande: ett kuvert.
  "vo:meddelande": [
    { form: "rektangel", x: X(-12), y: 7, b: 24, h: 17, r: 2, linje: "linje", bredd: 1.4 },
    { form: "linjer", punkter: [X(-11), 8.5, X(0), 17, X(11), 8.5], linje: "linje", bredd: 1.3, rund: true },
  ],
  // Regeln: en liggande romb med en punkt – vägvalet.
  regel: [
    { form: "polygon", punkter: [X(0), 5, X(15), 16, X(0), 27, X(-15), 16], linje: "linje", bredd: 1.4, rund: true },
    { form: "cirkel", x: X(0), y: 16, r: 2.6, fyll: "linje" },
  ],
  roll: person,
  intressent: person,
  // IT-stödet: ett programfönster.
  applikation: [
    { form: "rektangel", x: X(-13), y: 5, b: 26, h: 22, r: 3, linje: "linje", bredd: 1.3 },
    { form: "bana", d: ["M", X(-13), 11.5, "V", 8, "a", 3, 3, 0, 0, 1, 3, -3, "h", 20, "a", 3, 3, 0, 0, 1, 3, 3, "V", 11.5, "Z"], fyll: "ljus", linje: "linje", bredd: 1.3 },
    { form: "cirkel", x: X(-9.3), y: 8.3, r: 1, fyll: "linje" },
    { form: "cirkel", x: X(-6), y: 8.3, r: 1, fyll: "linje" },
  ],
  // Arkivet: en mapp.
  arkiv: [
    { form: "bana", d: ["M", X(-13), 8, "h", 8, "l", 3, 3.5, "h", 15, "v", 15.5, "h", -26, "Z"], linje: "linje", bredd: 1.3, rund: true },
    { form: "linje", x1: X(-13), y1: 15, x2: X(13), y2: 15, linje: "linje", bredd: 1.1 },
  ],
  // Kravet: en ruta med fasade hörn.
  krav: [
    {
      form: "polygon",
      punkter: [8, 1, H(-8), 1, H(-1), 8, H(-1), N(-8), H(-8), N(-1), 8, N(-1), 1, N(-8), 1, 8],
      linje: "linje",
      bredd: 1.6,
      rund: true,
    },
  ],
  // Tiden: ett kalenderblad.
  tid: [
    { form: "rektangel", x: X(-11), y: 6, b: 22, h: 21, r: 2.5, linje: "linje", bredd: 1.5 },
    { form: "linje", x1: X(-11), y1: 12.5, x2: X(11), y2: 12.5, linje: "linje", bredd: 1.3 },
    { form: "linje", x1: X(-5), y1: 3.5, x2: X(-5), y2: 8.5, linje: "linje", bredd: 1.5, rund: true },
    { form: "linje", x1: X(5), y1: 3.5, x2: X(5), y2: 8.5, linje: "linje", bredd: 1.5, rund: true },
    { form: "rektangel", x: X(1.5), y: 17, b: 5, h: 5, r: 1, fyll: "linje" },
  ],
  // Forum: en kantig pratbubbla – aktiviteten sker alltid som ett möte.
  forum: [
    {
      form: "bana",
      d: [
        "M", 13, 1, "H", H(-13), "A", 12, 12, 0, 0, 1, H(-1), 13, "V", KROPP(-13), "A", 12, 12, 0, 0, 1, H(-13), KROPP(-1),
        "H", [0, 0.51], "L", [0, 0.29], N(-1), "L", [0, 0.35], KROPP(-1),
        "H", 13, "A", 12, 12, 0, 0, 1, 1, KROPP(-13), "V", 13, "A", 12, 12, 0, 0, 1, 13, 1, "Z",
      ],
      linje: "linje",
      bredd: 1.6,
      rund: true,
    },
  ],
  // Platsen: ett hus.
  plats: [
    { form: "polygon", punkter: [X(0), 3.5, X(13), 14.5, X(9), 14.5, X(9), 27, X(-9), 27, X(-9), 14.5, X(-13), 14.5], linje: "linje", bredd: 1.4, rund: true },
    { form: "rektangel", x: X(-2.5), y: 19, b: 5, h: 8, fyll: "#ffffff" },
  ],
  // Problemet: en åttahörning med utropstecken.
  problem: [
    { form: "polygon", punkter: [X(-5), 2, X(5), 2, X(12), 9, X(12), 19, X(5), 26, X(-5), 26, X(-12), 19, X(-12), 9], linje: "linje", bredd: 1.8, rund: true },
    { form: "tecken", x: X(0), y: 19.3, tecken: "!", storlek: 15, fet: true },
  ],
  // Risken: en sköld med utropstecken.
  risk: [
    { form: "bana", d: ["M", X(0), 2, "L", X(11.5), 6, "V", 15, "C", X(11.5), 21.5, X(6), 25.5, X(0), 28, "C", X(-6), 25.5, X(-11.5), 21.5, X(-11.5), 15, "V", 6, "Z"], linje: "linje", bredd: 1.6, rund: true },
    { form: "tecken", x: X(0), y: 20, tecken: "!", storlek: 13, fet: true },
  ],
  // Möjligheten: en glödlampa.
  mojlighet: [
    { form: "cirkel", x: X(0), y: 11.5, r: 9, linje: "linje", bredd: 1.7 },
    { form: "rektangel", x: X(-4), y: 20.5, b: 8, h: 6.5, r: 1.5, linje: "linje", bredd: 1.5 },
    { form: "linje", x1: X(-4), y1: 23.7, x2: X(4), y2: 23.7, linje: "linje", bredd: 1.1 },
  ],
};

/** Pilspetsen, ritad i en ruta 10 × 10 med udden i (10, 5): en spets med inskuren bas. */
export const STANDARDPILSPETS: (string | number)[] = ["M", 0, 0.5, "L", 10, 5, "L", 0, 9.5, "L", 3, 5, "Z"];
