/**
 * Bildflikens figurer och bakgrund – EN plats för allt som ritas i scenen.
 *
 * Varje figur ritas i lokala koordinater med sin MITT i (0, 0), så att
 * placering, markering och pulser bara behöver mitten och måtten (`FIGURER`).
 * Stilen är platt och lugn: det är det som HÄNDER – pulserna, markeringarna –
 * som ska dra blicken, inte illustrationen.
 */

import type { ReactNode } from "react";
import type { FigurTyp } from "@/core/ram-scen";
import { SCEN_BREDD, STAD_HÖJD } from "@/core/ram-scen";

export interface FigurDef {
  /** Förvalt namn när figuren läggs till. */
  namn: string;
  /** Grupp i paletten. */
  grupp: "Personer" | "Byggnader" | "Ikoner";
  w: number;
  h: number;
  rita: () => ReactNode;
}

const HUD = "#f1c7a0";
const MÖRK = "#344054";
const LINJE = "#475467";

/** En person: huvud, kropp, ben. `extra` ritas ovanpå (hjälm, headset …). */
function person(tröja: string, extra?: ReactNode, hår = "#5b4636"): ReactNode {
  return (
    <g>
      <rect x={-11} y={16} width={9} height={30} rx={4} fill={MÖRK} />
      <rect x={2} y={16} width={9} height={30} rx={4} fill={MÖRK} />
      <rect x={-17} y={-14} width={34} height={36} rx={11} fill={tröja} />
      <rect x={-23} y={-10} width={8} height={26} rx={4} fill={tröja} />
      <rect x={15} y={-10} width={8} height={26} rx={4} fill={tröja} />
      <circle cx={0} cy={-28} r={12} fill={HUD} />
      <path d="M-12,-30 a12,12 0 0 1 24,0 q-6,-5 -12,-4 q-7,0 -12,4 z" fill={hår} />
      {extra}
    </g>
  );
}

function fönster(x0: number, y0: number, kol: number, rad: number, bw: number, bh: number, dx: number, dy: number, färg: string): ReactNode[] {
  const ut: ReactNode[] = [];
  for (let r = 0; r < rad; r++)
    for (let k = 0; k < kol; k++)
      ut.push(<rect key={`${r}-${k}`} x={x0 + k * dx} y={y0 + r * dy} width={bw} height={bh} rx={1.5} fill={färg} />);
  return ut;
}

