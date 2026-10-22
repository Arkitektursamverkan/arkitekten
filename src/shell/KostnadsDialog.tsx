/**
 * Rutan där användaren godkänner kostnaden för ett AI-anrop.
 *
 * Monteras EN gång i skalet och svarar på `godkännKostnad` i bryggan – se
 * src/tools/flowchart/ai/kostnad.ts. Tre utgångar: kör med API:t (kostar),
 * skicka till Claude Code i stället (bara i serverns utvecklarläge), eller
 * avbryt. Escape och klick utanför avbryter.
 */

import { useEffect, useRef, useState } from "react";

import { claudeCodeErbjuds } from "@/tools/flowchart/ai/bridge";
import { registreraKostnadsfråga, type Kostnad, type KostnadsSvar } from "@/tools/flowchart/ai/kostnad";

export function KostnadsDialog() {
  const [fråga, setFråga] = useState<{ k: Kostnad; svara: (svar: KostnadsSvar) => void } | null>(null);
  const godkänn = useRef<HTMLButtonElement>(null);

  useEffect(
    () =>
      registreraKostnadsfråga(
        (k) =>
          new Promise<KostnadsSvar>((resolve) =>
            setFråga((förra) => {
              förra?.svara(null); // en ny fråga ersätter en obesvarad
              return { k, svara: resolve };
            }),
          ),
      ),
    [],
  );

  useEffect(() => {
    if (!fråga) return;
    godkänn.current?.focus();
    const tangent = (e: KeyboardEvent) => {
      if (e.key === "Escape") svara(null);
    };
    window.addEventListener("keydown", tangent);
    return () => window.removeEventListener("keydown", tangent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fråga]);

  if (!fråga) return null;
  function svara(svar: KostnadsSvar) {
    fråga?.svara(svar);
    setFråga(null);
  }

  return (
    <div className="ark-flyttalager ark-kostnadslager" onClick={() => svara(null)}>
      <div
        className="ark-flyttadialog"
        role="alertdialog"
        aria-label="Godkänn kostnad"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="ark-flytta-rubrik">Godkänn AI-anrop</h2>
        <p className="ark-flytta-nu">Den här funktionen är förknippad med en kostnad.</p>
        <p className="ark-hint">
          {fråga.k.vad} kostar <strong>{fråga.k.belopp}</strong>. Ett längre flöde eller underlag kostar mer.
        </p>
        <div className="ark-flytta-fot">
          <button ref={godkänn} className="ark-btn ark-btn--primary" onClick={() => svara("api")}>
            Godkänn och kör
          </button>
          {claudeCodeErbjuds() && (
            <button className="ark-btn" onClick={() => svara("claude-code")}>
              Skicka till Claude Code
            </button>
          )}
          <button className="ark-linkbtn" onClick={() => svara(null)}>
            Avbryt
          </button>
        </div>
        {claudeCodeErbjuds() && (
          <p className="ark-hint ark-kostnad-notis">
            <strong>Skicka till Claude Code</strong> lägger begäran hos Claude Code på servern i stället – utan
            kostnad per anrop. Alternativet finns bara i serverns utvecklarläge.
          </p>
        )}
      </div>
    </div>
  );
}
