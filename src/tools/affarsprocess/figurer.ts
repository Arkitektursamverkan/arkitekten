/**
 * Figurförteckningen för verktyget Affärsprocess: vilka symboler och vilka
 * ansvarsfärger som FAKTISKT står i den öppna processen.
 *
 * Allt läses ur `former.ts` – formerna, namnen, betydelserna och färgerna.
 * Förteckningen hittar aldrig på en symbol själv; gjorde den det kunde
 * faktarutan påstå att den gula linjen betyder något annat än vad ritytan
 * ritar (invarianten "en regel, en plats").
 *
 * REN DATA, inga React-element: samma lista visas i appens faktaruta OCH
 * följer med i scenen ut till EA-portalen (`core/figurer.ts`, `core/scen.ts`),
 * så att portalens teckenförklaring inte kan förklara något annat än det
 * Arkitekten ritade.
 */

import type { ApModel, ApNodeKind } from "@/core/affarsprocess";
import type { Huki } from "@/core/draft";
import { linjeIkon, medMarginal, LINJE_MÅTT, type FigurGrupp } from "@/core/figurer";
import {
  apShapeSvg,
  hukiFärg,
  AP_RELATION_BETYDELSE,
  AP_RELATION_LABEL,
  relationsFärg,
  AP_TYPE_BETYDELSE,
  AP_TYPE_LABEL,
  HUKI_LABEL,
  HUKI_MENING,
} from "./former";
import { AP_DIMS } from "./layout-affarsprocess";

/**
 * Metodens ordning – samma som namnkartan deklareras i. Kedjan först
 * (process, aktivitet, verksamhetsobjekt, regel), sedan satelliterna. En egen
 * lista här hade blivit en fjärde uppräkning av samma sexton former att hålla
 * i takt med de andra.
 */
const ORDNING = Object.keys(AP_TYPE_LABEL) as ApNodeKind[];

/** Bokstäverna i ordning – H först, I sist. */
const HUKI_ORDNING: Huki[] = ["H", "U", "K", "I"];

/** Räknar hur många av varje sort en lista innehåller. */
function räkna<T extends string>(nycklar: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const n of nycklar) m.set(n, (m.get(n) ?? 0) + 1);
  return m;
}

/**
 * Grupperna i faktarutan: objekten, ansvaret (HUKI) och övriga kopplingar.
 * Tomma grupper faller bort – en rubrik utan rader är bara brus.
 */
export function apFigurer(model: ApModel): FigurGrupp[] {
  const objekt = räkna(model.nodes.map((n) => n.kind));
  const huki = räkna(
    model.relations.filter((r) => r.kind === "huki").map((r) => (r.huki ?? "U") as Huki),
  );
  const kopplingar = räkna(model.relations.filter((r) => r.kind !== "huki").map((r) => r.kind));

  const grupper: FigurGrupp[] = [];

  if (objekt.size > 0) {
    grupper.push({
      titel: "Objekt",
      /**
       * FORMLÖSA objekt hoppas över. Ett textobjekt ritas som bara sin
       * text – `apShapeSvg` ger tomt, och en rad med en tom ruta där symbolen
       * skulle stått ser ut som ett fel. Att hitta på en symbol åt den vore
       * värre: rutan ska visa det bilden visar, inget annat.
       */
      figurer: ORDNING.filter((k) => objekt.has(k) && apShapeSvg(k, 10, 10) !== "").map((kind) => {
        const d = AP_DIMS[kind];
        return {
          nyckel: kind,
          namn: AP_TYPE_LABEL[kind],
          betydelse: AP_TYPE_BETYDELSE[kind],
          antal: objekt.get(kind) ?? 0,
          // Samma formmodul som ytan och exporten.
          ...medMarginal(apShapeSvg(kind, d.w, d.h), d.w, d.h),
        };
      }),
    });
  }

  if (huki.size > 0) {
    grupper.push({
      titel: "Ansvar (HUKI)",
      figurer: HUKI_ORDNING.filter((h) => huki.has(h)).map((h) => ({
        nyckel: `huki-${h}`,
        namn: `${h} – ${HUKI_LABEL[h]}`,
        betydelse: `${HUKI_MENING[h]("Aktören", "aktiviteten")}.`,
        antal: huki.get(h) ?? 0,
        svg: linjeIkon({ färg: hukiFärg(h) }),
        ...LINJE_MÅTT,
      })),
      // Det här är hela skälet till att rutan finns: en gul linje i bilden
      // säger "informeras", men bokstaven står ingenstans att läsa.
      hint: "Ansvaret bärs av FÄRGEN – bokstaven skrivs aldrig ut i bilden. Håll muspekaren över en linje för att se den i klartext.",
    });
  }

  if (kopplingar.size > 0) {
    grupper.push({
      titel: "Kopplingar",
      figurer: [...kopplingar.keys()].map((kind) => ({
        nyckel: `rel-${kind}`,
        namn: AP_RELATION_LABEL[kind],
        betydelse: AP_RELATION_BETYDELSE[kind as Exclude<typeof kind, "huki">],
        antal: kopplingar.get(kind) ?? 0,
        svg: linjeIkon({ färg: relationsFärg(kind) }),
        ...LINJE_MÅTT,
      })),
    });
  }

  return grupper;
}
