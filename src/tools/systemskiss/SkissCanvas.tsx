/**
 * Systemskissens RITYTA.
 *
 * Bilden är ritarens egen markup (`skissInnehåll`) – samma som exporten
 * skriver – och ovanpå den ligger bara markeringen och handtagen. Var något
 * ligger frågas aldrig DOM:en om: `träffISkiss` räknar på samma geometri som
 * bilden ritades ur (invariant 1).
 *
 * GESTERNA följer de andra ritytorna (render/canvas-gester.ts): Ctrl-klick
 * markerar flera, mitten- och högerknappen panorerar. Här panorerar också ett
 * vänsterdrag på tom yta – skissen har ingen markeringsram.
 *
 * Varje dragning har vakter (invariant 6): den börjar i `pointerdown` med rätt
 * knapp, följs bara medan knappen hålls, och nollas i `pointerup`.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  flyttaISkiss,
  läggTillKoppling,
  medföljande,
  ändraStorlek,
  type Systemskiss,
} from "@/core/systemskiss";
import { pointsToPath, type Point, type Rect } from "@/tools/flowchart/layout/edge-router";
import { PAN_BUTTONS, SELECTION_KEY } from "@/tools/flowchart/render/canvas-gester";
import { säkerSvg } from "@/render/saker-svg";
import { SKISS_TECKENSNITT, skissGeometri, skissInnehåll, träffISkiss } from "./skiss-svg";

export interface SkissCanvasHandtag {
  /** Zooma så att hela skissen syns. */
  anpassa(): void;
  /** Mitten av det som syns, i skissens koordinater – där nya objekt hamnar. */
  mitt(): Point;
}

export interface SkissCanvasProps {
  /** HELA skissen – den ändringarna görs i. */
  skiss: Systemskiss;
  /**
   * Det som VISAS: skissen filtrerad på lager (`filtreraSkiss`). Bild och
   * träffytor räknas på den; ändringarna görs i hela skissen.
   */
  visad: Systemskiss;
  /** Låst = bara titta: panorera och zooma, inget går att flytta eller markera. */
  låst: boolean;
  markerade: string[];
  onMarkera: (ids: string[]) => void;
  /**
   * En ändring. `nyckel` håller ihop ändringar som hör till SAMMA handling (ett
   * drag) så att ångra tar dem i ett steg.
   */
  onÄndra: (nästa: Systemskiss, nyckel: string) => void;
  /** Kopplingsläget: klicka på källan, sedan på målet. */
  kopplar: boolean;
  onKopplat: () => void;
}

interface Vy {
  tx: number;
  ty: number;
  k: number;
}

type Drag =
  | { typ: "pan"; knapp: number; sx: number; sy: number; vy: Vy }
  | { typ: "flytta"; start: Point; utgång: Systemskiss; ids: Set<string>; nyckel: string }
  | { typ: "storlek"; start: Point; utgång: Systemskiss; id: string; b: number; h: number; nyckel: string }
  | { typ: "koppla"; från: string };

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const ACCENT = "#1f5c9e";
let dragNr = 0;

