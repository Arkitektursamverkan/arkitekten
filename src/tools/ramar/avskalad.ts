/**
 * AVSKALAD PRESENTATIONSSTIL för Ramar – processen som man visar den på en
 * skärm i ett rum, inte som man ritar den (förlagan `frames.png`, 2026-09-30).
 *
 * Samma affärsprocessmodell som verktyget ritar, men utan allt som bara betyder något
 * för den som modellerar:
 *
 *  - ZONER i stället för satelliter: varje steg hamnar i bandet för rollen som
 *    UTFÖR det (HUKI H före U). Regler följer steget före sig.
 *  - RUTOR med nummer, rubrik och en rad undertext (IT-stöden).
 *  - Mellanliggande verksamhetsobjekt faller bort; kopplingen går direkt från
 *    steg till steg. Bara processens start och slut står kvar, som små etiketter.
 *
 * Ramar lägger sina markeringar ovanpå precis som på verktygets bild: rutorna
 * och kopplingarna märks med SAMMA attribut som exportörerna sätter
 * (`ramNodAttribut`/`ramKantAttribut`), och vägarna räknas av samma router
 * (invariant 1). Id:na är modellens, så de är lika stabila som den (invariant 2).
 */

import type { ApModel, ApNode } from "@/core/affarsprocess";
import { ramKantAttribut, ramKantNyckel, ramNodAttribut } from "@/core/ram";
import {
  labelAnchor,
  pickEdgeSides,
  pointsToPath,
  routeEdge,
  type Point,
  type Rect,
  type Side,
} from "@/tools/flowchart/layout/edge-router";
import { esc } from "@/tools/flowchart/render/text-util";

/**
 * Katalogens kategori för processer som är gjorda för att VISAS. De öppnas i
 * det avskalade utseendet; "Redigera" tar fram verktygets rityta som vanligt.
 */
export const PRESENTATIONSKATEGORI = "Presentation";

/* ------------------------------------------------------------------ */
/* Modellen för bilden                                                 */
/* ------------------------------------------------------------------ */

export type AvskaladSort = "steg" | "regel" | "ände";

