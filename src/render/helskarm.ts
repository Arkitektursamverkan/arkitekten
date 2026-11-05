/**
 * HELSKÄRM – visningsläget för en process: ritytan fyller hela skärmen, utan
 * verktygsrad, paneler, meny eller webbläsarens ramar. Ett läsläge – inget går
 * att flytta eller ändra medan man visar (verktygen låser ritytan).
 *
 * EN plats för båda verktygen (Affärsprocess och Systemprocess), som
 * musgesterna i canvas-gester.ts: samma knapp gör samma sak överallt.
 *
 * Ritytans behållare (`.ark-tool-stage`) får klassen `ark-helskarm`, som i
 * styles.css lägger den över hela fönstret och gömmer allt utom ritytan. Den
 * begär dessutom webbläsarens helskärm; nekas den (inbäddat, policy) fyller
 * läget ändå fönstret. Esc stänger i båda fallen – webbläsarens egen Esc
 * lämnar helskärmen, och då lämnas läget också.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export function useHelskärm() {
  const ref = useRef<HTMLDivElement>(null);
  const [aktiv, setAktiv] = useState(false);
  /** Räknas upp vid varje byte – ritytan anpassar vyn till den nya storleken. */
  const [byte, setByte] = useState(0);

  /** Elementet VI satte i helskärm – en annan vys helskärm (ramarnas presentation) rörs aldrig. */
  const vår = useRef<Element | null>(null);
  const lämna = () => {
    if (vår.current && document.fullscreenElement === vår.current) {
      void document.exitFullscreen().catch(() => undefined);
    }
    vår.current = null;
  };

  const öppna = useCallback(() => {
    setAktiv(true);
    setByte((n) => n + 1);
    const el = ref.current;
    if (!el?.requestFullscreen) return;
    vår.current = el;
    void el.requestFullscreen().catch(() => {
      vår.current = null;
    });
  }, []);

  const stäng = useCallback(() => {
    setAktiv(false);
    setByte((n) => n + 1);
    lämna();
  }, []);

  useEffect(() => {
    if (!aktiv) return;
    // Bara när det var VÅR helskärm som lämnades – nekad helskärm ger ingen händelse.
    const skärm = () => {
      if (vår.current && !document.fullscreenElement) stäng();
    };
    const tangent = (e: KeyboardEvent) => {
      if (e.key === "Escape") stäng();
    };
    document.addEventListener("fullscreenchange", skärm);
    window.addEventListener("keydown", tangent);
    return () => {
      document.removeEventListener("fullscreenchange", skärm);
      window.removeEventListener("keydown", tangent);
    };
  }, [aktiv, stäng]);

  // Lämnar man verktyget mitt i visningen ska webbläsaren inte stå kvar i helskärm.
  useEffect(() => lämna, []);

  return { ref, aktiv, öppna, stäng, byte };
}
