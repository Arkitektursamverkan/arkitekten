/**
 * Verktygsradens "Avstånd" för MARKERINGEN – samma knappar i flödesschemat och
 * i affärsprocessverktyget. Vilka mellanrum som berörs och hur faktorn kläms
 * bor i `tools/flowchart/layout/avstand.ts`; här finns bara knapparna.
 */
import { AVSTÅND_MAX, AVSTÅND_MIN, AVSTÅND_STEG, klämAvstånd } from "@/tools/flowchart/layout/avstand";
import { VradKnapp } from "./Verktygsrad";

export interface AvstandsKnapparProps {
  /** Markeringens faktor (1 = normalt); null = markeringen spänner inte över två kolumner. */
  värde: number | null;
  onÄndra: (faktor: number) => void;
}

const INGEN_MARKERING =
  "Markera objekt i minst två kolumner (dra en ram, eller Ctrl-klicka) för att ändra avståndet mellan dem";

export function AvstandsKnappar({ värde, onÄndra }: AvstandsKnapparProps) {
  const av = värde === null;
  const v = värde ?? 1;
  const procent = `${Math.round(v * 100)} %`;
  const förklaring = av
    ? INGEN_MARKERING
    : "Avståndet mellan de markerade objekten. Objekt du flyttat för hand ligger kvar där du lagt dem.";
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
      <VradKnapp
        disabled={av || v === 1}
        onClick={() => onÄndra(1)}
        title={av ? INGEN_MARKERING : `${förklaring} Klicka för att återställa till 100 %.`}
      >
        <span aria-label={`Avstånd ${procent}`}>↔ {av ? "Avstånd" : procent}</span>
      </VradKnapp>
      <VradKnapp
        ikon
        disabled={av || v >= AVSTÅND_MAX}
        onClick={() => onÄndra(klämAvstånd(v + AVSTÅND_STEG))}
        title={av ? INGEN_MARKERING : "Glesare – längre pilar mellan de markerade objekten"}
      >
        ←→
      </VradKnapp>
    </>
  );
}
