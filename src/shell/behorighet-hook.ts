/**
 * Vad den inloggade får göra med processen som är öppen i ett verktyg.
 *
 * Båda verktygen (Flödesschema och Affärsprocess) frågar här, så att Redigera-knappen,
 * publiceringen och rubrikens yta svarar likadant i hela appen. Reglerna bor i
 * core/behorighet.ts; bryggan prövar samma regler när något faktiskt sparas.
 */

import { useMemo } from "react";
import type { FlowSummary } from "@/core/flow-store";
import {
  kanPublicera,
  kanRedigera,
  ytaFör,
  ytgruppBeskrivning,
  ytgruppFör,
  ytgruppTitel,
} from "@/core/behorighet";
import { useAnvändare, useInloggningsläge } from "./Inloggning";

export function useBehörighet(flowId: string | null | undefined, flöden: FlowSummary[]) {
  const användare = useAnvändare();
  const läge = useInloggningsläge();
  return useMemo(() => {
    const post = flowId ? flöden.find((f) => f.id === flowId) : undefined;
    // En process som inte är sparad än är ens egen – den går alltid att rita.
    if (!post) return { fårRedigera: true, fårPublicera: false, varför: "", yta: undefined };
    const fårRedigera = kanRedigera(användare, post);
    const grupp = ytgruppFör(användare, post);
    return {
      fårRedigera,
      fårPublicera: kanPublicera(användare, post),
      varför: fårRedigera
        ? ""
        : ytaFör(post) === "gemensam"
          ? "Den gemensamma katalogen ändras bara av administratörer. Du kan läsa och exportera processen."
          : "Processen ligger i en annan användares katalog.",
      // I öppen drift finns bara en användare – där säger ytan ingenting.
      yta:
        läge === "öppen" && grupp === "gemensam"
          ? undefined
          : { id: grupp, titel: ytgruppTitel(grupp), beskrivning: ytgruppBeskrivning(grupp) },
    };
  }, [flowId, flöden, användare, läge]);
}
