/**
 * SAMLAD VY – flera lager framme samtidigt, lagda intill varandra.
 *
 * En skiss med många lager är ofta stor, och lagren ligger där de fick plats.
 * Väljer man två som står långt ifrån varandra blir bilden mest tomrum. Här
 * flyttas det som visas ihop – BARA i bilden; skissen själv rörs aldrig, och
 * därför är ritytan låst så länge vyn är samlad (SkissVy).
 *
 * Regeln:
 *  1. Det som visas delas i BLOCK – det som hör ihop och måste stå kvar i
 *     förhållande till varandra: samma lager, samma zon, ihopkopplat eller
 *     överlappande.
 *  2. Inom ett block tas stora tomma band bort (där ett lager som inte visas
 *     stod). Bara band som är tomma över HELA blockets höjd eller bredd –
 *     så står det som stod i linje kvar i linje, och pilarna är lika raka.
 *  3. Blocken ställs i lagrens ordning, rad för rad som text: från vänster,
 *     ny rad när bredden är slut. Bredden väljs så att bilden kommer så nära
 *     en liggande skärm som blocken tillåter.
 *
 * Både ritytan, exporten och utskriften frågar `visadSkiss` – en regel, en plats.
 */

import { filtreraSkiss, type SkissObjekt, type SkissZon, type Systemskiss } from "@/core/systemskiss";
import { objektLayout } from "./skiss-svg";

/** Luften mellan två block. */
const BLOCKLUFT = 80;
/** Ett tomt band inom ett block som är större än så här … */
const BAND_MAX = 200;
/** … dras ihop till så här. */
const BAND_KVAR = 100;
/** Zonens kant med luften innanför räknas som upptagen – ramen ska inte klämmas mot innehållet. */
const ZONKANT = { sida: 30, över: 50, under: 30 } as const;
/** Bildens form som raderna siktar på – liggande, som en skärm. */
const BREDD_PER_HÖJD = 1.6;

interface Ruta {
  x: number;
  y: number;
  b: number;
  h: number;
}

/** När lagerradens val ger en samlad vy: minst två lager framme. */
export function kanSamlas(filter: ReadonlySet<string> | null): filter is ReadonlySet<string> {
  return Boolean(filter && filter.size >= 2);
}

/**
 * Det som VISAS med lagerradens val: filtrerat, och samlat när `samla` är på
 * och minst två lager är framme.
 */
export function visadSkiss(skiss: Systemskiss, filter: ReadonlySet<string> | null, grannar: boolean, samla: boolean): Systemskiss {
  const filtrerad = filtreraSkiss(skiss, filter, grannar);
  return samla && kanSamlas(filter) ? samlaSkiss(filtrerad) : filtrerad;
}

const överlappar = (a: Ruta, b: Ruta) => a.x < b.x + b.b && b.x < a.x + a.b && a.y < b.y + b.h && b.y < a.y + a.h;
const mittI = (r: Ruta, z: Ruta) => {
  const cx = r.x + r.b / 2;
  const cy = r.y + r.h / 2;
  return cx >= z.x && cx <= z.x + z.b && cy >= z.y && cy <= z.y + z.h;
};

/** Upptagna sträckor → en funktion som drar ihop de stora tomma banden mellan dem. */
function dragIhop(upptaget: [number, number][]): (v: number) => number {
  const sorterat = [...upptaget].sort((a, b) => a[0] - b[0]);
  const band: { från: number; till: number }[] = [];
  let slut = -Infinity;
  for (const [a, b] of sorterat) {
    if (Number.isFinite(slut) && a - slut > BAND_MAX) band.push({ från: slut, till: a });
    slut = Math.max(slut, b);
  }
  if (band.length === 0) return (v) => v;
  return (v) => {
    let ut = v;
    for (const { från, till } of band) {
      if (v >= till) ut -= till - från - BAND_KVAR;
      // En kant mitt i bandet (finns inte med de upptagna sträckorna ovan, men
      // för säkerhets skull): följer bandet i proportion.
      else if (v > från) ut -= (v - från) * (1 - BAND_KVAR / (till - från));
    }
    return ut;
  };
}

