/**
 * SYMBOLFORMER SOM DATA – hur en symbol ritas, beskrivet så att det kan ligga
 * i ett stilpaket.
 *
 * En symbol är en lista RITDELAR (rektangel, cirkel, polygon, bana, tecken …).
 * Måtten är tal, eller uttryck i symbolens bredd och höjd, så att samma
 * beskrivning duger både för en ikon i fast storlek och för en ruta som växer
 * med sin text. Färgerna pekar på stilens egna (`fyll`, `linje` …) eller är en
 * hexfärg.
 *
 * Produktens egna symboler (`standardsymboler.ts`) är skrivna i samma form och
 * ritas av samma kod som ett pakets – EN ritare (`ritaSymbol`).
 *
 * Det som står här sätts in i SVG-markup. `läsSymbol` släpper därför bara
 * igenom tal, kända kommandon och färger av ofarlig form, och bygger om varje
 * del fält för fält – ett paket kan inte smuggla in element eller attribut.
 */

/**
 * Ett mått: ett tal, `[konstant, andel av bredden, andel av höjden]` (höjden
 * får utelämnas), eller det minsta/största av två mått.
 * `[-8, 1]` är alltså "8 från högerkanten" och `[0, 0.5]` "mitt på".
 */
export type Mått = number | [number, number] | [number, number, number] | { min: [Mått, Mått] } | { max: [Mått, Mått] };

/** Stilens egna färger för symbolen, ingen färg, eller en hexfärg. */
export type Färgval = string;
const FÄRGNAMN = new Set(["fyll", "linje", "text", "ljus", "ingen"]);

interface Gemensamt {
  fyll?: Färgval;
  linje?: Färgval;
  /** Linjens bredd. */
  bredd?: number;
  /** Fyllningens täckning, 0–1. */
  täckning?: number;
  /** Rundade skarvar och ändar. */
  rund?: boolean;
}

export type Ritdel = Gemensamt &
  (
    | { form: "rektangel"; x: Mått; y: Mått; b: Mått; h: Mått; r?: number }
    | { form: "cirkel"; x: Mått; y: Mått; r: Mått }
    | { form: "ellips"; x: Mått; y: Mått; rx: Mått; ry: Mått }
    | { form: "polygon" | "linjer"; punkter: Mått[] }
    | { form: "linje"; x1: Mått; y1: Mått; x2: Mått; y2: Mått }
    /** En SVG-bana: kommandon som strängar, talen som mått. */
    | { form: "bana"; d: (string | Mått)[] }
    | { form: "tecken"; x: Mått; y: Mått; tecken: string; storlek: number; fet?: boolean }
  );

export type Symbol = Ritdel[];

const TAK_DELAR = 24;
const TAK_PUNKTER = 200;
const FÄRG = /^#[0-9a-fA-F]{3,8}$/;
const KOMMANDO = /^[MLHVCSQTAZmlhvcsqtaz]$/;

function tal(v: unknown, vad: string, min = -10000, max = 10000): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw new Error(`Ogiltigt tal i ${vad}: ${String(v).slice(0, 30)}`);
  return v;
}

function mått(v: unknown, vad: string, djup = 0): Mått {
  if (typeof v === "number") return tal(v, vad);
  if (Array.isArray(v) && (v.length === 2 || v.length === 3)) {
    return v.map((n) => tal(n, vad)) as Mått;
  }
  if (v && typeof v === "object" && djup < 3) {
    const o = v as { min?: unknown; max?: unknown };
    for (const nyckel of ["min", "max"] as const) {
      const par = o[nyckel];
      if (Array.isArray(par) && par.length === 2) {
        return { [nyckel]: [mått(par[0], vad, djup + 1), mått(par[1], vad, djup + 1)] } as Mått;
      }
    }
  }
  throw new Error(`Ogiltigt mått i ${vad}.`);
}

function färgval(v: unknown, vad: string): Färgval | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "string" && (FÄRGNAMN.has(v) || FÄRG.test(v))) return v;
  throw new Error(`Ogiltig färg i ${vad}: ${String(v).slice(0, 40)}`);
}

