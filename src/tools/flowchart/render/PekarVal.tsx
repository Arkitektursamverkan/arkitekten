/**
 * Vad musen gör på ritytan: MARKERA eller FLYTTA VYN.
 *
 * Gesterna kan inte dela vänsterknapp – React Flow stänger av markeringsramen
 * så fort panoreringen har knappen – så valet måste vara ett läge man ser och
 * kan byta. Samma växel i båda verktygen (flödesschemat och affärsprocessen), på samma
 * plats uppe till vänster, med samma två lägen.
 *
 * Handen är därför INTE längre pekarens förval: en hand betyder "jag flyttar
 * vyn", och i markeringsläget flyttar man ingenting – där är pekaren ett kryss.
 */

export type Pekarläge = "markera" | "hand";

/** Streckad ruta = den ram man drar runt objekten. */
function MarkeraIkon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 3" />
    </svg>
  );
}

/** Öppen hand = greppa ritytan och dra den. */
function HandIkon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 11V6a2 2 0 0 0-4 0" />
      <path d="M14 10V4a2 2 0 0 0-4 0v2" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15" />
    </svg>
  );
}

export interface PekarValProps {
  läge: Pekarläge;
  onVälj: (läge: Pekarläge) => void;
}

export function PekarVal({ läge, onVälj }: PekarValProps) {
  return (
    <div className="ark-pekarval" role="group" aria-label="Vad musen gör på ritytan">
      <button
        type="button"
        className={`ark-pekarknapp ${läge === "markera" ? "active" : ""}`}
        aria-pressed={läge === "markera"}
        title="Markera: dra en ram på tom yta för att markera flera objekt och flytta dem tillsammans"
        onClick={() => onVälj("markera")}
      >
        <MarkeraIkon />
        Markera
      </button>
      <button
        type="button"
        className={`ark-pekarknapp ${läge === "hand" ? "active" : ""}`}
        aria-pressed={läge === "hand"}
        title="Flytta vyn: dra ritytan med handen. Går också med mitten- eller högerknappen, eller mellanslag + drag."
        onClick={() => onVälj("hand")}
      >
        <HandIkon />
        Flytta vyn
      </button>
    </div>
  );
}
