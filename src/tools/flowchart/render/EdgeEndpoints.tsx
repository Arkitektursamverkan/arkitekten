/**
 * Dragbara ändpunkter för en vald kant.
 *
 * VARFÖR EGEN IMPLEMENTATION: React Flows inbyggda "reconnect"-gest gick inte
 * att få att fungera hos användaren, och den går inte att felsöka härifrån –
 * den lever helt inuti biblioteket. Den här varianten äger hela kedjan själv:
 * två synliga handtag, pointer-events (samma teknik som fungerade i
 * mellanlagret när HTML5-dragning svek) och ren geometri som är enhetstestad
 * i edge-geometry.ts. Ingenting är dolt i ett bibliotek vi inte kan inspektera.
 *
 * Ändpunkterna renderas i flödets koordinatsystem via samma transform som
 * React Flow använder, så de följer pan och zoom.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import type { EdgeSide } from "@/core/model";
import {
  autoSides,
  hitBox,
  nearestSide,
  portPoint,
  sidePos,
  snäppPunkt,
  KOPPLINGSPUNKTER,
  type Box,
} from "./edge-geometry";

export interface EdgeEndpointsProps {
  /** Rutorna för alla processobjekt, i flödeskoordinater. */
  boxes: Box[];
  source: string;
  target: string;
  /**
   * Kantens etikett ("Ja"/"Nej"). Skickas vidare till den automatiska
   * sidoregeln, som behöver den för att veta att kanten är en GREN – invariant 3.
   * Utan den satt handtaget på en annan sida än pilen ritades på.
   */
  label?: string;
  /** Nuvarande sidor – saknas de används den automatiska regeln. */
  sourceSide?: EdgeSide;
  targetSide?: EdgeSide;
  /** Var på sidan pilen fäster (0–1). Saknas = mitten. */
  sourcePos?: number;
  targetPos?: number;
  /**
   * Punkten pilen FAKTISKT ritas i just nu, när den inte kommer ur sidorna
   * ovan (affärsprocesslayoutens raka satellitstreck). Handtaget ska sitta där pilen
   * sitter – annars ser det ut som att kopplingen fäster på ett annat ställe
   * än kopplingspunkten.
   */
  sourcePunkt?: { x: number; y: number };
  targetPunkt?: { x: number; y: number };
  /** Visa de valbara kopplingspunkterna på objekten medan kanten är vald. */
  visaPunkter?: boolean;
  /**
   * Vilka punkter längs en sida som går att välja. Saknas = alla (affärsprocessen,
   * som fäster satellitstrecken på bestämda andelar).
   *
   * Flödesschemat skickar BARA mitten: dess router fäster alltid pilen mitt på
   * sidan, så fem punkter hade lovat ett val som inte syns – och markeringen
   * "här sitter pilen" hade hamnat på en punkt pilen inte är på.
   */
  punktval?: readonly number[];
  onPick: (sides: {
    sourceSide?: EdgeSide;
    targetSide?: EdgeSide;
    sourcePos?: number;
    targetPos?: number;
  }) => void;
  /** Nollar den ände som dubbelklickas – tillbaka till automatisk punkt. */
  onClear?: (ände: "source" | "target") => void;
}