/** En symbol ur ett paket (okänd JSON). Kastar på allt som inte är en känd, ofarlig ritdel. */
export function läsSymbol(json: unknown, vad: string): Symbol {
  if (!Array.isArray(json) || json.length > TAK_DELAR)
    throw new Error(`Symbolen ${vad} ska vara en lista med högst ${TAK_DELAR} ritdelar.`);
  return json.map((rå, i): Ritdel => {
    const här = `${vad}[${i}]`;
    if (!rå || typeof rå !== "object") throw new Error(`Ogiltig ritdel i ${här}.`);
    const j = rå as Record<string, unknown>;
    const gemensamt: Gemensamt = {};
    const fyll = färgval(j.fyll, `${här}.fyll`);
    const linje = färgval(j.linje, `${här}.linje`);
    if (fyll !== undefined) gemensamt.fyll = fyll;
    if (linje !== undefined) gemensamt.linje = linje;
    if (j.bredd !== undefined) gemensamt.bredd = tal(j.bredd, `${här}.bredd`, 0, 10);
    if (j.täckning !== undefined) gemensamt.täckning = tal(j.täckning, `${här}.täckning`, 0, 1);
    if (j.rund !== undefined) gemensamt.rund = Boolean(j.rund);
    const m = (fält: string) => mått(j[fält], `${här}.${fält}`);
    switch (j.form) {
      case "rektangel":
        return { ...gemensamt, form: "rektangel", x: m("x"), y: m("y"), b: m("b"), h: m("h"), ...(j.r !== undefined ? { r: tal(j.r, `${här}.r`, 0, 200) } : {}) };
      case "cirkel":
        return { ...gemensamt, form: "cirkel", x: m("x"), y: m("y"), r: m("r") };
      case "ellips":
        return { ...gemensamt, form: "ellips", x: m("x"), y: m("y"), rx: m("rx"), ry: m("ry") };
      case "polygon":
      case "linjer": {
        const p = j.punkter;
        if (!Array.isArray(p) || p.length < 4 || p.length % 2 || p.length > TAK_PUNKTER)
          throw new Error(`Ogiltiga punkter i ${här}.`);
        return { ...gemensamt, form: j.form, punkter: p.map((v) => mått(v, `${här}.punkter`)) };
      }
      case "linje":
        return { ...gemensamt, form: "linje", x1: m("x1"), y1: m("y1"), x2: m("x2"), y2: m("y2") };
      case "bana": {
        const d = j.d;
        if (!Array.isArray(d) || !d.length || d.length > TAK_PUNKTER || typeof d[0] !== "string")
          throw new Error(`Ogiltig bana i ${här}.`);
        return {
          ...gemensamt,
          form: "bana",
          d: d.map((v) => {
            if (typeof v !== "string") return mått(v, `${här}.d`);
            if (!KOMMANDO.test(v)) throw new Error(`Okänt kommando i ${här}.d: ${v.slice(0, 10)}`);
            return v;
          }),
        };
      }
      case "tecken": {
        if (typeof j.tecken !== "string" || !j.tecken || [...j.tecken].length > 3)
          throw new Error(`Ogiltigt tecken i ${här}.`);
        return {
          ...gemensamt,
          form: "tecken",
          x: m("x"),
          y: m("y"),
          tecken: j.tecken,
          storlek: tal(j.storlek, `${här}.storlek`, 4, 40),
          ...(j.fet ? { fet: true } : {}),
        };
      }
      default:
        throw new Error(`Okänd form i ${här}: ${String(j.form).slice(0, 20)}`);
    }
  });
}

/** Stilens färger för den symbol som ritas. */
export interface Symbolfärger {
  fill: string;
  stroke: string;
  text: string;
  ljus?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f = (n: number) => String(Number(n.toFixed(2)));

function räkna(m: Mått, w: number, h: number): number {
  if (typeof m === "number") return m;
  if (Array.isArray(m)) return m[0] + m[1] * w + (m[2] ?? 0) * h;
  if ("min" in m) return Math.min(räkna(m.min[0], w, h), räkna(m.min[1], w, h));
  return Math.max(räkna(m.max[0], w, h), räkna(m.max[1], w, h));
}

/** Ritar symbolen i en ruta som är `w` × `h`, med stilens färger och typsnitt. */
export function ritaSymbol(symbol: Symbol, w: number, h: number, s: Symbolfärger, teckensnitt: string): string {
  const färg = (v: Färgval | undefined, förval: string): string => {
    switch (v) {
      case undefined:
        return förval;
      case "fyll":
        return s.fill;
      case "linje":
        return s.stroke;
      case "text":
        return s.text;
      case "ljus":
        return s.ljus ?? s.fill;
      case "ingen":
        return "none";
      default:
        return v;
    }
  };
  const n = (m: Mått) => f(räkna(m, w, h));
  return symbol
    .map((d) => {
      const fyll = färg(d.fyll, d.form === "linje" || d.form === "linjer" ? "none" : s.fill);
      const linje = färg(d.linje, "none");
      const stil =
        `fill="${fyll}"` +
        (d.täckning !== undefined ? ` fill-opacity="${f(d.täckning)}"` : "") +
        (linje !== "none" ? ` stroke="${linje}" stroke-width="${f(d.bredd ?? 1.4)}"` : "") +
        (d.rund ? ` stroke-linejoin="round" stroke-linecap="round"` : "");
      switch (d.form) {
        case "rektangel":
          return `<rect x="${n(d.x)}" y="${n(d.y)}" width="${n(d.b)}" height="${n(d.h)}"${d.r ? ` rx="${f(d.r)}"` : ""} ${stil}/>`;
        case "cirkel":
          return `<circle cx="${n(d.x)}" cy="${n(d.y)}" r="${n(d.r)}" ${stil}/>`;
        case "ellips":
          return `<ellipse cx="${n(d.x)}" cy="${n(d.y)}" rx="${n(d.rx)}" ry="${n(d.ry)}" ${stil}/>`;
        case "polygon":
        case "linjer": {
          const p = d.punkter.map(n);
          const par = p.map((v, i) => (i % 2 ? `${p[i - 1]},${v}` : "")).filter(Boolean).join(" ");
          return `<${d.form === "polygon" ? "polygon" : "polyline"} points="${par}" ${stil}/>`;
        }
        case "linje":
          return `<line x1="${n(d.x1)}" y1="${n(d.y1)}" x2="${n(d.x2)}" y2="${n(d.y2)}" ${stil}/>`;
        case "bana":
          return `<path d="${d.d.map((v) => (typeof v === "string" ? v : n(v))).join(" ")}" ${stil}/>`;
        case "tecken":
          return `<text x="${n(d.x)}" y="${n(d.y)}" text-anchor="middle" font-family="${teckensnitt}" font-size="${f(d.storlek)}"${d.fet ? ` font-weight="700"` : ""} fill="${färg(d.fyll, s.stroke)}">${esc(d.tecken)}</text>`;
      }
    })
    .join("\n");
}