export interface AvskaladRuta {
  id: string;
  sort: AvskaladSort;
  /** Löpnummer för steg (1, 2, 3 …) i flödesordning. */
  nr?: number;
  rubrik: string;
  /** En rad under rubriken – stegets IT-stöd. */
  undertext?: string;
  /**
   * Steget är ett FORUM – metodens pratbubbla, i en aktivitets ställe. Ritas
   * som bubbla även här; som ruta syntes inte att steget alltid sker i möte.
   */
  forum?: boolean;
  zon: number;
  kolumn: number;
  /** Rad inom zonen (0 = huvudspåret, 1 = en gren bredvid). */
  linje: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AvskaladZon {
  namn: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AvskaladKant {
  source: string;
  target: string;
  label?: string;
  /** Kopplingens stabila nyckel – samma som Ramar märker den med (invariant 3). */
  nyckel: string;
  pts: Point[];
}

/**
 * Var en koppling lämnar och går in i sina rutor, valt för hand: sida och
 * läge längs sidan (0–1, mitten = 0,5). Nycklat på `ramKantNyckel`.
 */
export interface AvskaladKoppling {
  sourceSide?: Side;
  sourcePos?: number;
  targetSide?: Side;
  targetPos?: number;
}
export type AvskaladeKopplingar = Record<string, AvskaladKoppling>;

/** Lägen längs en sida som en ände snäpper till. */
export const SIDLÄGEN = [0.25, 0.5, 0.75];

/**
 * Den yta en koppling möter: rombens egen ruta, inte hela etikettytan.
 * Delas av ritningen och redigeraren – samma punkt åt båda.
 */
export function portRuta(r: { sort: AvskaladSort; x: number; y: number; w: number; h: number }): Rect {
  return r.sort === "regel"
    ? { x: r.x + (r.w - REGEL.romb) / 2, y: r.y + (r.h - REGEL.romb) / 2, w: REGEL.romb, h: REGEL.romb }
    : { x: r.x, y: r.y, w: r.w, h: r.h };
}

/** Punkten på en sida, `pos` längs den (0 = vänster/överst). */
export function sidPunkt(b: Rect, s: Side, pos = 0.5): Point {
  return s === "top"
    ? { x: b.x + b.w * pos, y: b.y }
    : s === "bottom"
      ? { x: b.x + b.w * pos, y: b.y + b.h }
      : s === "left"
        ? { x: b.x, y: b.y + b.h * pos }
        : { x: b.x + b.w, y: b.y + b.h * pos };
}

/**
 * Sidan och läget närmast en punkt – det ett draget kopplingshandtag landar
 * på. Läget snäpper till `SIDLÄGEN`; en romb har bara sina fyra hörn (mitten).
 */
export function närmasteSida(b: Rect, p: Point, baraMitten = false): { side: Side; pos: number } {
  const kandidater: { side: Side; d: number; t: number }[] = [
    { side: "top", d: Math.abs(p.y - b.y), t: (p.x - b.x) / b.w },
    { side: "bottom", d: Math.abs(p.y - (b.y + b.h)), t: (p.x - b.x) / b.w },
    { side: "left", d: Math.abs(p.x - b.x), t: (p.y - b.y) / b.h },
    { side: "right", d: Math.abs(p.x - (b.x + b.w)), t: (p.y - b.y) / b.h },
  ];
  const bäst = kandidater.reduce((a, c) => (c.d < a.d ? c : a));
  const pos = baraMitten ? 0.5 : SIDLÄGEN.reduce((a, c) => (Math.abs(c - bäst.t) < Math.abs(a - bäst.t) ? c : a));
  return { side: bäst.side, pos };
}

export interface AvskaladBild {
  titel: string;
  /** Bildens övre vänstra hörn i rutornas koordinater (viewBox-origo). */
  ursprung: { x: number; y: number };
  bredd: number;
  höjd: number;
  zoner: AvskaladZon[];
  rutor: AvskaladRuta[];
  kanter: AvskaladKant[];
}

/* ------------------------------------------------------------------ */
/* Mått                                                                */
/* ------------------------------------------------------------------ */

const MARGINAL = 36;
const TITEL_H = 70;
const RUTA = { w: 196, h: 86 };
const REGEL = { w: 130, h: 86, romb: 38 };
const ÄNDE = { w: 128, h: 40 };
const KOL_LUCKA = 54;
const ZON_TOPP = 38; // plats för zonens namn
const ZON_BOTTEN = 22;
const LINJE_LUCKA = 26;
const ZON_LUCKA = 18;
const ZON_SIDA = 24;

const mått = (sort: AvskaladSort) => (sort === "steg" ? RUTA : sort === "regel" ? REGEL : ÄNDE);

/* ------------------------------------------------------------------ */
/* Härledningen                                                        */
/* ------------------------------------------------------------------ */

const ärSteg = (n: ApNode) => n.kind === "aktivitet" || n.kind === "process" || n.kind === "regel";
/**
 * Ett FORUM i kedjan står i en aktivitets ställe (metoden) och är ett steg
 * i berättelsen. Ett forum som satellit (utan flöde) är det inte.
 */
const ärForumSteg = (n: ApNode, iFlödet: Set<string>) => n.kind === "forum" && iFlödet.has(n.id);

/** Svaret sorteras: omärkt och "Ja" före "Nej" – huvudspåret först. */
const svarsordning = (label?: string) => (!label ? 0 : /^ja$/i.test(label) ? 1 : /^nej$/i.test(label) ? 3 : 2);

/** Rutor som flyttats för hand i det avskalade utseendet: id → övre vänstra hörnet. */
export type AvskaladeLägen = Record<string, { x: number; y: number }>;

export function avskalaAp(
  m: ApModel,
  lägen: AvskaladeLägen = {},
  kopplingar: AvskaladeKopplingar = {},
): AvskaladBild {
  const nodAv = new Map(m.nodes.map((n) => [n.id, n]));
  const flöde = m.relations.filter((r) => r.kind === "flode" && nodAv.has(r.source) && nodAv.has(r.target));
  const in_ = new Map<string, number>();
  const ut = new Map<string, typeof flöde>();
  for (const r of flöde) {
    in_.set(r.target, (in_.get(r.target) ?? 0) + 1);
    ut.set(r.source, [...(ut.get(r.source) ?? []), r]);
  }

  // Vilka objekt som står kvar: stegen, och verksamhetsobjekt som är processens
  // början (inget in) eller slut (inget ut). Allt däremellan faller bort.
  const iFlödet = new Set(flöde.flatMap((r) => [r.source, r.target]));
  const behåll = (n: ApNode) =>
    ärSteg(n) ||
    ärForumSteg(n, iFlödet) ||
    (n.kind === "vo" && (!(in_.get(n.id) ?? 0) || !(ut.get(n.id)?.length ?? 0)));
  const kvar = m.nodes.filter(behåll);
  const kvarIds = new Set(kvar.map((n) => n.id));

  // Kopplingarna, genom de borttagna objekten. Etiketten är den på första
  // steget ut – det är där regelns svar står.
  const kanter: { source: string; target: string; label?: string }[] = [];
  const sett = new Set<string>();
  for (const n of kvar) {
    const kö = [...(ut.get(n.id) ?? [])].map((r) => ({ r, label: r.label }));
    const besökta = new Set<string>();
    while (kö.length) {
      const { r, label } = kö.shift()!;
      if (kvarIds.has(r.target)) {
        const nyckel = `${n.id}>${r.target}>${label ?? ""}`;
        if (!sett.has(nyckel)) {
          sett.add(nyckel);
          kanter.push({ source: n.id, target: r.target, ...(label ? { label } : {}) });
        }
        continue;
      }
      if (besökta.has(r.target)) continue;
      besökta.add(r.target);
      for (const vidare of ut.get(r.target) ?? []) kö.push({ r: vidare, label: label ?? vidare.label });
    }
  }
  kanter.sort((a, b) => svarsordning(a.label) - svarsordning(b.label));
  const utKant = new Map<string, typeof kanter>();
  const inKant = new Map<string, typeof kanter>();
  for (const k of kanter) {
    utKant.set(k.source, [...(utKant.get(k.source) ?? []), k]);
    inKant.set(k.target, [...(inKant.get(k.target) ?? []), k]);
  }

  // Flödesordningen: djupet först från starten, huvudspåret först. Kanter
  // tillbaka till något redan besökt är ÅTERKOPPLINGAR och räknas inte i
  // kolumnerna (annars får en slinga ingen ordning alls).
  const ordning: string[] = [];
  const bakåt = new Set<(typeof kanter)[number]>();
  /** Objekt utanför huvudspåret – de får gå ner en linje i stället för åt höger. */
  const gren = new Set<string>();
  {
    const färg = new Map<string, "grå" | "svart">();
    const besök = (id: string) => {
      färg.set(id, "grå");
      ordning.push(id);
      for (const k of utKant.get(id) ?? []) {
        const f = färg.get(k.target);
        if (f === "grå") bakåt.add(k);
        else if (!f) {
          // En GREN: nåddes via ett annat svar än Ja, eller ligger under en sådan.
          if (gren.has(id) || svarsordning(k.label) >= 2) gren.add(k.target);
          besök(k.target);
        }
        else if (ordning.indexOf(k.target) < ordning.indexOf(id)) bakåt.add(k);
      }
      färg.set(id, "svart");
    };
    const rötter = kvar.filter((n) => !(inKant.get(n.id)?.length ?? 0));
    for (const r of rötter) if (!färg.has(r.id)) besök(r.id);
    for (const n of kvar) if (!färg.has(n.id)) besök(n.id);
  }

  // Zon: rollen som utför steget (H före U). Regler, ändar och steg utan roll
  // följer steget före sig – starten steget efter.
  const utförare = new Map<string, string>();
  for (const bokstav of ["U", "H"]) {
    for (const r of m.relations) {
      if (r.kind !== "huki" || r.huki !== bokstav) continue;
      if (nodAv.get(r.source)?.kind !== "roll") continue;
      utförare.set(r.target, nodAv.get(r.source)!.label);
    }
  }
  const zonNamn = new Map<string, string>();
  for (const id of ordning) {
    const egen = utförare.get(id);
    if (egen) zonNamn.set(id, egen);
  }
  for (let varv = 0; varv < 3; varv++) {
    for (const id of ordning) {
      if (zonNamn.has(id)) continue;
      const före = (inKant.get(id) ?? []).find((k) => !bakåt.has(k) && zonNamn.has(k.source));
      const efter = (utKant.get(id) ?? []).find((k) => zonNamn.has(k.target));
      const z = före ? zonNamn.get(before(före)) : efter ? zonNamn.get(efter.target) : undefined;
      if (z) zonNamn.set(id, z);
    }
  }
  function before(k: { source: string }) {
    return k.source;
  }
  const zoner: string[] = [];
  for (const id of ordning) {
    const z = zonNamn.get(id) ?? "Övrigt";
    zonNamn.set(id, z);
    if (!zoner.includes(z)) zoner.push(z);
  }

  // KOLUMN OCH LINJE. Steg i SAMMA zon står efter varandra; ett steg i en
  // ANNAN zon får stå i samma kolumn som steget före – rakt under eller över,
  // som i frames.png. Annars fick varje steg en egen kolumn och bilden blev
  // 3,7 gånger så bred som hög. Är cellen tagen går steget till nästa lediga
  // linje i zonen (en gren bredvid huvudspåret), och finns ingen på rimligt
  // avstånd flyttas det en kolumn åt höger.
  const kolumn = new Map<string, number>();
  const linje = new Map<string, number>();
  const tagen = new Set<string>();
  const cell = (z: string, k: number, l: number) => `${z}|${k}|${l}`;
  for (const id of ordning) {
    const z = zonNamn.get(id)!;
    const före = (inKant.get(id) ?? []).filter((e) => !bakåt.has(e) && kolumn.has(e.source));
    let k = 0;
    for (const e of före) {
      const samma = zonNamn.get(e.source) === z;
      k = Math.max(k, kolumn.get(e.source)! + (samma ? 1 : 0));
    }
    // En slutpunkt eller start hör ihop med sitt steg – aldrig rakt under det.
    if (!före.length && (utKant.get(id) ?? []).length) k = 0;
    const iZonen = före.find((e) => zonNamn.get(e.source) === z);
    let l = iZonen ? linje.get(iZonen.source)! : 0;
    const start = l;
    // Huvudspåret går åt HÖGER när platsen är tagen; en gren går UPP en linje
    // (och åt höger först om den linjen också är tagen). Uppåt, inte neråt:
    // under huvudspåret går de lodräta linjerna till nästa zon, och en gren
    // där tvingade dem att slingra sig runt den.
    while (tagen.has(cell(z, k, l))) {
      if (gren.has(id) && l === start) l--;
      else {
        k++;
        l = start;
      }
    }
    tagen.add(cell(z, k, l));
    kolumn.set(id, k);
    linje.set(id, l);
  }

  // Numren – steg (inte regler eller ändar) i kolumnordning.
  const nr = new Map<string, number>();
  // Huvudspåret först i flödesordning, därefter grenarna – så att man kan
  // berätta 1, 2, 3 … längs det som normalt händer.
  [...ordning.filter((id) => !gren.has(id)), ...ordning.filter((id) => gren.has(id))]
    .filter((id) => {
      const k = nodAv.get(id)!.kind;
      return k === "aktivitet" || k === "process" || k === "forum";
    })
    .forEach((id, i) => nr.set(id, i + 1));

  // Undertexten: IT-stöden steget samverkar med.
  const undertext = new Map<string, string[]>();
  for (const r of m.relations) {
    if (r.kind !== "samverkar") continue;
    const t = nodAv.get(r.target);
    if (!t || (t.kind !== "applikation" && t.kind !== "arkiv")) continue;
    undertext.set(r.source, [...(undertext.get(r.source) ?? []), t.label]);
  }

  /* ---- Geometrin ---- */

  const sortAv = (n: ApNode): AvskaladSort => (n.kind === "regel" ? "regel" : n.kind === "vo" ? "ände" : "steg");
  const antalKol = Math.max(0, ...kolumn.values()) + 1;
  const kolBredd = Array.from({ length: antalKol }, () => 0);
  for (const id of ordning) {
    const k = kolumn.get(id)!;
    kolBredd[k] = Math.max(kolBredd[k], mått(sortAv(nodAv.get(id)!)).w);
  }
  const kolX: number[] = [];
  {
    let x = MARGINAL + ZON_SIDA;
    for (let k = 0; k < antalKol; k++) {
      kolX.push(x);
      x += kolBredd[k] + KOL_LUCKA;
    }
  }

  // Varje zon rymmer sina linjer, från den översta grenen till den nedersta.
  const zonLinjer = zoner.map((z) => {
    const l = ordning.filter((id) => zonNamn.get(id) === z).map((id) => linje.get(id)!);
    return { min: Math.min(0, ...l), max: Math.max(0, ...l) };
  });
  const radSteg = RUTA.h + LINJE_LUCKA;
  const zonTopp: number[] = [];
  {
    let y = TITEL_H;
    zonLinjer.forEach(({ min, max }) => {
      zonTopp.push(y);
      y += ZON_TOPP + (max - min + 1) * RUTA.h + (max - min) * LINJE_LUCKA + ZON_BOTTEN + ZON_LUCKA;
    });
  }

  const rutor: AvskaladRuta[] = ordning.map((id) => {
    const n = nodAv.get(id)!;
    const sort = sortAv(n);
    const { w, h } = mått(sort);
    const zi = zoner.indexOf(zonNamn.get(id)!);
    const k = kolumn.get(id)!;
    const l = linje.get(id)!;
    const radY = zonTopp[zi] + ZON_TOPP + (l - zonLinjer[zi].min) * radSteg;
    // Ett handplacerat läge vinner över det uträknade.
    const eget = lägen[id];
    return {
      id,
      sort,
      ...(nr.has(id) ? { nr: nr.get(id)! } : {}),
      rubrik: n.label,
      ...(undertext.has(id) ? { undertext: undertext.get(id)!.join(" · ") } : {}),
      ...(n.kind === "forum" ? { forum: true } : {}),
      zon: zi,
      kolumn: k,
      linje: l,
      x: eget ? eget.x : kolX[k] + (kolBredd[k] - w) / 2,
      y: eget ? eget.y : radY + (RUTA.h - h) / 2,
      w,
      h,
    };
  });

  // Zonerna räknas ur RUTORNA, inte ur rutnätet – så följer de med när en
  // ruta flyttas för hand. Alla band är lika breda, som i frames.png.
  const vänster = Math.min(...rutor.map((r) => r.x)) - ZON_SIDA;
  const höger = Math.max(...rutor.map((r) => r.x + r.w)) + ZON_SIDA;
  const zonRutor: AvskaladZon[] = zoner.map((namn, zi) => {
    const egna = rutor.filter((r) => r.zon === zi);
    const topp = Math.min(...egna.map((r) => r.y + (r.h - RUTA.h) / 2)) - ZON_TOPP;
    const botten = Math.max(...egna.map((r) => r.y + (r.h + RUTA.h) / 2)) + ZON_BOTTEN;
    return { namn, x: vänster, y: topp, w: höger - vänster, h: botten - topp };
  });

  /* ---- Vägarna ---- */

  const rutaAv = new Map(rutor.map((r) => [r.id, r]));
  const sidval = kanter.map((k) => {
    const nyckel = ramKantNyckel(k.source, k.target, k.label);
    const val = kopplingar[nyckel];
    const a = portRuta(rutaAv.get(k.source)!);
    const b = portRuta(rutaAv.get(k.target)!);
    const [sa, sb] = pickEdgeSides(a, b, { label: k.label, sourceSide: val?.sourceSide, targetSide: val?.targetSide });
    return { k, nyckel, val, a, b, sa, sb, fromPos: 0.5, toPos: 0.5 };
  });

  /**
   * EN PORT, EN KOPPLING – för det användaren inte själv valt.
   *
   * Routern låter en grens båda svar lämna regelns UNDERKANT ("annars delar
   * grenarna port"), men när båda målen står nedanför delar de den ändå: i
   * mötesprocessen gick Ja och Nej ut ur samma spets, "Nej" hamnade ovanpå
   * frågan och strecket slingrade sig ner till SAMMA punkt på målet som Ja
   * (2026-10-13: "det blev inte bra"). Svaren tas i svarsordning (Ja
   * först); det första behåller sin sida, nästa går ut åt det håll målet
   * ligger – höger om det ligger rakt under eller till höger.
   */
  const upptagen = new Set<string>();
  for (const v of sidval) {
    const nyckel = `${v.k.source}:${v.sa}`;
    if (upptagen.has(nyckel) && !v.val?.sourceSide && rutaAv.get(v.k.source)?.sort === "regel") {
      const dx = v.b.x + v.b.w / 2 - (v.a.x + v.a.w / 2);
      const ledig = (["right", "left", "top"] as const).filter((s) => !upptagen.has(`${v.k.source}:${s}`));
      v.sa = (dx < -1 ? ledig.find((s) => s === "left") : undefined) ?? ledig[0] ?? v.sa;
    }
    upptagen.add(`${v.k.source}:${v.sa}`);
  }
  // Flera kopplingar IN i samma sida av samma ruta sprids längs sidan, i den
  // ordning de kommer ifrån – annars möts de i en punkt och ser ut som en.
  const inPer = new Map<string, typeof sidval>();
  for (const v of sidval) {
    if (v.val?.targetSide) continue;
    const nyckel = `${v.k.target}:${v.sb}`;
    inPer.set(nyckel, [...(inPer.get(nyckel) ?? []), v]);
  }
  for (const grupp of inPer.values()) {
    if (grupp.length < 2) continue;
    const vågrät = grupp[0].sb === "top" || grupp[0].sb === "bottom";
    // Räknat på var kopplingen LÄMNAR sin källa, inte på källans mitt: Nej ur
    // regelns högra spets kommer från höger även när regeln står rakt ovanför.
    const längs = (v: (typeof sidval)[number]) => {
      const p = sidPunkt(v.a, v.sa, v.fromPos);
      return vågrät ? p.x : p.y;
    };
    const mitt = (v: (typeof sidval)[number]) => (vågrät ? v.b.x + v.b.w / 2 : v.b.y + v.b.h / 2);
    const ordnade = [...grupp].sort((x, y) => längs(x) - längs(y));
    // Den som redan står I LINJE med målets mitt behåller mitten – annars får
    // ett rakt streck ett hack strax före målet. De andra går åt sitt håll.
    const iLinje = ordnade.find((v) => Math.abs(längs(v) - mitt(v)) < 2);
    if (iLinje && ordnade.length <= 3) {
      iLinje.toPos = 0.5;
      for (const v of ordnade) if (v !== iLinje) v.toPos = längs(v) < mitt(v) ? 0.25 : 0.75;
      continue;
    }
    const lägen = ordnade.length === 2 ? [0.3, 0.7] : SIDLÄGEN;
    ordnade.forEach((v, i) => (v.toPos = lägen[Math.min(i, lägen.length - 1)]));
  }

  const vägKanter: AvskaladKant[] = sidval.map(({ k, nyckel, val, a, b, sa, sb, fromPos, toPos }) => {
    const obstacles = rutor
      .filter((r) => r.id !== k.source && r.id !== k.target)
      .map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
    const pts = routeEdge({
      from: sidPunkt(a, sa, val?.sourceSide ? (val.sourcePos ?? 0.5) : fromPos),
      fromSide: sa,
      to: sidPunkt(b, sb, val?.targetSide ? (val.targetPos ?? 0.5) : toPos),
      toSide: sb,
      obstacles,
    });
    return { ...k, nyckel, pts };
  });

  // Bilden rymmer zonerna och vägarna – en slinga kan gå utanför banden.
  const allaX = [...zonRutor.flatMap((z) => [z.x, z.x + z.w]), ...vägKanter.flatMap((k) => k.pts.map((p) => p.x))];
  const allaY = [...zonRutor.flatMap((z) => [z.y, z.y + z.h]), ...vägKanter.flatMap((k) => k.pts.map((p) => p.y))];
  const minX = Math.min(...allaX) - MARGINAL;
  const minY = Math.min(TITEL_H, ...allaY) - TITEL_H;
  const bredd = Math.max(...allaX) + MARGINAL - minX;
  const höjd = Math.max(...allaY) + MARGINAL - minY;
  const ursprung = { x: minX, y: minY };
  return { titel: m.title, ursprung, bredd, höjd, zoner: zonRutor, rutor, kanter: vägKanter };
}

/* ------------------------------------------------------------------ */
/* Ritningen                                                           */
/* ------------------------------------------------------------------ */

const FONT = "Segoe UI, Arial, sans-serif";
export const AVSKALAD_FÄRG = {
  bakgrund1: "#0d2f4f",
  bakgrund2: "#08213a",
  zon: "rgba(255,255,255,0.12)",
  zonKant: "rgba(255,255,255,0.22)",
  zonText: "rgba(255,255,255,0.78)",
  ruta: "#f8fafc",
  rutaKant: "#d6dee8",
  rubrik: "#1f2937",
  undertext: "#6b7280",
  nr: "#94a3b8",
  regel: "#f5b43c",
  linje: "rgba(255,255,255,0.86)",
  ljus: "#ffffff",
};

/** Ordbrytning på tecken – rutorna har fast bredd, texten får flera rader. */
function bryt(text: string, max: number, rader: number): string[] {
  const ut: string[] = [];
  let rad = "";
  for (const ord of text.split(/\s+/).filter(Boolean)) {
    if (rad && (rad + " " + ord).length > max) {
      ut.push(rad);
      rad = ord;
    } else rad = rad ? `${rad} ${ord}` : ord;
  }
  if (rad) ut.push(rad);
  if (ut.length > rader) {
    const kvar = ut.slice(0, rader);
    kvar[rader - 1] = `${kvar[rader - 1]}…`;
    return kvar;
  }
  return ut;
}

export interface AvskaladRitval {
  /**
   * Redigeringsläget: ett handtag i varje kopplings båda ändar, märkt med
   * `data-avsk-kant` (nyckeln) och `data-avsk-ande` ("source"/"target").
   */
  handtag?: boolean;
  /** Den valda rutan (redigeringsläget) – ritas med en ljus ram. */
  vald?: string | null;
}

export function renderAvskaladSvg(b: AvskaladBild, val: AvskaladRitval = {}): string {
  const F = AVSKALAD_FÄRG;
  const d: string[] = [];
  d.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.ursprung.x} ${b.ursprung.y} ${b.bredd} ${b.höjd}" width="${b.bredd}" height="${b.höjd}" font-family="${FONT}">`,
    `<defs>`,
    `<linearGradient id="avsk-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${F.bakgrund1}"/><stop offset="1" stop-color="${F.bakgrund2}"/></linearGradient>`,
    `<marker id="avsk-pil" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="${F.linje}"/></marker>`,
    `</defs>`,
    `<rect x="${b.ursprung.x}" y="${b.ursprung.y}" width="${b.bredd}" height="${b.höjd}" fill="url(#avsk-bg)"/>`,
    `<text x="${b.ursprung.x + MARGINAL}" y="${b.ursprung.y + MARGINAL + 10}" font-size="22" font-weight="600" fill="${F.ljus}">${esc(b.titel)}</text>`,
  );