export function EdgeEndpoints({
  boxes,
  source,
  target,
  label,
  sourceSide,
  targetSide,
  sourcePos,
  targetPos,
  sourcePunkt,
  targetPunkt,
  visaPunkter,
  punktval = KOPPLINGSPUNKTER,
  onPick,
  onClear,
}: EdgeEndpointsProps) {
  const { screenToFlowPosition } = useReactFlow();
  // Viewport-transformen: ändpunkterna ska följa pan/zoom exakt.
  const transform = useStore((s) => s.transform);
  const [dragging, setDragging] = useState<"source" | "target" | null>(null);
  /** Sidan OCH punkten pekaren just nu skulle landa på – förhandsvisning. */
  const [preview, setPreview] = useState<{ sida: EdgeSide; pos: number } | null>(null);
  const previewRef = useRef<{ sida: EdgeSide; pos: number } | null>(null);

  const a = boxes.find((b) => b.id === source);
  const b = boxes.find((b) => b.id === target);

  const move = useCallback(
    (e: PointerEvent) => {
      if (!dragging) return;
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      // Ändpunkten hör till sin egen nod – man byter sida på den, inte nod.
      const egen = dragging === "source" ? a : b;
      if (!egen) return;
      const träff = hitBox([egen], p, 400) ?? egen;
      const sida = nearestSide(träff, p);
      const val = { sida, pos: snäppPunkt(sidePos(träff, sida, p)) };
      previewRef.current = val;
      setPreview(val);
    },
    [dragging, screenToFlowPosition, a, b],
  );

  const up = useCallback(() => {
    if (dragging && previewRef.current) {
      const { sida, pos } = previewRef.current;
      onPick(
        dragging === "source"
          ? { sourceSide: sida, sourcePos: pos }
          : { targetSide: sida, targetPos: pos },
      );
    }
    setDragging(null);
    setPreview(null);
    previewRef.current = null;
  }, [dragging, onPick]);

  // Lyssna på hela fönstret medan draget pågår – då tappas det inte om
  // pekaren lämnar handtaget, vilket är lätt hänt med små träffytor.
  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, move, up]);

  if (!a || !b) return null;

  const auto = autoSides(a, b, label);
  const sSide = (dragging === "source" && preview?.sida) || sourceSide || auto.source;
  const tSide = (dragging === "target" && preview?.sida) || targetSide || auto.target;
  const sPos = dragging === "source" ? preview?.pos : sourcePos;
  const tPos = dragging === "target" ? preview?.pos : targetPos;

  const [tx, ty, zoom] = transform;
  const skärmläge = (p: { x: number; y: number }) => ({
    left: p.x * zoom + tx,
    top: p.y * zoom + ty,
  });

  const handtag = (
    roll: "source" | "target",
    sida: EdgeSide,
    andel: number | undefined,
    box: Box,
    ritad: { x: number; y: number } | undefined,
  ) => {
    // Handtaget sitter där pilen FAKTISKT fäster: har layouten pekat ut en
    // punkt (det raka satellitstrecket) används den, annars sidans punkt.
    const pos = skärmläge(
      andel === undefined && ritad && dragging !== roll ? ritad : portPoint(box, sida, andel),
    );
    return (
      <div
        className={`ark-endpoint ${dragging === roll ? "dragging" : ""}`}
        style={{ left: pos.left, top: pos.top }}
        title={
          (roll === "source" ? "Dra för att flytta pilens start" : "Dra för att flytta pilens slut") +
          " · dubbelklick tar bort den valda kopplingspunkten"
        }
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          const val = { sida, pos: andel ?? 0.5 };
          previewRef.current = val;
          setPreview(val);
          setDragging(roll);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onClear?.(roll);
        }}
      />
    );
  };

  /**
   * De valbara kopplingspunkterna på ett objekt – syns medan kanten är vald.
   *
   * De är KLICKBARA, inte bara en förhandsvisning. Att dra den lilla ändpunkten
   * till rätt sida krävde en precis gest: sidan avgörs av var man släpper, och
   * på ett brett lågt objekt är träffytan för "vänster" bara några pixlar bred.
   * Ett klick på den punkt man vill ha är samma val utan gesten – och det går
   * inte att missa halvvägs.
   */
  const punkter = (box: Box, roll: "source" | "target") =>
    (["top", "right", "bottom", "left"] as EdgeSide[]).flatMap((sida) =>
      punktval.map((p) => {
        const läge = skärmläge(portPoint(box, sida, p));
        const vald =
          (roll === "source" ? sSide : tSide) === sida &&
          Math.abs((roll === "source" ? (sPos ?? 0.5) : (tPos ?? 0.5)) - p) < 0.01;
        return (
          <button
            key={`${box.id}-${sida}-${p}`}
            className={`ark-endpoint-val ${vald ? "vald" : ""}`}
            style={{ left: läge.left, top: läge.top }}
            title={`Fäst ${roll === "source" ? "pilens start" : "pilens slut"} här`}
            onPointerDown={(e) => {
              // Klicket får inte nå ritytan under (den avmarkerar kanten).
              e.stopPropagation();
              e.preventDefault();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onPick(
                roll === "source"
                  ? { sourceSide: sida, sourcePos: p }
                  : { targetSide: sida, targetPos: p },
              );
            }}
          />
        );
      }),
    );

  return (
    <div className="ark-endpoint-layer">
      {visaPunkter && punkter(a, "source")}
      {visaPunkter && a.id !== b.id && punkter(b, "target")}
      {handtag("source", sSide, sPos, a, sourcePunkt)}
      {handtag("target", tSide, tPos, b, targetPunkt)}
    </div>
  );
}
