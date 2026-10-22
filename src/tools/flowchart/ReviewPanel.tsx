/**
 * AI-utvärderingen som läslista.
 *
 * Rådgivande: ingenting går att verkställa härifrån. Varje synpunkt pekar ut
 * de steg den gäller med deras riktiga namn, så att man kan gå till dem själv.
 * Att visa steg-id:n vore obegripligt – det är etiketterna man känner igen.
 */

import type { ProcessModel } from "@/core/model";
import type { Allvar, Utvärdering } from "./ai/review";

interface Props {
  utvärdering: Utvärdering;
  model: ProcessModel;
  onClose: () => void;
  /** Kör om utvärderingen mot flödet som det ser ut nu. */
  onKörIgen: () => void;
  busy: boolean;
}

const ETIKETT: Record<Allvar, string> = {
  fel: "Fel",
  förslag: "Förslag",
  notering: "Notering",
};

export function ReviewPanel({ utvärdering, model, onClose, onKörIgen, busy }: Props) {
  const namn = new Map<string, string>([
    ...model.nodes.map((n) => [n.id, n.label] as const),
    ...model.dataStores.map((d) => [d.id, d.label] as const),
  ]);
  const antal = (a: Allvar) => utvärdering.synpunkter.filter((s) => s.allvar === a).length;

  return (
    <div className="ark-draft ark-review">
      <div className="ark-draft-head">
        <strong>Utvärdering</strong>
        <span className="ark-draft-origin">rådgivande – inget ändras</span>
        <span className={`ark-pill ${antal("fel") ? "warn" : "ok"}`}>
          {utvärdering.synpunkter.length
            ? `${antal("fel")} fel · ${antal("förslag")} förslag · ${antal("notering")} noteringar`
            : "inget att anmärka"}
        </span>
        <button className="ark-x" onClick={onClose} title="Stäng">
          ✕
        </button>
      </div>

      {utvärdering.sammanfattning && <p className="ark-draft-hint">{utvärdering.sammanfattning}</p>}

      <div className="ark-draft-rows">
        {utvärdering.synpunkter.length === 0 && (
          <p className="ark-hint">
            Inga synpunkter. Det betyder att modellen inte hittade något – inte att flödet är
            bevisat rätt.
          </p>
        )}
        {utvärdering.synpunkter.map((s, i) => (
          <div key={`${s.rubrik}-${i}`} className={`ark-review-rad ${s.allvar}`}>
            <div className="ark-review-topp">
              <span className={`ark-review-märke ${s.allvar}`}>{ETIKETT[s.allvar]}</span>
              <strong>{s.rubrik}</strong>
            </div>
            {s.motivering && <p className="ark-review-motiv">{s.motivering}</p>}
            {s.stegIds.length > 0 && (
              <p className="ark-review-steg">
                Gäller: {s.stegIds.map((id) => namn.get(id) ?? id).join(" · ")}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="ark-mall-fot">
        <button className="ark-btn ark-btn--ai" onClick={onKörIgen} disabled={busy}>
          {busy ? "Utvärderar…" : "Utvärdera igen"}
        </button>
        <button className="ark-linkbtn" onClick={onClose}>
          Stäng
        </button>
      </div>
    </div>
  );
}
