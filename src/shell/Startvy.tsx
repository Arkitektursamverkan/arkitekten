/**
 * Startvyn – det första valet: skapa något nytt, eller titta på det som finns.
 *
 * Appen öppnade förut mitt i flödesschemat, med ett exempel inläst och en
 * panel full av inställningar. Det ser ut som att man redan börjat arbeta med
 * något, och den som ville leta efter en befintlig process fick själv lista ut
 * att menyn var vägen dit. Startvyn ställer i stället frågan rakt ut och har
 * bara två svar.
 *
 * Under valen ligger det man höll på med sist – i praktiken den vanligaste
 * avsikten av alla, och den ska inte kosta en resa genom katalogen.
 */

import type { SenastPost } from "./senaste";

export interface StartvyProps {
  /** Antal processer i biblioteket – gör "öppna befintlig" konkret. */
  antal: number;
  senaste: SenastPost[];
  onNy: () => void;
  onKatalog: () => void;
  onÖppna: (id: string) => void;
}

export function Startvy({ antal, senaste, onNy, onKatalog, onÖppna }: StartvyProps) {
  return (
    <div className="ark-start">
      <div className="ark-start-inner">
        <header className="ark-start-topp">
          <h1 className="ark-start-rubrik">Arkitekten</h1>
          <p className="ark-start-underrubrik">
            Beskriv en process i text – få ett diagram som går att lita på, versionshantera och
            klistra in i ett dokument.
          </p>
        </header>

        <div className="ark-start-val">
          <button className="ark-start-kort" onClick={onNy}>
            <span className="ark-start-ikon" aria-hidden>
              ✚
            </span>
            <span className="ark-start-korttitel">Skapa ny process</span>
            <span className="ark-start-korttext">
              Skriv beskrivningen, fyll i en mall eller låt AI:n tolka ett underlag.
            </span>
            <span className="ark-start-kortfot">Börja här →</span>
          </button>

          <button className="ark-start-kort" onClick={onKatalog}>
            <span className="ark-start-ikon" aria-hidden>
              ▤
            </span>
            <span className="ark-start-korttitel">Öppna befintlig process</span>
            <span className="ark-start-korttext">
              Sök och bläddra i katalogen – ärendetyp, målgrupp, status och version.
            </span>
            <span className="ark-start-kortfot">
              {antal > 0
                ? `${antal} ${antal === 1 ? "process" : "processer"} i katalogen →`
                : "Katalogen är tom än →"}
            </span>
          </button>
        </div>

        {senaste.length > 0 && (
          <section className="ark-start-senaste">
            <h2 className="ark-start-senastetitel">Senast öppnade</h2>
            <div className="ark-start-senastelista">
              {senaste.map((p) => (
                <button key={p.id} className="ark-start-senasteknapp" onClick={() => onÖppna(p.id)}>
                  {p.namn}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