export const FIGURER: Record<FigurTyp, FigurDef> = {
  hyresgast: {
    namn: "Kund",
    grupp: "Personer",
    w: 50,
    h: 94,
    rita: () => person("#2f77c4"),
  },
  person: {
    namn: "Person",
    grupp: "Personer",
    w: 50,
    h: 94,
    rita: () => person("#5b8c6a", undefined, "#2b2b2b"),
  },
  hantverkare: {
    namn: "Hantverkare",
    grupp: "Personer",
    w: 50,
    h: 94,
    rita: () =>
      person(
        "#f08c00",
        <g>
          <rect x={-17} y={2} width={34} height={5} fill="#fff3bf" />
          <path d="M-14,-31 a14,13 0 0 1 28,0 z" fill="#fab005" />
          <rect x={-16} y={-32} width={32} height={4} rx={2} fill="#f59f00" />
        </g>,
      ),
  },
  handlaggare: {
    namn: "Handläggare",
    grupp: "Personer",
    w: 50,
    h: 94,
    rita: () =>
      person(
        "#6b4aa0",
        <g fill="none" stroke={MÖRK} strokeWidth={2.4} strokeLinecap="round">
          <path d="M-13,-28 a13,13 0 0 1 26,0" />
          <rect x={-16} y={-31} width={5} height={9} rx={2} fill={MÖRK} />
          <rect x={11} y={-31} width={5} height={9} rx={2} fill={MÖRK} />
          <path d="M13,-22 q0,8 -9,8" />
        </g>,
        "#8a5a3c",
      ),
  },
  huvudkontor: {
    namn: "Kontor",
    grupp: "Byggnader",
    w: 190,
    h: 210,
    rita: () => (
      <g>
        <rect x={-95} y={-35} width={60} height={140} fill="#dfe6ef" stroke="#9aa9bd" strokeWidth={1.5} />
        {fönster(-87, -25, 3, 7, 12, 10, 17, 18, "#a9c7e3")}
        <rect x={-40} y={-105} width={135} height={210} fill="#eef2f7" stroke="#9aa9bd" strokeWidth={1.5} />
        <rect x={-40} y={-105} width={135} height={26} fill="#1f5c9e" />
        <text x={27} y={-86} textAnchor="middle" fontSize={15} fontWeight={700} fill="#fff" letterSpacing={2}>
          KONTOR
        </text>
        {fönster(-30, -70, 5, 7, 18, 13, 24, 21, "#9cc3e6")}
        <rect x={12} y={75} width={30} height={30} fill="#5f7288" />
        <line x1={27} y1={75} x2={27} y2={105} stroke="#eef2f7" strokeWidth={1.5} />
        <line x1={80} y1={-105} x2={80} y2={-132} stroke={LINJE} strokeWidth={2} />
        <path d="M80,-132 l18,5 l-18,5 z" fill="#e8590c" />
      </g>
    ),
  },
  bostadshus: {
    namn: "Bostadshus",
    grupp: "Byggnader",
    w: 150,
    h: 170,
    rita: () => (
      <g>
        <path d="M-80,-55 L0,-85 L80,-55 z" fill="#8f4f3a" />
        <rect x={-72} y={-56} width={144} height={141} fill="#d98b6a" stroke="#b56d50" strokeWidth={1.5} />
        {fönster(-60, -44, 5, 4, 16, 16, 26, 28, "#ffe8a3")}
        {[0, 1, 2, 3].map((r) => (
          <rect key={r} x={-64} y={-24 + r * 28} width={128} height={3} fill="#b56d50" />
        ))}
        <rect x={-12} y={55} width={24} height={30} rx={2} fill="#6b3f2e" />
        <circle cx={7} cy={71} r={1.8} fill="#ffe8a3" />
      </g>
    ),
  },
  dator: {
    namn: "Dator",
    grupp: "Ikoner",
    w: 84,
    h: 72,
    rita: () => (
      <g>
        <rect x={-42} y={-36} width={84} height={54} rx={5} fill={MÖRK} />
        <rect x={-37} y={-31} width={74} height={44} rx={2} fill="#a5d8ff" />
        <rect x={-30} y={-24} width={30} height={5} rx={2} fill="#fff" />
        <rect x={-30} y={-14} width={46} height={4} rx={2} fill="#e7f5ff" />
        <rect x={-30} y={-6} width={38} height={4} rx={2} fill="#e7f5ff" />
        <rect x={-6} y={18} width={12} height={10} fill={LINJE} />
        <rect x={-22} y={28} width={44} height={6} rx={3} fill={LINJE} />
      </g>
    ),
  },
  mobil: {
    namn: "Mobil",
    grupp: "Ikoner",
    w: 44,
    h: 76,
    rita: () => (
      <g>
        <rect x={-22} y={-38} width={44} height={76} rx={8} fill={MÖRK} />
        <rect x={-18} y={-30} width={36} height={58} rx={3} fill="#a5d8ff" />
        <rect x={-12} y={-22} width={24} height={9} rx={3} fill="#fff" />
        <rect x={-12} y={-8} width={24} height={9} rx={3} fill="#fff" />
        <rect x={-6} y={31} width={12} height={3} rx={1.5} fill="#98a2b3" />
      </g>
    ),
  },
  system: {
    namn: "System",
    grupp: "Ikoner",
    w: 64,
    h: 84,
    rita: () => (
      <g>
        <rect x={-32} y={-42} width={64} height={84} rx={5} fill="#475467" />
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <rect x={-26} y={-36 + i * 20} width={52} height={15} rx={2} fill="#667085" />
            <circle cx={-18} cy={-28.5 + i * 20} r={2.6} fill={i === 1 ? "#fab005" : "#51cf66"} />
            <rect x={-8} y={-30 + i * 20} width={28} height={3} rx={1.5} fill="#98a2b3" />
          </g>
        ))}
      </g>
    ),
  },
  moln: {
    namn: "Moln",
    grupp: "Ikoner",
    w: 110,
    h: 64,
    rita: () => (
      <g fill="#e7f5ff" stroke="#74c0fc" strokeWidth={2}>
        <path d="M-40,26 a22,22 0 0 1 -2,-44 a30,30 0 0 1 56,-8 a24,24 0 0 1 34,24 a18,18 0 0 1 -6,28 z" />
      </g>
    ),
  },
  dokument: {
    namn: "Dokument",
    grupp: "Ikoner",
    w: 58,
    h: 72,
    rita: () => (
      <g>
        <path d="M-29,-36 h40 l18,18 v54 h-58 z" fill="#fff" stroke={LINJE} strokeWidth={2} />
        <path d="M11,-36 v18 h18" fill="#e4e7ec" stroke={LINJE} strokeWidth={2} />
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={-20} y={-10 + i * 10} width={i === 3 ? 22 : 38} height={3.5} rx={1.5} fill="#98a2b3" />
        ))}
      </g>
    ),
  },
  mejl: {
    namn: "Mejl",
    grupp: "Ikoner",
    w: 80,
    h: 54,
    rita: () => (
      <g>
        <rect x={-40} y={-27} width={80} height={54} rx={5} fill="#fff" stroke={LINJE} strokeWidth={2} />
        <path d="M-38,-24 L0,4 L38,-24" fill="none" stroke={LINJE} strokeWidth={2} strokeLinejoin="round" />
      </g>
    ),
  },
  nyckel: {
    namn: "Nyckel",
    grupp: "Ikoner",
    w: 80,
    h: 38,
    rita: () => (
      <g fill="#fab005" stroke="#e67700" strokeWidth={2}>
        <circle cx={-24} cy={0} r={16} />
        <circle cx={-24} cy={0} r={6} fill="#fff" />
        <path d="M-8,-4 h46 v8 h-8 v8 h-8 v-8 h-30 z" />
      </g>
    ),
  },
  varning: {
    namn: "Varning",
    grupp: "Ikoner",
    w: 76,
    h: 66,
    rita: () => (
      <g>
        <path d="M0,-33 L38,33 L-38,33 z" fill="#ffd43b" stroke="#e67700" strokeWidth={3} strokeLinejoin="round" />
        <rect x={-3.5} y={-12} width={7} height={26} rx={3} fill={MÖRK} />
        <circle cx={0} cy={23} r={4} fill={MÖRK} />
      </g>
    ),
  },
  klar: {
    namn: "Klart",
    grupp: "Ikoner",
    w: 66,
    h: 66,
    rita: () => (
      <g>
        <circle r={33} fill="#40c057" />
        <path d="M-15,1 L-4,12 L17,-11" fill="none" stroke="#fff" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    ),
  },
  klocka: {
    namn: "Tid",
    grupp: "Ikoner",
    w: 66,
    h: 66,
    rita: () => (
      <g>
        <circle r={32} fill="#fff" stroke={LINJE} strokeWidth={3} />
        <path d="M0,-20 V0 L14,9" fill="none" stroke={MÖRK} strokeWidth={4} strokeLinecap="round" />
      </g>
    ),
  },
  servicebil: {
    namn: "Servicebil",
    grupp: "Ikoner",
    w: 136,
    h: 72,
    rita: () => (
      <g>
        <path d="M-66,-30 h86 v50 h-86 z" fill="#fff" stroke="#9aa9bd" strokeWidth={2} />
        <path d="M20,-14 h26 l20,18 v16 h-46 z" fill="#1f5c9e" />
        <path d="M26,-9 h17 l13,12 h-30 z" fill="#a5d8ff" />
        <rect x={-66} y={-4} width={86} height={7} fill="#1f5c9e" />
        {[-40, 42].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy={22} r={13} fill={MÖRK} />
            <circle cx={cx} cy={22} r={5} fill="#d0d5dd" />
          </g>
        ))}
      </g>
    ),
  },
};

