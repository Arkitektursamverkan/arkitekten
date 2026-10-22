/**
 * Ett SKÄRMFÖNSTER: flödet, bilden eller båda sida vid sida, i helskärm på en
 * egen skärm, i takt med huvudfönstret (se visning.ts). Vyn väljs av
 * Kontrollen i huvudfönstret – eller här med tangenterna F, B och D.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ramScen, serieScen } from "@/core/ram-scen";
import type { Ramserie } from "@/core/ram";
import { läggPåRam } from "./effekter";
import { ScenBild } from "./ScenBild";
import { VISNINGS_KANAL, skärmParametrar, type SkärmVy, type VisningsMeddelande } from "./visning";

export function RamFönster() {
  const start = useMemo(() => skärmParametrar(), []);
  const [vy, setVy] = useState<SkärmVy>(start.vy);
  const [läge, setLäge] = useState<{ serie: Ramserie; index: number; flödeSvg?: string } | null>(null);
  const kanal = useRef<BroadcastChannel | null>(null);
  const vyRef = useRef(vy);
  vyRef.current = vy;

  useEffect(() => {
    const k = new BroadcastChannel(VISNINGS_KANAL);
    kanal.current = k;
    k.onmessage = (e: MessageEvent<VisningsMeddelande>) => {
      const m = e.data;
      if (m.typ === "läge") setLäge({ serie: m.serie, index: m.index, flödeSvg: m.flödeSvg });
      // Huvudfönstret frågar vilka skärmar som finns (t.ex. efter en omladdning).
      else if (m.typ === "hej" && !m.skärm)
        k.postMessage({ typ: "hej", skärm: start.skärm, vy: vyRef.current } satisfies VisningsMeddelande);
      else if (m.typ === "vy" && m.skärm === start.skärm) setVy(m.vy);
    };
    document.title = `Arkitekten – skärm ${start.skärm}`;
    const tangent = (e: KeyboardEvent) => {
      const nyVy: SkärmVy | null = e.key === "f" ? "flöde" : e.key === "b" ? "bild" : e.key === "d" ? "båda" : null;
      if (nyVy) {
        setVy(nyVy);
        return;
      }
      const steg = ["ArrowRight", "PageDown", " "].includes(e.key)
        ? 1
        : ["ArrowLeft", "PageUp"].includes(e.key)
          ? -1
          : 0;
      if (!steg) return;
      e.preventDefault();
      k.postMessage({ typ: "byt", steg } satisfies VisningsMeddelande);
    };
    const hejdå = () => k.postMessage({ typ: "hejdå", skärm: start.skärm } satisfies VisningsMeddelande);
    window.addEventListener("keydown", tangent);
    window.addEventListener("beforeunload", hejdå);
    return () => {
      window.removeEventListener("keydown", tangent);
      window.removeEventListener("beforeunload", hejdå);
      k.close();
    };
  }, [start.skärm]);

  // Hälsa – vid start och varje gång vyn ändrats – så att Kontrollen vet vad skärmen visar.
  useEffect(() => {
    kanal.current?.postMessage({ typ: "hej", skärm: start.skärm, vy } satisfies VisningsMeddelande);
  }, [vy, start.skärm]);

  const ram = läge ? läge.serie.ramar[läge.index] : undefined;
  const flöde = useMemo(
    () => (läge?.flödeSvg && ram ? läggPåRam(läge.flödeSvg, ram, { prefix: `ark-ram-s${start.skärm}` }).svg : ""),
    [läge?.flödeSvg, ram, start.skärm],
  );

  return (
    <div
      className={`ark-ramfonster vy-${vy}`}
      onDoubleClick={() =>
        document.fullscreenElement
          ? void document.exitFullscreen()
          : void document.documentElement.requestFullscreen().catch(() => undefined)
      }
      title="Dubbelklicka för helskärm · F, B, D byter vy"
    >
      {läge && ram ? (
        <>
          <div className="ark-ramfonster-ytor">
            {vy !== "bild" &&
              (flöde ? (
                <div className="ark-ramfonster-yta ark-ramfonster-flode" dangerouslySetInnerHTML={{ __html: flöde }} />
              ) : (
                <div className="ark-ramfonster-yta ark-empty">Flödet laddas i huvudfönstret …</div>
              ))}
            {vy !== "flöde" && (
              <div className="ark-ramfonster-yta">
                <ScenBild scen={serieScen(läge.serie)} rs={ramScen(ram)} läge="visa" prefix={`ark-scen-s${start.skärm}`} />
              </div>
            )}
          </div>
          <div className="ark-ramfonster-rubrik">
            {läge.index + 1} / {läge.serie.ramar.length} · {ram.rubrik}
          </div>
        </>
      ) : (
        <div className="ark-empty">Skärm {start.skärm} väntar på Arkitekten … Öppna en visualisering i huvudfönstret.</div>
      )}
    </div>
  );
}