export const SkissCanvas = forwardRef<SkissCanvasHandtag, SkissCanvasProps>(function SkissCanvas(
  { skiss, visad, låst, markerade, onMarkera, onÄndra, kopplar, onKopplat },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [vy, setVy] = useState<Vy>({ tx: 40, ty: 40, k: 1 });
  const vyRef = useRef(vy);
  vyRef.current = vy;
  const drag = useRef<Drag | null>(null);
  /** Kopplingsdragets fria ände, i skissens koordinater. */
  const [gummiband, setGummiband] = useState<Point | null>(null);
  /** Källan i kopplingsläget (klick–klick). */
  const [källa, setKälla] = useState<string | null>(null);
  const [panorerar, setPanorerar] = useState(false);

  const geometri = useMemo(() => skissGeometri(visad), [visad]);
  const bild = useMemo(() => säkerSvg(skissInnehåll(visad, geometri), { fragment: true }), [visad, geometri]);

  const tillModell = useCallback((e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current?.getBoundingClientRect();
    const v = vyRef.current;
    return { x: (e.clientX - (r?.left ?? 0) - v.tx) / v.k, y: (e.clientY - (r?.top ?? 0) - v.ty) / v.k };
  }, []);

  const geometriRef = useRef(geometri);
  geometriRef.current = geometri;
  const anpassa = useCallback(() => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return;
    const g = geometriRef.current.gräns;
    const k = Math.min(1.25, Math.max(MIN_ZOOM, Math.min(r.width / g.w, r.height / g.h)));
    setVy({ k, tx: (r.width - g.w * k) / 2 - g.x * k, ty: (r.height - g.h * k) / 2 - g.y * k });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      anpassa,
      mitt: () => {
        const r = svgRef.current?.getBoundingClientRect();
        const v = vyRef.current;
        return { x: ((r?.width ?? 800) / 2 - v.tx) / v.k, y: ((r?.height ?? 500) / 2 - v.ty) / v.k };
      },
    }),
    [anpassa],
  );

  // En annan skiss öppnas: visa hela.
  useLayoutEffect(() => {
    anpassa();
  }, [skiss.id, anpassa]);

  // Kopplingsläget slås av utifrån (Esc, knappen): glöm en påbörjad källa.
  useEffect(() => {
    if (!kopplar) setKälla(null);
  }, [kopplar]);

  // Hjulet zoomar kring pekaren. Egen lyssnare: Reacts onWheel är passiv och
  // kan inte hindra att sidan skrollar.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const hjul = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = vyRef.current;
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * Math.exp(-e.deltaY * 0.0015)));
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setVy({ k, tx: px - ((px - v.tx) / v.k) * k, ty: py - ((py - v.ty) / v.k) * k });
    };
    el.addEventListener("wheel", hjul, { passive: false });
    return () => el.removeEventListener("wheel", hjul);
  }, []);

  const zooma = (faktor: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    const v = vyRef.current;
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * faktor));
    const px = (r?.width ?? 0) / 2;
    const py = (r?.height ?? 0) / 2;
    setVy({ k, tx: px - ((px - v.tx) / v.k) * k, ty: py - ((py - v.ty) / v.k) * k });
  };

  const börjaPanorera = (e: React.PointerEvent) => {
    drag.current = { typ: "pan", knapp: e.button, sx: e.clientX, sy: e.clientY, vy: vyRef.current };
    setPanorerar(true);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    svgRef.current?.focus({ preventScroll: true });
    if (PAN_BUTTONS.includes(e.button)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      börjaPanorera(e);
      return;
    }
    if (e.button !== 0) return; // bara vänsterknappen gör något annat
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = tillModell(e);
    const träff = låst ? null : träffISkiss(visad, geometri, p, 6 / vy.k);

    if (kopplar && !låst) {
      if (träff?.typ !== "objekt") {
        setKälla(null);
        if (!träff) onKopplat(); // klick på tom yta avbryter läget
        return;
      }
      if (!källa) {
        setKälla(träff.id);
        return;
      }
      const { skiss: nästa, id } = läggTillKoppling(skiss, källa, träff.id);
      if (id) {
        if (nästa !== skiss) onÄndra(nästa, `koppla-${++dragNr}`);
        onMarkera([id]);
      }
      setKälla(null);
      onKopplat();
      return;
    }

    if (!träff) {
      if (!låst && markerade.length) onMarkera([]);
      börjaPanorera(e);
      return;
    }
    if (träff.typ === "koppling") {
      onMarkera([träff.id]);
      return;
    }
    const flera = e.ctrlKey || e.metaKey || e.getModifierState?.(SELECTION_KEY);
    let val = markerade.filter((id) => !skiss.kopplingar.some((k) => k.id === id));
    if (flera) {
      val = val.includes(träff.id) ? val.filter((id) => id !== träff.id) : [...val, träff.id];
      onMarkera(val);
      return;
    }
    if (!val.includes(träff.id)) val = [träff.id];
    onMarkera(val);
    drag.current = {
      typ: "flytta",
      start: p,
      utgång: skiss,
      ids: medföljande(skiss, val),
      nyckel: `flytta-${++dragNr}`,
    };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return; // bara vår EGEN dragning
    if (d.typ === "pan") {
      if (!(e.buttons & (d.knapp === 0 ? 1 : d.knapp === 1 ? 4 : 2))) return;
      setVy({ ...d.vy, tx: d.vy.tx + e.clientX - d.sx, ty: d.vy.ty + e.clientY - d.sy });
      return;
    }
    if (!(e.buttons & 1)) return; // bara medan vänsterknappen hålls
    const p = tillModell(e);
    if (d.typ === "flytta") {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return; // ett klick är inget drag
      onÄndra(flyttaISkiss(d.utgång, d.ids, dx, dy), d.nyckel);
    } else if (d.typ === "storlek") {
      onÄndra(ändraStorlek(d.utgång, d.id, d.b + p.x - d.start.x, d.h + p.y - d.start.y), d.nyckel);
    } else if (d.typ === "koppla") {
      setGummiband(p);
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    setPanorerar(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (d?.typ === "koppla") {
      setGummiband(null);
      const träff = träffISkiss(visad, geometri, tillModell(e), 6 / vy.k);
      if (träff?.typ === "objekt") {
        const { skiss: nästa, id } = läggTillKoppling(skiss, d.från, träff.id);
        if (id) {
          if (nästa !== skiss) onÄndra(nästa, `koppla-${++dragNr}`);
          onMarkera([id]);
        }
      }
    }
  };

  /* ---- Överlägget: markering och handtag, i skissens koordinater ---- */

  const ruta = (id: string): Rect | null => {
    const o = geometri.objekt.get(id);
    if (o) return o.ruta;
    const z = visad.zoner.find((x) => x.id === id);
    return z ? { x: z.x, y: z.y, w: z.b, h: z.h } : null;
  };
  const ensam = !låst && markerade.length === 1 ? markerade[0] : null;
  const ensamRuta = ensam ? ruta(ensam) : null;
  const ensamÄrObjekt = Boolean(ensam && geometri.objekt.has(ensam));
  const streck = 1.5 / vy.k;
  const grepp = 9 / vy.k;

  const börjaStorlek = (e: React.PointerEvent) => {
    if (e.button !== 0 || !ensam || !ensamRuta) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    drag.current = {
      typ: "storlek",
      start: tillModell(e),
      utgång: skiss,
      id: ensam,
      b: ensamRuta.w,
      // Objektets lagrade höjd är en MINSTA höjd – draget utgår från den ritade.
      h: ensamRuta.h,
      nyckel: `storlek-${++dragNr}`,
    };
  };
  const börjaKoppla = (e: React.PointerEvent) => {
    if (e.button !== 0 || !ensam) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    drag.current = { typ: "koppla", från: ensam };
    setGummiband(tillModell(e));
  };

  const gummikälla = drag.current?.typ === "koppla" ? ruta(drag.current.från) : null;
  const rutnät = 20 * vy.k;

  return (
    <div className={`ark-skiss-yta ${panorerar ? "panorerar" : ""} ${kopplar ? "kopplar" : ""}`}>
      <svg
        ref={svgRef}
        className="ark-skiss-svg"
        tabIndex={0}
        role="img"
        aria-label={`Systemskiss: ${skiss.namn}`}
        fontFamily={SKISS_TECKENSNITT}
        // Fokus sätts i pointerdown. Webbläsarens eget musnedslag flyttade
        // annars fokus till sidan när man klickade på ett objekt, och då nådde
        // varken Delete eller Ctrl+S fram.
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {!låst && rutnät >= 8 && (
          <>
            <defs>
              <pattern
                id="ark-skiss-rutnat"
                width={rutnät}
                height={rutnät}
                patternUnits="userSpaceOnUse"
                x={vy.tx % rutnät}
                y={vy.ty % rutnät}
              >
                <circle cx={1} cy={1} r={0.9} fill="#d5dae2" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#ark-skiss-rutnat)" />
          </>
        )}
        <g transform={`translate(${vy.tx},${vy.ty}) scale(${vy.k})`}>
          <g dangerouslySetInnerHTML={{ __html: bild }} />

          {!låst &&
            markerade.map((id) => {
              const k = geometri.kopplingar.find((x) => x.koppling.id === id);
              if (k)
                return (
                  <path
                    key={id}
                    d={pointsToPath(k.punkter, 6)}
                    fill="none"
                    stroke={ACCENT}
                    strokeOpacity={0.35}
                    strokeWidth={7}
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                );
              const r = ruta(id);
              return r ? (
                <rect
                  key={id}
                  x={r.x - 4}
                  y={r.y - 4}
                  width={r.w + 8}
                  height={r.h + 8}
                  rx={10}
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth={streck}
                  strokeDasharray={`${5 / vy.k} ${3 / vy.k}`}
                  pointerEvents="none"
                />
              ) : null;
            })}

          {källa && ruta(källa) && (
            <rect
              x={ruta(källa)!.x - 5}
              y={ruta(källa)!.y - 5}
              width={ruta(källa)!.w + 10}
              height={ruta(källa)!.h + 10}
              rx={11}
              fill="none"
              stroke={ACCENT}
              strokeWidth={2.5 / vy.k}
              pointerEvents="none"
            />
          )}

          {gummiband && gummikälla && (
            <line
              x1={gummikälla.x + gummikälla.w / 2}
              y1={gummikälla.y + gummikälla.h / 2}
              x2={gummiband.x}
              y2={gummiband.y}
              stroke={ACCENT}
              strokeWidth={streck}
              strokeDasharray={`${6 / vy.k} ${4 / vy.k}`}
              pointerEvents="none"
            />
          )}

          {ensamRuta && !kopplar && (
            <>
              <rect
                className="ark-skiss-grepp storlek"
                x={ensamRuta.x + ensamRuta.w + 4 - grepp / 2}
                y={ensamRuta.y + ensamRuta.h + 4 - grepp / 2}
                width={grepp}
                height={grepp}
                rx={2 / vy.k}
                fill="#fff"
                stroke={ACCENT}
                strokeWidth={streck}
                onPointerDown={börjaStorlek}
              >
                <title>Dra för att ändra storlek</title>
              </rect>
              {ensamÄrObjekt && (
                <g
                  className="ark-skiss-grepp koppla"
                  transform={`translate(${ensamRuta.x + ensamRuta.w + 18 / vy.k},${ensamRuta.y + ensamRuta.h / 2}) scale(${1 / vy.k})`}
                  onPointerDown={börjaKoppla}
                >
                  <title>Dra till ett annat objekt för att koppla ihop dem</title>
                  <circle r={9} fill={ACCENT} />
                  <path d="M-4,0 H4 M1,-3 L4,0 L1,3" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                </g>
              )}
            </>
          )}
        </g>
      </svg>

      <div className="ark-skiss-zoom">
        <button className="ark-btn ark-btn--icon" onClick={() => zooma(1 / 1.2)} title="Zooma ut" aria-label="Zooma ut">
          −
        </button>
        <span className="ark-skiss-zoomtal">{Math.round(vy.k * 100)} %</span>
        <button className="ark-btn ark-btn--icon" onClick={() => zooma(1.2)} title="Zooma in" aria-label="Zooma in">
          +
        </button>
        <button className="ark-btn" onClick={anpassa} title="Visa hela skissen">
          ⤢ Anpassa
        </button>
      </div>
      {kopplar && !låst && (
        <div className="ark-skiss-besked">
          {källa ? "Klicka på objektet kopplingen ska gå TILL." : "Klicka på objektet kopplingen ska gå FRÅN."} Esc avbryter.
        </div>
      )}
    </div>
  );
});
