/**
 * Objektpaletten: affärsprocessens symboler som kan läggas till direkt på ytan.
 *
 * Gest: klicka på en form i paletten, klicka sedan på YTAN där objektet ska
 * placeras. Medvetet klick-klick i stället för HTML5-drag – dragserien har
 * svikit förr (mellanlagrets dragning fick byggas om på pointer-events), och
 * klickgesten är dessutom träffsäker på små satellitformer.
 *
 * Ikonerna ritas av SAMMA formmodul som ytan och exporten (apShapeSvg), så
 * paletten kan aldrig visa en annan form än den som faktiskt ritas – och av
 * samma modul som figurförteckningen läser.
 */

import type { ApNodeKind } from "@/core/affarsprocess";
import { apShapeSvg, AP_TYPE_BETYDELSE, AP_TYPE_LABEL } from "./former";
import { AP_DIMS } from "./layout-affarsprocess";

/** Symbolerna i paletten: kedjan först, sedan satelliter. */
const OBJEKT: ApNodeKind[] = [
  "aktivitet",
  "regel",
  "vo",
  "roll",
  "intressent",
  "applikation",
  "arkiv",
  "krav",
  "tid",
  "forum",
  "plats",
  "problem",
  "risk",
  "mojlighet",
];

/**
 * Vad en PIL gör med det placerade objektet – palettens egen gestinstruktion.
 *
 * Symbolens BETYDELSE står i `AP_TYPE_BETYDELSE` (former) och delas med
 * figurförteckningen; här ligger bara det som hör till redigerandet, och bara
 * för de former där pilen gör något mer än att koppla ihop. Hjälptexten
 * började en gång med "Fritt objekt…" på varenda symbol – appens eget inre ord
 * för "ännu inte inknuten", som inte säger en läsare någonting om skillnaden
 * mellan en roll och ett krav.
 */
const GEST: Partial<Record<ApNodeKind, string>> = {
  aktivitet: "En pil till eller från ett steg gör den till ett kedjesteg.",
  vo: "Pil FRÅN en aktivitet gör det till dess ut-objekt, pil TILL till in-objekt.",
  roll: "Förvalet på pilen är U = Utför.",
  intressent: "Förvalet på pilen är I = Informeras.",
};

/** Verktygstipset: vad symbolen betyder, och vad en pil gör med den. */
const hjälp = (kind: ApNodeKind) =>
  [AP_TYPE_BETYDELSE[kind], GEST[kind]].filter(Boolean).join(" ");

export interface ApPalettProps {
  vald: ApNodeKind | null;
  onVälj: (kind: ApNodeKind | null) => void;
}

export function ApPalett({ vald, onVälj }: ApPalettProps) {
  return (
    <div className="ark-ap-palett-lista">
      <div className="ark-section-title">Objekt</div>
      <p className="ark-hint">
        Klicka på en form, klicka sedan var som helst på ytan. Objektet ligger FRITT tills du
        drar en pil till eller från det – först då knyts det in. Esc avbryter.
      </p>
      {OBJEKT.map((kind) => {
        const d = AP_DIMS[kind];
        return (
          <button
            key={kind}
            className={`ark-ap-palettobjekt ${vald === kind ? "active" : ""}`}
            title={hjälp(kind)}
            onClick={() => onVälj(vald === kind ? null : kind)}
          >
            <svg
              width={34}
              height={26}
              viewBox={`-2 -2 ${d.w + 4} ${d.h + 4}`}
              preserveAspectRatio="xMidYMid meet"
              // Samma formmodul som ytan och exporten.
              dangerouslySetInnerHTML={{ __html: apShapeSvg(kind, d.w, d.h) }}
            />
            <span>{AP_TYPE_LABEL[kind]}</span>
          </button>
        );
      })}
    </div>
  );
}
