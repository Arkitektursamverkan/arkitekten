/**
 * Vem som besvarar AI-knapparna – frågas EN gång per sida och delas av alla
 * knappar, så att texterna ("AI:n arbetar …" respektive "Be Claude Code …")
 * säger samma sak överallt.
 */

import { useEffect, useState } from "react";

import { AKTIV_VÄG_ÄNDRAD, aiVäg, aktivAiVäg, type AiVäg } from "./bridge";

/**
 * Nyckeln låg förr i webbläsarens localStorage. Den behövs inte längre – servern
 * har sin egen – och ska inte ligga kvar i klartext.
 */
const GAMMAL_NYCKEL = "ark.anthropicApiKey";

let delad: Promise<AiVäg | null> | null = null;

/**
 * Serverns förval – eller, medan en begäran väntar, den väg användaren valde
 * för just den (Claude Code i stället för API:t).
 */
export function useAiVäg(): AiVäg | null {
  const [väg, setVäg] = useState<AiVäg | null>(null);
  const [aktiv, setAktiv] = useState<AiVäg | null>(aktivAiVäg);
  useEffect(() => {
    const följ = () => setAktiv(aktivAiVäg());
    window.addEventListener(AKTIV_VÄG_ÄNDRAD, följ);
    return () => window.removeEventListener(AKTIV_VÄG_ÄNDRAD, följ);
  }, []);
  useEffect(() => {
    let levande = true;
    try {
      localStorage.removeItem(GAMMAL_NYCKEL);
    } catch {
      /* lagringen kan vara avstängd */
    }
    delad ??= aiVäg();
    void delad.then((v) => levande && setVäg(v));
    return () => {
      levande = false;
    };
  }, []);
  return aktiv ?? väg;
}

/** Knapptexten medan en begäran väntar. */
export function väntarText(väg: AiVäg | null): string {
  return väg === "api" ? "AI:n arbetar …" : "Väntar på Claude Code …";
}
