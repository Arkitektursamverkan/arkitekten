/**
 * Informationsklassningen i appen: inställningen (hämtas en gång) och väljaren
 * som både processernas rubrik och systemskissen använder.
 *
 * Reglerna bor i core/klassning.ts. Bryggan prövar nivån när den sparas –
 * väljaren visas bara för att den som får ändra ska hitta den.
 */

import { useEffect, useState } from "react";
import { fårSeKlassning } from "@/core/behorighet";
import {
  STANDARDINSTÄLLNING,
  klassningsText,
  läsKlassningsinställning,
  type Klassning,
  type Klassningsinställning,
} from "@/core/klassning";
import { useAnvändare } from "./Inloggning";

let hämtning: Promise<Klassningsinställning> | null = null;

/** Inställningen ur bryggan. Utan brygga (webbläsarlagring) är klassning av. */
export function hämtaKlassningsinställning(): Promise<Klassningsinställning> {
  hämtning ??= fetch("/__ark/klassning")
    .then((r) => (r.headers.get("content-type")?.includes("json") ? r.json() : null))
    .then((b) => läsKlassningsinställning(b?.ok ? b.klassning : null))
    .catch(() => STANDARDINSTÄLLNING);
  return hämtning;
}

/** Efter att administratören sparat – nästa fråga hämtar på nytt. */
export function glömKlassningsinställning(): void {
  hämtning = null;
}

export function useKlassningsinställning(): Klassningsinställning {
  const [inst, setInst] = useState<Klassningsinställning>(STANDARDINSTÄLLNING);
  useEffect(() => {
    let levande = true;
    void hämtaKlassningsinställning().then((i) => levande && setInst(i));
    return () => {
      levande = false;
    };
  }, []);
  return inst;
}

interface Props {
  inst: Klassningsinställning;
  klassning: Klassning | undefined;
  /** Får den inloggade sätta nivån? Annars visas den bara (om installationen vill). */
  fårÄndra: boolean;
  onVälj: (nivå: { nivå: string; namn: string } | null) => void;
  /** Kort text i stället för väljare, t.ex. medan något sparas. */
  upptagen?: boolean;
}

/**
 * Väljaren – eller märket för den som bara läser. Ingenting när klassning är
 * av, och för läsaren ingenting när administratören valt att inte visa den.
 */
export function KlassningsVal({ inst, klassning, fårÄndra, onVälj, upptagen }: Props) {
  const användare = useAnvändare();
  if (!inst.på) return null;
  const text = klassningsText(inst, klassning);
  if (!fårÄndra) {
    if (!inst.visaIVyn || !text) return null;
    return (
      <span className="ark-klassning" title={`Informationsklassning (${inst.modell.namn})`}>
        🛡 {text}
      </span>
    );
  }
  const finns = Boolean(klassning && inst.modell.nivåer.some((n) => n.id === klassning.nivå));
  return (
    <label
      className="ark-klassning ark-klassning--val"
      title={`Informationsklassning (${inst.modell.namn})${klassning ? `: ${klassningsText(inst, klassning)}` : ""}`}
    >
      <span aria-hidden>🛡</span>
      <select
        className="ark-input"
        aria-label="Informationsklassning"
        value={klassning?.nivå ?? ""}
        disabled={upptagen}
        onChange={(e) => {
          const n = inst.modell.nivåer.find((x) => x.id === e.target.value);
          onVälj(n ? { nivå: n.id, namn: n.namn } : null);
        }}
      >
        <option value="">Ej klassad</option>
        {klassning && !finns && <option value={klassning.nivå}>{klassning.namn} (finns inte i modellen)</option>}
        {/* Bara nivåer man själv får se – bryggan vägrar de andra (core/behorighet.ts). */}
        {inst.modell.nivåer.filter((n) => fårSeKlassning(användare, { nivå: n.id })).map((n) => (
          <option key={n.id} value={n.id}>
            {n.djup ? "   – " : ""}
            {n.namn}
          </option>
        ))}
      </select>
    </label>
  );
}
