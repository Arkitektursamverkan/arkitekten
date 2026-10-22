/**
 * Objektpaletten i flödesschemats verktygsrad.
 *
 * Gest: klicka på en form, klicka sedan på ytan där objektet ska ligga. Samma
 * klick-klick som affärsprocesspaletten, och av samma skäl – en dragserie kräver att man
 * träffar rätt både när man greppar och när man släpper, och missar man händer
 * ingenting utan att något förklarar varför.
 *
 * Ikonerna ritas av `form-ikon.ts` – samma modul som figurförteckningen läser, så
 * paletten och faktarutan kan aldrig visa olika former. Betydelsetexterna bor
 * i `theme.ts` (`TYPE_BETYDELSE`) av samma skäl.
 */

import type { NodeType } from "@/core/model";
import { TYPE_BETYDELSE, TYPE_LABEL, TYPE_ORDNING, type ColorMode } from "../theme";
import { FORM_IKON_MÅTT, formIkonSvg } from "../form-ikon";

export interface FlowPalettProps {
  /** Vald form, eller null när inget objektverktyg är aktivt. */
  vald: NodeType | null;
  onVälj: (typ: NodeType | null) => void;
  colorMode: ColorMode;
}

export function FlowPalett({ vald, onVälj, colorMode }: FlowPalettProps) {
  return (
    <div className="ark-palett">
      {TYPE_ORDNING.map((typ) => (
        <button
          key={typ}
          className={`ark-palettknapp ${vald === typ ? "active" : ""}`}
          title={`${TYPE_LABEL[typ]} – ${TYPE_BETYDELSE[typ]}`}
          onClick={() => onVälj(vald === typ ? null : typ)}
        >
          <svg
            width={FORM_IKON_MÅTT.w}
            height={FORM_IKON_MÅTT.h}
            viewBox={`0 0 ${FORM_IKON_MÅTT.w} ${FORM_IKON_MÅTT.h}`}
            aria-hidden
            dangerouslySetInnerHTML={{ __html: formIkonSvg(typ, colorMode) }}
          />
          <span>{TYPE_LABEL[typ]}</span>
        </button>
      ))}
    </div>
  );
}
