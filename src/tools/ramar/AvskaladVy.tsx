/**
 * Den avskalade presentationsbilden som VY – i läsläget en bild, i
 * redigeringsläget går den att arbeta i:
 *
 *  - RUTORNA dras till nya platser. Draget snäpper mot andra rutors
 *    mittlinjer: det är raka linjer man är ute efter ("jag gillar inte hur
 *    linjerna är krokiga", 2026-09-30).
 *  - KOPPLINGARNAS ÄNDAR dras till den sida – och det läge längs sidan – där
 *    linjen ska lämna eller gå in i rutan. Dubbelklick på handtaget återställer.
 *  - ETT KLICK på en ruta väljer den; verktyget visar då sin vanliga inspektör,
 *    där innehållet ändras (text, roller, IT-stöd …).
 *
 * Bilden är exakt den Ramar visar (`renderAvskaladSvg`), ritad om vid varje
 * musruck med det dragna ovanpå. Allt sparas i mellanlagret
 * (`draft.presentation`), i presentationsbildens egen koordinatram.
 */

import { useMemo, useRef, useState } from "react";
import type { ApModel } from "@/core/affarsprocess";
import { RAM_NOD_ATTR } from "@/core/ram";
import {
  avskalaAp,
  närmasteSida,
  portRuta,
  renderAvskaladSvg,
  type AvskaladeKopplingar,
  type AvskaladeLägen,
} from "./avskalad";
import type { Side } from "@/tools/flowchart/layout/edge-router";

/** Hur nära (i bildens pixlar) en mittlinje måste ligga för att snäppa. */
export const SNÄPP = 12;
/** Så långt pekaren får röra sig innan ett klick blir ett drag (skärmpixlar). */
const DRAG_TRÖSKEL = 4;

/**
 * Snäpper en ruta mot de andra rutornas mittlinjer, i vardera led för sig.
 * Ren funktion – testas utan webbläsare.
 */
export function snäppMotMittlinjer(
  läge: { x: number; y: number },
  storlek: { w: number; h: number },
  andra: { x: number; y: number; w: number; h: number }[],
  tolerans = SNÄPP,
): { x: number; y: number } {
  const cx = läge.x + storlek.w / 2;
  const cy = läge.y + storlek.h / 2;
  let bästX: number | null = null;
  let bästY: number | null = null;
  for (const r of andra) {
    const ox = r.x + r.w / 2;
    const oy = r.y + r.h / 2;
    if (Math.abs(ox - cx) <= tolerans && (bästX === null || Math.abs(ox - cx) < Math.abs(bästX - cx))) bästX = ox;
    if (Math.abs(oy - cy) <= tolerans && (bästY === null || Math.abs(oy - cy) < Math.abs(bästY - cy))) bästY = oy;
  }
  return {
    x: bästX === null ? läge.x : bästX - storlek.w / 2,
    y: bästY === null ? läge.y : bästY - storlek.h / 2,
  };
}

type Ände = "source" | "target";

type Dragning =
  | { typ: "ruta"; id: string; dx: number; dy: number; sx: number; sy: number; flyttad: boolean }
  | { typ: "ände"; nyckel: string; ände: Ände; ruta: string; flyttad: boolean };