/** Skissen med det som visas flyttat ihop. Se filens huvud. */
export function samlaSkiss(skiss: Systemskiss): Systemskiss {
  const lagerordning = new Map((skiss.lager ?? []).map((l, i) => [l.id, i]));
  // Objektens rutor som de RITAS – höjden växer med texten.
  const ruta = new Map<string, Ruta>();
  for (const o of skiss.objekt) {
    const r = objektLayout(o).ruta;
    ruta.set(o.id, { x: r.x, y: r.y, b: r.w, h: r.h });
  }
  for (const z of skiss.zoner) ruta.set(z.id, { x: z.x, y: z.y, b: z.b, h: z.h });
  const allt: (SkissObjekt | SkissZon)[] = [...skiss.objekt, ...skiss.zoner];
  if (allt.length === 0) return skiss;

  // 1. Blocken.
  const förälder = new Map(allt.map((v) => [v.id, v.id]));
  const rot = (id: string): string => {
    let r = id;
    while (förälder.get(r) !== r) r = förälder.get(r)!;
    förälder.set(id, r);
    return r;
  };
  const förena = (a: string, b: string) => {
    if (förälder.has(a) && förälder.has(b)) förälder.set(rot(a), rot(b));
  };
  const förstILager = new Map<string, string>();
  for (const v of allt) {
    if (!v.lager) continue;
    const första = förstILager.get(v.lager);
    if (första) förena(v.id, första);
    else förstILager.set(v.lager, v.id);
  }
  for (const k of skiss.kopplingar) förena(k.från, k.till);
  for (const z of skiss.zoner) {
    const zr = ruta.get(z.id)!;
    for (const v of allt) {
      if (v.id === z.id) continue;
      const r = ruta.get(v.id)!;
      if (mittI(r, zr) || överlappar(r, zr)) förena(v.id, z.id);
    }
  }
  for (let i = 0; i < skiss.objekt.length; i++)
    for (let j = i + 1; j < skiss.objekt.length; j++)
      if (överlappar(ruta.get(skiss.objekt[i].id)!, ruta.get(skiss.objekt[j].id)!)) förena(skiss.objekt[i].id, skiss.objekt[j].id);

  const block = new Map<string, (SkissObjekt | SkissZon)[]>();
  for (const v of allt) block.set(rot(v.id), [...(block.get(rot(v.id)) ?? []), v]);

  // 2. Varje block för sig: tomma band bort, och blockets mått.
  const ny = new Map<string, Ruta>();
  const zonId = new Set(skiss.zoner.map((z) => z.id));
  const lagda = [...block.values()].map((delar) => {
    const xs: [number, number][] = [];
    const ys: [number, number][] = [];
    for (const v of delar) {
      const r = ruta.get(v.id)!;
      if (zonId.has(v.id)) {
        xs.push([r.x, r.x + ZONKANT.sida], [r.x + r.b - ZONKANT.sida, r.x + r.b]);
        ys.push([r.y, r.y + ZONKANT.över], [r.y + r.h - ZONKANT.under, r.y + r.h]);
      } else {
        xs.push([r.x, r.x + r.b]);
        ys.push([r.y, r.y + r.h]);
      }
    }
    const fx = dragIhop(xs);
    const fy = dragIhop(ys);
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const v of delar) {
      const r = ruta.get(v.id)!;
      const n = { x: fx(r.x), y: fy(r.y), b: fx(r.x + r.b) - fx(r.x), h: fy(r.y + r.h) - fy(r.y) };
      ny.set(v.id, n);
      x1 = Math.min(x1, n.x);
      y1 = Math.min(y1, n.y);
      x2 = Math.max(x2, n.x + n.b);
      y2 = Math.max(y2, n.y + n.h);
    }
    const lager = Math.min(...delar.map((v) => (v.lager ? (lagerordning.get(v.lager) ?? Infinity) : Infinity)));
    return { delar, x: x1, y: y1, b: x2 - x1, h: y2 - y1, lager };
  });
  // 3. Blocken i lagrens ordning (utan lager: där de stod), rad för rad.
  lagda.sort((a, b) => a.lager - b.lager || a.y - b.y || a.x - b.x);
  // Bilden börjar där det första blocket stod – ensamt block står alltså kvar.
  const x0 = lagda[0].x;
  const y0 = lagda[0].y;
  /** Blockens lägen med en viss radbredd, och bildens mått. */
  const rader = (radbredd: number) => {
    const lägen: { x: number; y: number }[] = [];
    let x = x0;
    let y = y0;
    let radhöjd = 0;
    let bredd = 0;
    for (const b of lagda) {
      if (x > x0 && x + b.b > x0 + radbredd) {
        x = x0;
        y += radhöjd + BLOCKLUFT;
        radhöjd = 0;
      }
      lägen.push({ x, y });
      bredd = Math.max(bredd, x + b.b - x0);
      x += b.b + BLOCKLUFT;
      radhöjd = Math.max(radhöjd, b.h);
    }
    return { lägen, form: bredd / (y + radhöjd - y0) };
  };
  // Varje följd av block i rad ger en möjlig radbredd; den som kommer närmast skärmens form vinner.
  let bäst = rader(Infinity);
  const avvikelse = (form: number) => Math.abs(Math.log(form / BREDD_PER_HÖJD));
  for (let i = 0; i < lagda.length; i++) {
    let b = -BLOCKLUFT;
    for (let j = i; j < lagda.length; j++) {
      b += lagda[j].b + BLOCKLUFT;
      const prov = rader(b);
      if (avvikelse(prov.form) < avvikelse(bäst.form) - 1e-9) bäst = prov;
    }
  }
  const flytt = new Map<string, { dx: number; dy: number }>();
  lagda.forEach((b, i) => {
    for (const v of b.delar) flytt.set(v.id, { dx: bäst.lägen[i].x - b.x, dy: bäst.lägen[i].y - b.y });
  });

  const läge = (id: string) => {
    const n = ny.get(id)!;
    const f = flytt.get(id)!;
    return { x: Math.round(n.x + f.dx), y: Math.round(n.y + f.dy) };
  };
  return {
    ...skiss,
    // Objektens mått rörs inte (inga band går genom ett objekt); zonerna kan ha krympt.
    objekt: skiss.objekt.map((o) => ({ ...o, ...läge(o.id) })),
    zoner: skiss.zoner.map((z) => ({ ...z, ...läge(z.id), b: Math.round(ny.get(z.id)!.b), h: Math.round(ny.get(z.id)!.h) })),
  };
}
