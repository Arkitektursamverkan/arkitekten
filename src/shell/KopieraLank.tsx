/**
 * "Kopiera länk" i den öppna processens huvud.
 *
 * Adressraden bär redan länken (`lank.ts`), men den som ska skicka en process
 * till en kollega letar efter en knapp, inte efter en adress. Länken pekar på
 * PROCESSEN – den som följer den ser alltid det senast sparade.
 *
 * Visas bara för en SPARAD process: utan post i biblioteket finns inget id att
 * länka till.
 */

import { useEffect, useState } from "react";
import { processLänk } from "./lank";

/** Hela adressen till en process, som den ska klistras in i ett mejl. */
export function helLänk(flowId: string): string {
  return location.origin + location.pathname + processLänk(flowId);
}

/**
 * Lägger texten i urklipp. `navigator.clipboard` finns bara i en säker
 * kontext (https eller localhost), och appen nås oftast på en vanlig
 * http-adress i nätet – därför reservvägen genom ett dolt textfält.
 */
async function kopiera(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // faller igenom till reservvägen
  }
  const fält = document.createElement("textarea");
  fält.value = text;
  fält.setAttribute("readonly", "");
  fält.style.position = "fixed";
  fält.style.opacity = "0";
  document.body.appendChild(fält);
  fält.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    fält.remove();
  }
}

export function KopieraLänk({ flowId }: { flowId: string | null }) {
  const [besked, setBesked] = useState<"kopierad" | "misslyckades" | null>(null);
  useEffect(() => {
    if (!besked) return;
    const t = setTimeout(() => setBesked(null), 2500);
    return () => clearTimeout(t);
  }, [besked]);
  if (!flowId) return null;
  const länk = helLänk(flowId);

  return (
    <button
      className="ark-btn ark-btn--ikon-text"
      title={
        besked === "misslyckades"
          ? `Webbläsaren tillät inte kopiering. Länken är: ${länk}`
          : `Kopiera en länk direkt till processen – den visar alltid senast sparade version.\n${länk}`
      }
      onClick={async () => setBesked((await kopiera(länk)) ? "kopierad" : "misslyckades")}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.8.8M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.8-.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span role="status">
        {besked === "kopierad" ? "Länken kopierad" : besked === "misslyckades" ? "Gick inte att kopiera" : "Kopiera länk"}
      </span>
    </button>
  );
}