export function AvskaladVy(props: {
  modell: ApModel;
  lägen: AvskaladeLägen;
  kopplingar: AvskaladeKopplingar;
  redigerar: boolean;
  vald?: string | null;
  /** Ny plats för en ruta – eller null: tillbaka till den uträknade. */
  onFlytta?: (id: string, läge: { x: number; y: number } | null) => void;
  /** Ny sida/läge för en kopplings ände – eller null: automatiskt. */
  onKoppling?: (nyckel: string, ände: Ände, val: { side: Side; pos: number } | null) => void;
  /** En ruta valdes (null = klick på tom yta). */
  onVälj?: (id: string | null) => void;
  /** Allt handplacerat tillbaka till det uträknade. */
  onÅterställ?: () => void;
  etikett?: string;
}) {
  const { modell, lägen, kopplingar, redigerar } = props;
  const yta = useRef<HTMLDivElement>(null);
  const drar = useRef<Dragning | null>(null);
  const [utkastLägen, setUtkastLägen] = useState<AvskaladeLägen>({});
  const [utkastKopplingar, setUtkastKopplingar] = useState<AvskaladeKopplingar>({});
  const senast = useRef<{ läge?: { x: number; y: number }; val?: { side: Side; pos: number } }>({});

  const bild = useMemo(
    () => avskalaAp(modell, { ...lägen, ...utkastLägen }, { ...kopplingar, ...utkastKopplingar }),
    [modell, lägen, kopplingar, utkastLägen, utkastKopplingar],
  );
  const svg = useMemo(
    () => renderAvskaladSvg(bild, { handtag: redigerar && Boolean(props.onKoppling), vald: redigerar ? props.vald : null }),
    [bild, redigerar, props.onKoppling, props.vald],
  );

  const tillBild = (e: { clientX: number; clientY: number }) => {
    const m = yta.current?.querySelector("svg")?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const onDown = (e: React.PointerEvent) => {
    if (!redigerar || e.button !== 0) return;
    const mål = e.target as Element;
    const p = tillBild(e);
    if (!p) return;
    const handtag = mål.closest("[data-avsk-kant]");
    if (handtag && props.onKoppling) {
      const nyckel = handtag.getAttribute("data-avsk-kant")!;
      const ände = handtag.getAttribute("data-avsk-ande") as Ände;
      const kant = bild.kanter.find((k) => k.nyckel === nyckel);
      if (!kant) return;
      e.preventDefault();
      drar.current = { typ: "ände", nyckel, ände, ruta: ände === "source" ? kant.source : kant.target, flyttad: false };
      yta.current?.setPointerCapture(e.pointerId);
      return;
    }
    const id = mål.closest(`[${RAM_NOD_ATTR}]`)?.getAttribute(RAM_NOD_ATTR);
    const ruta = id ? bild.rutor.find((r) => r.id === id) : undefined;
    if (!ruta) {
      props.onVälj?.(null);
      return;
    }
    e.preventDefault();
    drar.current = { typ: "ruta", id: ruta.id, dx: p.x - ruta.x, dy: p.y - ruta.y, sx: e.clientX, sy: e.clientY, flyttad: false };
    // Fångsten ligger på YTAN – bilden ritas om vid varje ruck och SVG:n byts ut.
    yta.current?.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drar.current;
    if (!d) return; // bara vår EGEN dragning (invariant 6)
    if (!(e.buttons & 1)) return; // bara medan knappen hålls
    const p = tillBild(e);
    if (!p) return;
    if (d.typ === "ruta") {
      if (!d.flyttad && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_TRÖSKEL) return;
      if (!props.onFlytta) return;
      const ruta = bild.rutor.find((r) => r.id === d.id);
      if (!ruta) return;
      const andra = bild.rutor.filter((r) => r.id !== d.id);
      const läge = snäppMotMittlinjer({ x: p.x - d.dx, y: p.y - d.dy }, ruta, andra);
      d.flyttad = true;
      senast.current = { läge };
      setUtkastLägen({ [d.id]: läge });
    } else {
      const ruta = bild.rutor.find((r) => r.id === d.ruta);
      if (!ruta) return;
      const val = närmasteSida(portRuta(ruta), p, ruta.sort === "regel");
      d.flyttad = true;
      senast.current = { val };
      const förra = kopplingar[d.nyckel] ?? {};
      setUtkastKopplingar({
        [d.nyckel]:
          d.ände === "source"
            ? { ...förra, sourceSide: val.side, sourcePos: val.pos }
            : { ...förra, targetSide: val.side, targetPos: val.pos },
      });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drar.current;
    drar.current = null;
    yta.current?.releasePointerCapture?.(e.pointerId);
    const { läge, val } = senast.current;
    senast.current = {};
    setUtkastLägen({});
    setUtkastKopplingar({});
    if (!d) return;
    if (d.typ === "ruta") {
      if (d.flyttad && läge) props.onFlytta?.(d.id, läge);
      else props.onVälj?.(d.id); // ett klick väljer rutan – inspektören visar innehållet
    } else if (d.flyttad && val) {
      props.onKoppling?.(d.nyckel, d.ände, val);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!redigerar) return;
    const handtag = (e.target as Element).closest("[data-avsk-kant]");
    if (!handtag) return;
    props.onKoppling?.(
      handtag.getAttribute("data-avsk-kant")!,
      handtag.getAttribute("data-avsk-ande") as Ände,
      null,
    );
  };

  const handplacerat = Object.keys(lägen).length + Object.keys(kopplingar).length > 0;

  return (
    <div className={`ark-ap-avskalad ${redigerar ? "redigerar" : ""}`}>
      <div
        ref={yta}
        className="ark-ap-avskalad-bild"
        role="img"
        aria-label={props.etikett}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={onDoubleClick}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {redigerar && (
        <div className="ark-ap-avskalad-tips">
          Klicka på en ruta för att ändra innehållet · dra rutorna (de snäpper mot varandras mittlinjer) · dra
          kopplingarnas ändar till en annan sida – dubbelklick återställer
          {handplacerat && props.onÅterställ && (
            <button className="ark-linkbtn ark-ap-avskalad-aterstall" onClick={props.onÅterställ}>
              Återställ utlägget
            </button>
          )}
        </div>
      )}
    </div>
  );
}
