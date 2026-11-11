/**
 * Verktygsradens "Avstånd" för MARKERINGEN – samma knappar i flödesschemat och
 * i affärsprocessverktyget. Vilka mellanrum som berörs och hur faktorn kläms
 * och tolkas bor i `tools/flowchart/layout/avstand.ts`; här finns bara
 * knapparna och procentfältet.
 */
import { useEffect, useState } from "react";
import { AVSTÅND_MAX, AVSTÅND_MIN, AVSTÅND_STEG, klämAvstånd, tolkaProcent } from "@/tools/flowchart/layout/avstand";
import { VradKnapp } from "./Verktygsrad";

export interface AvstandsKnapparProps {
  /** Markeringens faktor (1 = normalt); null = markeringen spänner inte över två kolumner. */
  värde: number | null;
  onÄndra: (faktor: number) => void;
}

const INGEN_MARKERING =
  "Markera objekt i minst två kolumner (dra en ram, eller Ctrl-klicka) för att ändra avståndet mellan dem";

const procentAv = (v: number) => String(Math.round(v * 100));

export function AvstandsKnappar({ värde, onÄndra }: AvstandsKnapparProps) {
  const av = värde === null;
  const v = värde ?? 1;
  /** Fältets text medan man skriver; följer markeringens värde annars. */
  const [text, setText] = useState(procentAv(v));
  useEffect(() => setText(procentAv(v)), [v]);

  const verkställ = () => {
    const f = tolkaProcent(text);
    if (f === null || f === v) setText(procentAv(v));
    else onÄndra(f);
  };

  return (
    <>
      <VradKnapp
        ikon
        disabled={av || v <= AVSTÅND_MIN}
        onClick={() => onÄndra(klämAvstånd(v - AVSTÅND_STEG))}
        title={av ? INGEN_MARKERING : "Tätare – kortare pilar mellan de markerade objekten"}
      >
        →←
      </VradKnapp>
      <label
        className={`ark-vrad-procent ${av ? "av" : ""}`}
        title={
          av
            ? INGEN_MARKERING
            : `Avståndet mellan de markerade objekten, ${Math.round(AVSTÅND_MIN * 100)}–${Math.round(AVSTÅND_MAX * 100)} %. ` +
              "Skriv ett tal och tryck Enter. Objekt du flyttat för hand ligger kvar där du lagt dem."
        }
      >
        <span aria-hidden>↔</span>
        <input
          type="text"
          inputMode="numeric"
          aria-label="Avstånd i procent"
          disabled={av}
          value={av ? "" : text}
          placeholder={av ? "Avstånd" : undefined}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={verkställ}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              verkställ();
            } else if (e.key === "Escape") {
              setText(procentAv(v));
              e.currentTarget.blur();
            }
            // Delete/Backspace i fältet får inte ta bort de markerade objekten.
            e.stopPropagation();
          }}
        />
        {!av && <span aria-hidden>%</span>}
      </label>
      <VradKnapp
        ikon
        disabled={av || v >= AVSTÅND_MAX}
        onClick={() => onÄndra(klämAvstånd(v + AVSTÅND_STEG))}
        title={av ? INGEN_MARKERING : "Glesare – längre pilar mellan de markerade objekten"}
      >
        ←→
      </VradKnapp>
      <VradKnapp
        ikon
        disabled={av || v === 1}
        onClick={() => onÄndra(1)}
        title={av ? INGEN_MARKERING : "Återställ avståndet till 100 %"}
      >
        ↺
      </VradKnapp>
    </>
  );
}