export const FIGURGRUPPER: FigurDef["grupp"][] = ["Personer", "Byggnader", "Ikoner"];

/** Figurens ruta i scenen (x, y, b, h) med skalan inräknad. */
export function figurRuta(f: { typ: FigurTyp; x: number; y: number; skala?: number }): [number, number, number, number] {
  const d = FIGURER[f.typ];
  const s = f.skala ?? 1;
  return [f.x - (d.w * s) / 2, f.y - (d.h * s) / 2, d.w * s, d.h * s];
}

/* ------------------------------------------------------------------ */
/* Staden                                                              */
/* ------------------------------------------------------------------ */

/** Staden bakom figurerna. Lugn och ljus – figurerna ska stå ut mot den. */
export function Stad({ prefix }: { prefix: string }) {
  const W = SCEN_BREDD;
  const H = STAD_HÖJD;
  const långt = [
    [40, 360, 90], [140, 300, 70], [220, 390, 110], [340, 330, 80], [430, 280, 60], [500, 370, 120],
    [640, 310, 90], [740, 350, 70], [820, 290, 100], [930, 380, 80], [1020, 320, 110], [1140, 360, 70],
    [1220, 300, 90], [1320, 340, 120], [1450, 310, 80], [1530, 370, 70],
  ];
  const nära = [
    [0, 470, 120], [150, 430, 90], [600, 450, 130], [760, 490, 100], [880, 440, 110], [1440, 460, 160],
  ];
  const träd = [90, 620, 700, 900, 1010, 1420, 1540];
  return (
    <g>
      <defs>
        <linearGradient id={`${prefix}-himmel`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cfe6fb" />
          <stop offset="1" stopColor="#f3f8ff" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${prefix}-himmel)`} />
      <circle cx={1400} cy={130} r={58} fill="#ffe8a3" opacity={0.9} />
      {[
        [260, 120, 1],
        [760, 80, 1.3],
        [1120, 170, 0.9],
      ].map(([x, y, s], i) => (
        <g key={i} transform={`translate(${x},${y}) scale(${s})`} fill="#fff" opacity={0.9}>
          <ellipse cx={0} cy={0} rx={60} ry={20} />
          <ellipse cx={-25} cy={-12} rx={30} ry={20} />
          <ellipse cx={20} cy={-16} rx={34} ry={24} />
        </g>
      ))}
      {långt.map(([x, y, w], i) => (
        <rect key={i} x={x} y={y} width={w} height={620 - y} fill="#c9d8e8" />
      ))}
      {nära.map(([x, y, w], i) => (
        <g key={i}>
          <rect x={x} y={y} width={w} height={640 - y} fill="#afc3d8" />
          {fönster(x + 12, y + 16, Math.floor((w - 16) / 22), Math.floor((600 - y) / 30), 10, 12, 22, 30, "#d6e3f0")}
        </g>
      ))}
      <rect x={0} y={600} width={W} height={H - 600} fill="#d3e7c4" />
      <rect x={0} y={700} width={W} height={30} fill="#e7e3da" />
      <rect x={0} y={730} width={W} height={100} fill="#8a919c" />
      {Array.from({ length: 20 }, (_, i) => (
        <rect key={i} x={i * 84 + 10} y={777} width={46} height={6} rx={3} fill="#f8f9fa" />
      ))}
      <rect x={0} y={830} width={W} height={22} fill="#e7e3da" />
      {träd.map((x) => (
        <g key={x}>
          <rect x={x - 4} y={620} width={8} height={40} fill="#8c6a4f" />
          <circle cx={x} cy={608} r={26} fill="#8cc084" />
          <circle cx={x - 14} cy={620} r={16} fill="#7fb77e" />
        </g>
      ))}
    </g>
  );
}