  b.zoner.forEach((z, i) => {
    d.push(
      `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="14" fill="${F.zon}" stroke="${F.zonKant}"/>`,
      `<text x="${z.x + 16}" y="${z.y + 24}" font-size="13" font-weight="600" fill="${F.zonText}">Zon ${i + 1} · ${esc(z.namn)}</text>`,
    );
  });

  // Kopplingarna under rutorna, så att en väg som tangerar en ruta inte ritas över den.
  for (const k of b.kanter) {
    d.push(
      `<path d="${pointsToPath(k.pts, 10)}" fill="none" stroke="${F.linje}" stroke-width="3" stroke-linejoin="round" marker-end="url(#avsk-pil)" ${ramKantAttribut(esc, k.source, k.target, k.label)}/>`,
    );
    if (k.label) {
      const p = labelAnchor(k.pts);
      const w = k.label.length * 7.5 + 14;
      d.push(
        `<rect x="${(p.x - w / 2).toFixed(1)}" y="${(p.y - 10).toFixed(1)}" width="${w.toFixed(1)}" height="20" rx="10" fill="${F.bakgrund2}" stroke="${F.linje}" stroke-width="1"/>`,
        `<text x="${p.x.toFixed(1)}" y="${(p.y + 4.5).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="${F.ljus}">${esc(k.label)}</text>`,
      );
    }
  }

