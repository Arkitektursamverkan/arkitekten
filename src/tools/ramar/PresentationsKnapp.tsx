/**
 * "Förenkla och presentera" – knappen som tänds när processen är AI-tolkad.
 *
 * Fungerar som "Tolka med AI": trycket lägger en begäran i ark-bryggans
 * brevlåda, och Claude Code i terminalen gör arbetet. Svaret blir en förenklad
 * process (ett eget flöde i kategorin Presentation) och en ramserie som
 * berättar den – se `ai-presentation.ts`. Den öppna processen rörs inte.
 *
 * Delas av båda verktygen, så knappen ser ut och beter sig likadant i
 * flödesschemat och i affärsprocessen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getFlowStore } from "@/core/flow-store";
import { getRamStore } from "@/core/ram-store";
import { VradKnapp } from "@/shell/Verktygsrad";
import { useAiVäg, väntarText } from "@/tools/flowchart/ai/useAiVag";
import { begärPresentation, type PresentationsKälla } from "./ai-presentation";

interface Resultat {
  flödeId: string;
  flödeNamn: string;
  serieId: string;
  antalRamar: number;
  anmärkningar: string[];
}

export interface PresentationsKnappProps {
  /** Läses vid trycket – processen som den ser ut just då. */
  källa: () => PresentationsKälla;
  /** Brevlådan är upptagen av något annat (tolkning, utvärdering). */
  upptagen?: boolean;
  /** Säger till när knappen själv upptar brevlådan. */
  onArbetar?: (arbetar: boolean) => void;
  onÖppnaFlöde?: (id: string) => void;
  onÖppnaRamserie?: (id: string) => void;
}

export function PresentationsKnapp({ källa, upptagen, onArbetar, onÖppnaFlöde, onÖppnaRamserie }: PresentationsKnappProps) {
  const [avbryt, setAvbryt] = useState<AbortController | null>(null);
  const [fel, setFel] = useState<string | null>(null);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [visaPanel, setVisaPanel] = useState(false);
  const aiVäg = useAiVäg();
  const arbetar = avbryt !== null;

  useEffect(() => {
    onArbetar?.(arbetar);
    // Bara när läget BYTS – callbacken får gärna vara ny i varje render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arbetar]);

  // Försvinner knappen medan den väntar (en annan process öppnas) avbryts
  // väntan och brevlådan lämnas fri – annars stod tolkningen låst för gott.
  const pågående = useRef<AbortController | null>(null);
  pågående.current = avbryt;
  const säg = useRef(onArbetar);
  säg.current = onArbetar;
  useEffect(
    () => () => {
      pågående.current?.abort();
      säg.current?.(false);
    },
    [],
  );

  const kör = useCallback(async () => {
    const ctrl = new AbortController();
    setAvbryt(ctrl);
    setFel(null);
    setResultat(null);
    setVisaPanel(true);
    try {
      const lagring = { flöden: await getFlowStore(), ramar: await getRamStore() };
      const { flöde, serie, anmärkningar } = await begärPresentation(källa(), lagring, ctrl.signal);
      setResultat({
        flödeId: flöde.id,
        flödeNamn: flöde.name,
        serieId: serie.id,
        antalRamar: serie.ramar.length,
        anmärkningar,
      });
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setAvbryt(null);
    }
  }, [källa]);

  // Utan AI-stöd finns ingen som kan förenkla – knappen visas inte.
  if (aiVäg === "av") return null;

  return (
    <div className="ark-rullgardin ark-pres">
      <VradKnapp
        ai
        onClick={() => void kör()}
        disabled={arbetar || upptagen}
        title={`Låt ${aiVäg === "api" ? "AI:n" : "Claude Code"} göra en förenklad process och en visualisering som presenterar den. Den öppna processen rörs inte.`}
      >
        {arbetar ? väntarText(aiVäg) : "✦ Förenkla och presentera"}
      </VradKnapp>
      {arbetar && (
        <VradKnapp onClick={() => avbryt?.abort()} title="Avbryt väntan">
          Avbryt
        </VradKnapp>
      )}

      {visaPanel && (arbetar || fel || resultat) && (
        <div className="ark-rullgardin-panel" style={{ width: 340 }} role="status">
          <div className="ark-pres-topp">
            <strong>Förenkling och presentation</strong>
            <button className="ark-stang" onClick={() => setVisaPanel(false)} title="Stäng" aria-label="Stäng">
              ✕
            </button>
          </div>
          {arbetar && aiVäg === "api" && (
            <p className="ark-hint">
              AI:n förenklar processen och gör ramarna – det brukar ta några minuter. Låt den här sidan stå
              öppen så länge: svaret plockas upp här och sparas.
            </p>
          )}
          {arbetar && aiVäg !== "api" && (
            <p className="ark-hint">
              Begäran ligger i <code>.ark/request.json</code>. Be Claude Code i terminalen att besvara den –
              till exempel <em>”besvara presentationsbegäran”</em>. Låt den här sidan stå öppen så länge:
              svaret plockas upp här och sparas.
            </p>
          )}
          {fel && <p className="ark-hint ark-hint--warn">{fel}</p>}
          {resultat && (
            <>
              <p className="ark-hint ark-hint--kvitto">
                ✓ ”{resultat.flödeNamn}” och en visualisering med {resultat.antalRamar} ramar är sparade.
              </p>
              <button className="ark-btn ark-btn--primary ark-btn--bred" onClick={() => onÖppnaRamserie?.(resultat.serieId)}>
                ▣ Öppna i Visualisering
              </button>
              <button className="ark-btn ark-btn--bred" onClick={() => onÖppnaFlöde?.(resultat.flödeId)}>
                Öppna den förenklade processen
              </button>
              {resultat.anmärkningar.length > 0 && (
                <details className="ark-details">
                  <summary>{resultat.anmärkningar.length} anmärkning(ar) på svaret</summary>
                  <ul className="ark-pres-anm">
                    {resultat.anmärkningar.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
