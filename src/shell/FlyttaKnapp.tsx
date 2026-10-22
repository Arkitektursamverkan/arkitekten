/**
 * "Flytta i katalogen" i den ÖPPNA processens huvud.
 *
 * Katalogens kort har samma knapp, men man står oftast i processen man vill
 * flytta – och den som inte hittade knappen på kortet hittade ingen väg alls
 * (synpunkt 2026-09-07). Samma dialog, samma flytt: bara en
 * annan plats att starta den från.
 *
 * Visas bara för en SPARAD process: en flytt skriver placeringen på en post i
 * biblioteket, och finns ingen post finns inget att flytta.
 */

import { useState } from "react";
import type { FlowSummary, Placering } from "@/core/flow-store";
import { Flyttadialog, FlyttaIkon } from "./Flyttadialog";
import { YTOR, kanByttaYta, kanRedigera, type Yta } from "@/core/behorighet";
import { useAnvändare } from "./Inloggning";

export interface FlyttaKnappProps {
  /** Den öppna processens id, eller null innan den sparats. */
  flowId: string | null;
  flöden: FlowSummary[];
  onFlytta: (id: string, placering: Placering, till?: Yta) => Promise<void> | void;
}

export function FlyttaKnapp({ flowId, flöden, onFlytta }: FlyttaKnappProps) {
  const [öppen, setÖppen] = useState(false);
  const användare = useAnvändare();
  const post = flowId ? (flöden.find((f) => f.id === flowId) ?? null) : null;
  if (!post) return null;
  // Ingenting att flytta till = ingen knapp (t.ex. en användare i den gemensamma katalogen).
  if (!kanRedigera(användare, post) && !YTOR.some((y) => kanByttaYta(användare, post, y.id))) return null;

  return (
    <>
      <button
        className="ark-btn ark-btn--ikon-text"
        onClick={() => setÖppen(true)}
        title={`Flytta ”${post.name}” till en annan samling eller underkategori. Innehållet rörs inte.`}
      >
        <FlyttaIkon />
        Flytta i katalogen
      </button>
      {öppen && (
        <Flyttadialog
          flow={post}
          flöden={flöden}
          onAvbryt={() => setÖppen(false)}
          onFlytta={async (placering, till) => {
            await onFlytta(post.id, placering, till);
            setÖppen(false);
          }}
        />
      )}
    </>
  );
}