  for (const r of b.rutor) {
    const attr = ramNodAttribut(esc, r.id, r.x, r.y, r.w, r.h);
    if (r.sort === "steg" && r.forum) {
      // Pratbubblan: ellipsen FYLLER rutan, så att pilarna – som routas mot
      // rutans sidor – möter konturen mitt på; svansen hänger UNDER rutan.
      // Basen sitter något längre åt vänster än i metodens symbol (24–42 %
      // i stället för 35–51 %), så att en pil in i underkantens mitt inte går
      // genom svansen.
      const rader = bryt(r.rubrik, 16, 3);
      const radH = 18;
      const y0 = r.y + r.h / 2 - ((rader.length - 1) * radH) / 2 + 5;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const rx = r.w / 2;
      const ry = r.h / 2;
      const under = (x: number) => cy + ry * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2));
      const v = r.x + r.w * 0.24;
      const hö = r.x + r.w * 0.42;
      const f = (n: number) => n.toFixed(1);
      d.push(
        `<g ${attr}>`,
        `<path d="M${f(hö)},${f(under(hö))} A${f(rx)},${f(ry)} 0 1,0 ${f(v)},${f(under(v))} L${f(r.x + r.w * 0.17)},${f(r.y + r.h + 14)} Z" fill="${F.ruta}" stroke="${F.rutaKant}" stroke-width="1.5" stroke-linejoin="round"/>`,
        r.nr !== undefined
          ? `<text x="${f(cx)}" y="${f(r.y + 15)}" text-anchor="middle" font-size="11" font-weight="700" fill="${F.nr}">${r.nr}</text>`
          : "",
        ...rader.map(
          (t, i) =>
            `<text x="${f(cx)}" y="${f(y0 + i * radH)}" text-anchor="middle" font-size="14" font-weight="600" fill="${F.rubrik}">${esc(t)}</text>`,
        ),
        `</g>`,
      );
    } else if (r.sort === "steg") {
      const rader = bryt(r.rubrik, 22, r.undertext ? 2 : 3);
      const radH = 19;
      const textH = rader.length * radH + (r.undertext ? 18 : 0);
      const y0 = r.y + (r.h - textH) / 2 + 14;
      d.push(
        `<g ${attr}>`,
        `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="10" fill="${F.ruta}" stroke="${F.rutaKant}" stroke-width="1.5"/>`,
        r.nr !== undefined
          ? `<text x="${r.x + 10}" y="${r.y + 16}" font-size="11" font-weight="700" fill="${F.nr}">${r.nr}</text>`
          : "",
        ...rader.map(
          (t, i) =>
            `<text x="${r.x + r.w / 2}" y="${(y0 + i * radH).toFixed(1)}" text-anchor="middle" font-size="15" font-weight="600" fill="${F.rubrik}">${esc(t)}</text>`,
        ),
        r.undertext
          ? `<text x="${r.x + r.w / 2}" y="${(y0 + rader.length * radH + 2).toFixed(1)}" text-anchor="middle" font-size="11.5" fill="${F.undertext}">${esc(bryt(r.undertext, 30, 1)[0])}</text>`
          : "",
        `</g>`,
      );
    } else if (r.sort === "regel") {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const s = REGEL.romb / 2;
      const rader = bryt(r.rubrik, 18, 3);
      d.push(
        `<g ${attr}>`,
        `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="transparent"/>`,
        `<path d="M${cx},${cy - s} L${cx + s},${cy} L${cx},${cy + s} L${cx - s},${cy} Z" fill="${F.regel}" stroke="${F.ljus}" stroke-width="1.5"/>`,
        // Frågan står OVANFÖR romben. Under den går grenen ut – där skar
        // Ja-strecket rakt genom texten.
        ...rader.map(
          (t, i) =>
            `<text x="${cx}" y="${(cy - s - 8 - (rader.length - 1 - i) * 15).toFixed(1)}" text-anchor="middle" font-size="12.5" font-weight="600" fill="${F.ljus}">${esc(t)}</text>`,
        ),
        `</g>`,
      );
    } else {
      d.push(
        `<g ${attr}>`,
        `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.h / 2}" fill="none" stroke="${F.linje}" stroke-width="2" stroke-dasharray="5 4"/>`,
        ...bryt(r.rubrik, 18, 2).map(
          (t, i, alla) =>
            `<text x="${r.x + r.w / 2}" y="${(r.y + r.h / 2 + 4.5 - ((alla.length - 1) * 14) / 2 + i * 14).toFixed(1)}" text-anchor="middle" font-size="12.5" font-weight="600" fill="${F.ljus}">${esc(t)}</text>`,
        ),
        `</g>`,
      );
    }
  }

  if (val.vald) {
    const r = b.rutor.find((x) => x.id === val.vald);
    if (r) {
      d.push(
        `<rect x="${r.x - 6}" y="${r.y - 6}" width="${r.w + 12}" height="${r.h + 12}" rx="14" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-dasharray="7 5" pointer-events="none"/>`,
      );
    }
  }

  // Handtagen överst – de ska gå att ta i även där en ände ligger an mot en ruta.
  if (val.handtag) {
    for (const k of b.kanter) {
      const ändar: ["source" | "target", Point][] = [
        ["source", k.pts[0]],
        ["target", k.pts[k.pts.length - 1]],
      ];
      for (const [ände, p] of ändar) {
        d.push(
          `<circle class="avsk-handtag" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6.5" data-avsk-kant="${esc(k.nyckel)}" data-avsk-ande="${ände}"><title>Dra för att flytta var kopplingen ${ände === "source" ? "lämnar" : "går in i"} rutan · dubbelklick återställer</title></circle>`,
        );
      }
    }
  }

  d.push(`</svg>`);
  return d.filter(Boolean).join("\n");
}
