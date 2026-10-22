/**
 * "Öppna i Visualisering" i den öppna processens huvud.
 *
 * En visualisering (en ramserie, core/ram.ts) bygger på EN process – men man
 * hittade den bara genom att gå till Visualisering och leta i listan. Står
 * man i processen och den har en visualisering ska den vara ett klick bort,
 * särskilt för presentationerna som AI:n gör (kategorin Presentation), där
 * processen och visualiseringen hör ihop från början.
 *
 * Samma knapp i båda verktygen. Skalet äger listan och navigeringen.
 */

import type { RamserieSammanfattning } from "@/core/ram";
import { Rullgardin } from "@/shell/Verktygsrad";

export function ÖppnaVisualisering({
  flowId,
  serier,
  onÖppna,
}: {
  flowId: string | null;
  serier: RamserieSammanfattning[];
  /** Saknas = skalet kan inte navigera dit (t.ex. i ett test). */
  onÖppna?: (serieId: string) => void;
}) {
  if (!flowId || !onÖppna) return null;
  const mina = serier.filter((s) => s.flödeId === flowId);
  if (mina.length === 0) return null;

  if (mina.length === 1) {
    const s = mina[0];
    return (
      <button
        className="ark-btn"
        onClick={() => onÖppna(s.id)}
        title={`Öppna visualiseringen ”${s.namn}” (${s.antalRamar} ramar)`}
      >
        ▣ Öppna i Visualisering
      </button>
    );
  }

  // Flera visualiseringar av samma process – välj vilken.
  return (
    <Rullgardin titel="▣ Öppna i Visualisering" märke={mina.length} align="right" bredd={300}>
      <div className="ark-visualiseringar">
        {mina.map((s) => (
          <button key={s.id} className="ark-visualisering-val" onClick={() => onÖppna(s.id)}>
            <span>{s.namn}</span>
            <span className="ark-hint">{s.antalRamar} ramar</span>
          </button>
        ))}
      </div>
    </Rullgardin>
  );
}
