/**
 * Bildflikens scen för EN ram – samma komponent i redigeringen, i
 * presentationen och i det egna fönstret.
 *
 * Figurerna är nycklade på sitt id och byter synlighet med en CSS-övergång, så
 * att en figur som dyker upp i ram 3 TONAS IN när man bläddrar dit. Pulser och
 * bubblor monteras på nytt per ram och tonar in med en kort animation.
 *
 * Markeringar och pulser ritas ur samma beskrivningar som flödesflikens
 * (effekt-spec.ts) – en puls mellan två figurer ser ut som en puls längs en
 * koppling.
 */

import { createElement, forwardRef, type ReactNode } from "react";
import { SCEN_BREDD, figurerIRam, scenHöjd, type RamScen, type Scen } from "@/core/ram-scen";
import { glödFilterSpec, kantEffektSpec, nodEffektSpec, pilSpec, type Spec } from "./effekt-spec";
import { FIGURER, Stad, figurRuta } from "./scen-figurer";
import { BUBBLA_TEXT, bubblaLäge, pulsVäg, textrutaLäge, ärLjus } from "./scen-geometri";

/** SVG-namn → React-namn: `stroke-width` → `strokeWidth`, `class` → `className`. */
function reactAttr(attr: Spec["attr"]): Record<string, string | number> {
  const ut: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(attr)) {
    ut[k === "class" ? "className" : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return ut;
}

export function SpecSvg({ spec }: { spec: Spec }): ReactNode {
  return createElement(
    spec.namn,
    reactAttr(spec.attr),
    ...(spec.barn ?? []).map((b, i) => <SpecSvg key={i} spec={b} />),
  );
}

export interface ScenBildProps {
  scen: Scen;
  rs: RamScen;
  /** "redigera": dolda figurer syns svagt och går att klicka på. */
  läge: "redigera" | "visa";
  /**
   * Redigeringen: ska figurer som är dolda i ramen synas (svagt, streckade)?
   * Bara när man arbetar med Visa/dölj – annars ser en figur man just tagit
   * bort ur ramen ut att ligga kvar ("Ta bort funkar inte", 2026-09-30).
   */
  visaDolda?: boolean;
  /** Prefix för id:n i defs – flera scener på samma sida får inte krocka. */
  prefix: string;
  /** Figur som är vald (redigeringen ritar en streckad ram runt den). */
  vald?: string | null;
  /** Figuren en ny puls börjar i (redigeringen markerar den). */
  kopplaFrån?: string | null;
  /**
   * Figurerna som ska TÄNDAS – de verktyget går att använda på (se
   * `tändaFigurer` i ScenRedigerare).
   * Pratbubblan hör till den som säger något, och utan markering klickade man
   * på en ledig plats i bilden och ingenting hände (2026-10-13).
   */
  tända?: ReadonlySet<string>;
  valdPuls?: string | null;
  onFigurDown?: (id: string, e: React.PointerEvent) => void;
  onPulsKlick?: (id: string) => void;
  onBakgrundKlick?: (e: React.MouseEvent) => void;
  /** Den valda textrutan (redigeringen ritar en streckad ram runt den). */
  valdText?: string | null;
  onTextrutaDown?: (id: string, e: React.PointerEvent) => void;
  valdPunkt?: string | null;
  onPulspunktDown?: (id: string, e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onPointerCancel?: (e: React.PointerEvent) => void;
  className?: string;
}

export const ScenBild = forwardRef<SVGSVGElement, ScenBildProps>(function ScenBild(p, ref) {
  const { scen, rs, läge, prefix } = p;
  const H = scenHöjd(scen);
  const redigerar = läge === "redigera";
  // Figurerna som de står i DEN HÄR ramen – egna platser ovanpå scenens.
  const figurer = figurerIRam(scen, rs);
  const figurAv = new Map(figurer.map((f) => [f.id, f] as const));
  const dolda = new Set(rs.dolda.filter((d) => figurAv.has(d)));
  const visaDolda = redigerar && (p.visaDolda ?? true);
  const syns = (id: string) => figurAv.has(id) && (visaDolda || !dolda.has(id));
  const glöd = `url(#${prefix}-glod)`;
  const färger = [...new Set(rs.pulser.map((x) => x.färg))];
  const pilId = (färg: string) => `${prefix}-pil-${färger.indexOf(färg)}`;

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${SCEN_BREDD} ${H}`}
      className={`ark-scen ${redigerar ? "redigerar" : ""} ${p.className ?? ""}`}
      fontFamily="Segoe UI, Arial, sans-serif"
      onPointerMove={p.onPointerMove}
      onPointerUp={p.onPointerUp}
      onPointerCancel={p.onPointerCancel}
    >
      <defs>
        <SpecSvg spec={glödFilterSpec(`${prefix}-glod`)} />
        {färger.map((f) => (
          <SpecSvg key={f} spec={pilSpec(pilId(f), f)} />
        ))}
      </defs>

      <g onClick={p.onBakgrundKlick}>
        {scen.bakgrund.typ === "stad" && <Stad prefix={prefix} />}
        {scen.bakgrund.typ === "tom" && <rect width={SCEN_BREDD} height={H} fill="#f8fafc" />}
        {scen.bakgrund.typ === "bild" && (
          <image href={scen.bakgrund.data} x={0} y={0} width={SCEN_BREDD} height={H} preserveAspectRatio="xMidYMid slice" />
        )}
      </g>

      {/* Figurerna – nycklade, så att synligheten TONAS mellan ramarna. */}
      {figurer.map((f) => {
        const def = FIGURER[f.typ];
        const s = f.skala ?? 1;
        const dold = dolda.has(f.id);
        const [rx, ry, rw, rh] = figurRuta(f);
        return (
          <g
            key={f.id}
            className={`ark-scen-figur ${dold ? "dold" : ""}`}
            data-figur={f.id}
            style={{ opacity: dold ? (visaDolda ? 0.28 : 0) : 1, pointerEvents: dold && !visaDolda ? "none" : undefined }}
            onPointerDown={p.onFigurDown ? (e) => p.onFigurDown!(f.id, e) : undefined}
          >
            {/* Osynlig träffyta – en figur ska gå att ta i hela sin ruta, inte bara i det ritade. */}
            <rect x={rx} y={ry} width={rw} height={rh} fill="transparent" />
            <g transform={`translate(${f.x},${f.y}) scale(${s})`}>{def.rita()}</g>
            {f.namn && (
              <text
                x={f.x}
                y={ry + rh + 20}
                textAnchor="middle"
                fontSize={17}
                fontWeight={600}
                fill="#1f2937"
                stroke="#ffffff"
                strokeWidth={4}
                paintOrder="stroke"
              >
                {f.namn}
              </text>
            )}
            {redigerar && p.tända?.has(f.id) && p.vald !== f.id && p.kopplaFrån !== f.id && (
              <rect
                className="ark-scen-tand"
                x={rx - 8}
                y={ry - 8}
                width={rw + 16}
                height={rh + 16}
                rx={10}
                fill="rgba(232, 89, 12, 0.08)"
                stroke="#e8590c"
                strokeWidth={2.5}
                pointerEvents="none"
              />
            )}
            {redigerar && (p.vald === f.id || p.kopplaFrån === f.id || (dold && visaDolda)) && (
              <rect
                x={rx - 8}
                y={ry - 8}
                width={rw + 16}
                height={rh + 16}
                rx={8}
                fill="none"
                stroke={p.kopplaFrån === f.id ? "#e8590c" : "#475467"}
                strokeWidth={2}
                strokeDasharray="7 5"
              />
            )}
          </g>
        );
      })}

      {/* Markeringarna kring figurerna. */}
      {rs.markeringar
        .filter((m) => syns(m.figur))
        .map((m) => (
          <g key={`m-${m.figur}-${m.verktyg}-${m.färg}`} className="ark-scen-in" pointerEvents="none">
            <SpecSvg spec={nodEffektSpec(figurRuta(figurAv.get(m.figur)!), m.verktyg, m.färg)} />
          </g>
        ))}

      {/* Pulserna mellan figurerna. */}
      {rs.pulser
        .filter((x) => syns(x.från) && syns(x.till))
        .map((x) => {
          const väg = pulsVäg(figurAv.get(x.från)!, figurAv.get(x.till)!);
          const bredd = x.text ? x.text.length * 8.4 + 22 : 0;
          return (
            <g key={x.id} className="ark-scen-in">
              <g pointerEvents="none">
                <SpecSvg spec={kantEffektSpec(väg.d, "puls", x.färg, `url(#${pilId(x.färg)})`, glöd)} />
              </g>
              {redigerar && (
                <path
                  d={väg.d}
                  fill="none"
                  stroke={p.valdPuls === x.id ? "rgba(31,92,158,0.25)" : "transparent"}
                  strokeWidth={16}
                  className="ark-scen-pulstraff"
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onPulsKlick?.(x.id);
                  }}
                />
              )}
              {x.text && (
                <g pointerEvents="none">
                  <rect
                    x={väg.mitt.x - bredd / 2}
                    y={väg.mitt.y - 15}
                    width={bredd}
                    height={30}
                    rx={15}
                    fill="#ffffff"
                    stroke={x.färg}
                    strokeWidth={2}
                  />
                  <text x={väg.mitt.x} y={väg.mitt.y + 5.5} textAnchor="middle" fontSize={15} fontWeight={600} fill="#1f2937">
                    {x.text}
                  </text>
                </g>
              )}
            </g>
          );
        })}

      {/* Pulspunkterna – små cirklar vars ringar pulserar utåt, ovanpå figurerna. */}
      {(rs.pulspunkter ?? []).map((pt) => {
        const r = 6 * (pt.storlek ?? 1);
        const ring = (begin: string) => (
          <circle cx={pt.x} cy={pt.y} r={r} fill="none" stroke={pt.färg} strokeWidth={2.5} opacity={0}>
            <animate attributeName="r" from={r} to={r * 3.6} dur="1.6s" begin={begin} repeatCount="indefinite" />
            <animate attributeName="opacity" from={0.85} to={0} dur="1.6s" begin={begin} repeatCount="indefinite" />
          </circle>
        );
        return (
          <g
            key={pt.id}
            className="ark-scen-in ark-scen-pulspunkt"
            data-pulspunkt={pt.id}
            onPointerDown={p.onPulspunktDown ? (e) => p.onPulspunktDown!(pt.id, e) : undefined}
          >
            {/* Träffyta – en punkt på 12 px ska ändå gå att ta i. */}
            <circle cx={pt.x} cy={pt.y} r={Math.max(14, r * 2.2)} fill="transparent" />
            {ring("0s")}
            {ring("0.8s")}
            <circle cx={pt.x} cy={pt.y} r={r} fill={pt.färg} stroke="#ffffff" strokeWidth={1.5} />
            {redigerar && p.valdPunkt === pt.id && (
              <circle
                cx={pt.x}
                cy={pt.y}
                r={r * 2.6}
                fill="none"
                stroke="#e8590c"
                strokeWidth={2}
                strokeDasharray="5 4"
                pointerEvents="none"
              />
            )}
          </g>
        );
      })}

      {/* Textrutorna – bildtexter, inte knutna till någon figur. */}
      {(rs.textrutor ?? []).map((t) => {
        const l = textrutaLäge(t);
        const m = l.m;
        const tom = !l.rubrik && !l.rader.length;
        const topp = t.y + m.luft;
        // Färgerna: vald bakgrund lite genomskinlig (bilden ska anas bakom),
        // annars den mörka. På ljus bakgrund blir rubriken mörk, annars syns den inte.
        const ljus = t.bakgrund ? ärLjus(t.bakgrund) : false;
        const textfärg = t.textfärg ?? (ljus ? "#1f2937" : "#f8fafc");
        const rubrikfärg = ljus ? "#b45309" : "#f5a524";
        return (
          <g
            key={t.id}
            className="ark-scen-in ark-scen-textruta"
            data-textruta={t.id}
            onPointerDown={p.onTextrutaDown ? (e) => p.onTextrutaDown!(t.id, e) : undefined}
          >
            <rect
              x={t.x}
              y={t.y}
              width={t.bredd}
              height={l.h}
              rx={10 * (t.skala ?? 1)}
              fill={t.bakgrund ?? "#0f172a"}
              fillOpacity={0.86}
              stroke={ljus ? "rgba(15,23,42,0.18)" : "rgba(255,255,255,0.18)"}
            />
            {l.rubrik && (
              <text x={t.x + m.luft} y={topp + m.rubrik} fontSize={m.rubrik} fontWeight={700} fill={rubrikfärg}>
                {l.rubrik}
              </text>
            )}
            {l.rubrik && l.rader.length > 0 && (
              <line
                x1={t.x + m.luft}
                x2={t.x + t.bredd - m.luft}
                y1={topp + m.rad + m.skiljare / 2 - 1}
                y2={topp + m.rad + m.skiljare / 2 - 1}
                stroke={textfärg}
                strokeOpacity={0.25}
              />
            )}
            {l.rader.map((r, i) => (
              <text
                key={i}
                x={t.x + m.luft}
                y={topp + (l.rubrik ? m.rad + m.skiljare : 0) + m.text + i * m.rad}
                fontSize={m.text}
                fill={textfärg}
              >
                {r}
              </text>
            ))}
            {tom && redigerar && (
              <text x={t.x + m.luft} y={t.y + l.h / 2 + 5} fontSize={14 * (t.skala ?? 1)} fill={textfärg} fillOpacity={0.55}>
                Skriv i raden ovanför bilden
              </text>
            )}
            {redigerar && p.valdText === t.id && (
              <rect
                x={t.x - 6}
                y={t.y - 6}
                width={t.bredd + 12}
                height={l.h + 12}
                rx={12}
                fill="none"
                stroke="#e8590c"
                strokeWidth={2}
                strokeDasharray="7 5"
                pointerEvents="none"
              />
            )}
          </g>
        );
      })}

      {/* Pratbubblorna överst. */}
      {rs.bubblor
        .filter((b) => syns(b.figur) && b.text.trim())
        .map((b) => {
          const l = bubblaLäge(figurAv.get(b.figur)!, b.text, SCEN_BREDD);
          return (
            <g key={`b-${b.figur}-${b.text}`} className="ark-scen-in ark-scen-bubbla" pointerEvents="none">
              <rect x={l.x} y={l.y} width={l.w} height={l.h} rx={14} fill="#ffffff" stroke="#475467" strokeWidth={2} />
              <path d={l.spets} fill="#ffffff" stroke="#475467" strokeWidth={2} strokeLinejoin="round" />
              {/* Täcker spetsens linje in mot bubblan. */}
              <rect x={l.sx - 7.5} y={l.y + l.h - 3} width={15} height={4} fill="#ffffff" />
              {l.rader.map((r, i) => (
                <text key={i} x={l.x + 14} y={l.y + 10 + BUBBLA_TEXT + i * 22} fontSize={BUBBLA_TEXT} fill="#1f2937">
                  {r}
                </text>
              ))}
            </g>
          );
        })}
    </svg>
  );
});
