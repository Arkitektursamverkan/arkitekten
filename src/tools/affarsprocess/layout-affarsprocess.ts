/**
 * Layoutmotor för "Affärsprocess" – det vågräta processflödet.
 *
 * Principer:
 *  - INGEN simbaneindelning: hela kedjan ligger i ett band. Grenar ur en
 *    regel får en egen rad under huvudflödet.
 *  - Satelliter placeras ÖVER (krav, tid) respektive UNDER (roll, intressent,
 *    IT-stöd, meddelanden m.fl.) sin aktivitet, centrerade kring den.
 *  - Sidbrytning: kolumner packas vänster→höger tills sidbredden är full,
 *    därefter snitt (R1). En aktivitets satelliter följer ALLTID med sin
 *    aktivitet till samma del – det är regel R8.
 *  - Deterministisk: samma modell + format ⇒ exakt samma utlägg (R7).
 *
 * Relationerna ROUTAS inte här – canvas och SVG-export routar med samma
 * edge-router som flödesschemat ("en regel, en plats"). Motorn levererar
 * bara placerade objekt + sidhänvisningar för relationer som korsar snitt.
 */

import type { ApModel, ApNode, ApNodeKind, ApRelation } from "@/core/affarsprocess";
import { edgeKey, type EdgeSides } from "@/core/draft";
import { pickEdgeSides, routeEdge, type Point, type Rect, type Side } from "../flowchart/layout/edge-router";
import { portPoint } from "../flowchart/render/edge-geometry";
import { BASE_DIMS } from "../flowchart/layout/layout";
import {
  IKONTYPER,
  apKontur,
  apStamMitt,
  ikonEtikettMått,
  ikonPortRuta,
  textEtikettMått,
} from "./former";

/* ------------------------------------------------------------------ */
/* Mått                                                                */
/* ------------------------------------------------------------------ */

/** Grundmått per objekttyp (bredd × höjd i px vid skala 1). */
export const AP_DIMS: Record<ApNodeKind, { w: number; h: number }> = {
  process: { w: 150, h: 60 },
  aktivitet: { w: BASE_DIMS.nodeW, h: BASE_DIMS.nodeH },
  // Verksamhetsobjektet är en liten ruta med namnet UNDER (se IKONTYPER i
  // former) – måttet är bara ett golv, etiketten får växa förbi det.
  vo: { w: 76, h: 54 },
  // Regeln är en IKONTYP: liten romb, frågan under.
  regel: { w: 76, h: 54 },
  // Roll och intressent delar symbol och ska därför dela grundmått –
  // annars stod två aktörer i samma stapel olika långt in.
  roll: { w: 88, h: 58 },
  intressent: { w: 88, h: 58 },
  // Ikontyper: liten symbol med namnet under (måtten är golv, se dim()).
  applikation: { w: 76, h: 54 },
  arkiv: { w: 76, h: 52 },
  krav: { w: 100, h: 56 },
  tid: { w: 62, h: 62 },
  // Samma mått som aktiviteten: forumet står i dess ställe.
  forum: { w: BASE_DIMS.nodeW, h: BASE_DIMS.nodeH },
  plats: { w: 62, h: 66 },
  problem: { w: 52, h: 52 },
  risk: { w: 56, h: 52 },
  mojlighet: { w: 52, h: 52 },
  textobjekt: { w: 130, h: 42 },
};

/** Satelliter som ritas ÖVER sin aktivitet (Adresserar-relationerna). */
const ÖVER: ReadonlySet<ApNodeKind> = new Set(["krav", "tid"]);

/**
 * Objektets rutmått vid skala 1 – EN plats.
 *
 * Ikontyperna (cylinder, aktör, klocka) har texten UNDER symbolen och måste
 * växa med etiketten, annars klipper nodens SVG-ruta texten i canvasen ("Inom
 * 5 dagar" blev "nom 5 daga"). Former med texten INUTI växer också: ett långt
 * namn svämmade annars ur rutan. Grundmåttet är ett GOLV, aldrig ett tak.
 */
function apMått(n: ApNode): { w: number; h: number } {
  const bas = AP_DIMS[n.kind];
  const mått = IKONTYPER.has(n.kind) ? ikonEtikettMått(n.label) : textEtikettMått(n.kind, n.label);
  return { w: Math.max(bas.w, mått.w), h: Math.max(bas.h, mått.h) };
}

interface ApDims {
  colGap: number; // mellanrum mellan kolumner i kedjan
  rowGap: number; // mellanrum mellan kedjans rader (grenrader)
  satGapY: number; // lodrätt avstånd kedja ↔ satellitkluster
  satGapX: number; // vågrätt mellanrum mellan klustrets två staplar
  satRadGap: number; // lodrätt mellanrum mellan satelliter i samma stapel
  margin: number; // marginal runt hela utlägget / varje del
  pageGap: number; // mellanrum mellan delar
}

function apDims(scale: number, spacing: number): ApDims {
  const s = Math.min(1, Math.max(0.5, spacing));
  return {
    colGap: BASE_DIMS.colGap * scale * s,
    rowGap: 34 * scale * s,
    // Satelliterna sitter TÄTT under sin aktivitet – långa streckade linjer
    // ner till ett avlägset band gjorde bilden rörigare än den behövde vara.
    satGapY: 22 * scale * s,
    satGapX: 14 * scale * s,
    satRadGap: 16 * scale * s,
    margin: 24 * scale,
    pageGap: BASE_DIMS.pageGap * scale,
  };
}

/* ------------------------------------------------------------------ */
/* Resultattyper                                                       */
/* ------------------------------------------------------------------ */

export interface ApLaidOutNode {
  node: ApNode;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Vilken del (0-baserad) objektet ritas på. */
  page: number;
  /**
   * Förskjutning mellan det här utläggets ram och den FRIA layoutens
   * (invariant 5): manuella positioner sparas i fria koordinater och
   * översätts med dx/dy vid läsning och skrivning. dy är alltid 0 – delarna
   * ligger sida vid sida, aldrig staplade.
   */
  dx: number;
  dy: number;
}

/** Sidhänvisning där en relation korsar ett snitt. */
export interface ApPageRef {
  relationId: string;
  /** "ut" = märket vid källan ("till del N"), "in" = vid målet ("från del N"). */
  riktning: "ut" | "in";
  page: number;
  x: number;
  y: number;
  text: string;
}

export interface ApPage {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ApLayout {
  nodes: ApLaidOutNode[];
  /** Relationerna oförändrade – routas av canvas/SVG med edge-routern. */
  relations: ApRelation[];
  /**
   * Portpunkter som LAYOUTEN äger, per relations-id: exakt var pilen ska börja
   * och sluta. Används för satelliternas streck, som ska gå rakt ner från sin
   * symbol i stället för att alla trängas i aktivitetens mittport. Canvas och
   * export läser samma tabell.
   */
  ports: Record<string, { from?: Point; to?: Point; via?: Point }>;
  /**
   * Anslutningssidor som LAYOUTEN äger, per relations-id – skickas in i
   * `pickEdgeSides` som förval av både canvasen och SVG-exporten (en regel,
   * en plats). Användarens egna sidval i mellanlagret vinner alltid över det
   * här. Se `anslutningsSidor` för regeln.
   */
  sides: Record<string, EdgeSides>;
  pages: ApPage[];
  refs: ApPageRef[];
  width: number;
  height: number;
  scale: number;
}

export interface ApLayoutOptions {
  pageWidth?: number | null;
  scale?: number;
  spacing?: number;
  /**
   * Användarens egna kantval ur mellanlagret (sidor, brytpunkter), nycklade
   * med `edgeKey`. Layouten väger in dem så att BÅDE canvas och export ser
   * samma sanning – exporten har ingen draft att fråga, och utan detta ritade
   * filen ett annat håll än skärmen så fort man valt en kopplingspunkt.
   */
  edgeStyles?: Record<string, EdgeSides>;
}

/**
 * Kopplingspunkten på ett placerat objekt: sidan och VAR längs sidan (0–1).
 *
 * Delad av canvasen och SVG-exporten (en regel, en plats). För ikontyperna
 * räknas den på SYMBOLENS ruta – det är där pilarna fäster, inte i etikettens
 * ytterkant.
 */
export function apPortPunkt(n: ApLaidOutNode, side: Side, pos = 0.5): Point {
  const i = ikonPortRuta(n.node.kind, n.w, n.h);
  const ruta = i
    ? { id: n.node.id, x: n.x + i.x, y: n.y + i.y, w: i.w, h: i.h }
    : { id: n.node.id, x: n.x, y: n.y, w: n.w, h: n.h };
  return portPoint(ruta, side, pos);
}

/**
 * Relationens VÄG genom utlägget – punkterna som ritas. En plats för alla
 * exporter (SVG, .bmt): samma förval av sidor (`lo.sides`), samma portpunkter
 * som layouten äger (`lo.ports`, satelliternas streck) och användarens dragna
 * brytpunkter, som ligger i FRIA koordinater och översätts med källans dx/dy
 * (invariant 5). Utan den ritade filen den automatiska vägen medan skärmen
 * visade den dragna. `hinder` är rutorna vägen ska gå runt.
 */
export function apRelationsVäg(
  lo: ApLayout,
  rel: ApRelation,
  a: ApLaidOutNode,
  b: ApLaidOutNode,
  hinder: Rect[],
): Point[] {
  const val = lo.sides[rel.id];
  const [sa, sb] = pickEdgeSides(a, b, val);
  const utpekad = lo.ports[rel.id];
  const wp = val?.waypoint;
  return routeEdge({
    from: utpekad?.from ?? apPortPunkt(a, sa, val?.sourcePos),
    fromSide: sa,
    to: utpekad?.to ?? apPortPunkt(b, sb, val?.targetPos),
    toSide: sb,
    obstacles: hinder,
    via: wp ? { x: wp.x + a.dx, y: wp.y + a.dy } : utpekad?.via,
    via2: wp && val?.waypoint2 ? { x: val.waypoint2.x + a.dx, y: val.waypoint2.y + a.dy } : null,
  });
}

/* ------------------------------------------------------------------ */
/* Motorn                                                              */
/* ------------------------------------------------------------------ */

export function layoutAp(model: ApModel, opts?: ApLayoutOptions): ApLayout {
  const scale = opts?.scale ?? 1;
  const d = apDims(scale, opts?.spacing ?? 1);
  const dim = (n: ApNode) => {
    const m = apMått(n);
    return { w: m.w * scale, h: m.h * scale };
  };

  // ---- Kedja vs satelliter. Allt med ankare är en satellit; resten som
  // deltar i flödet är kedjan. Satelliter vars ankare försvunnit (borttaget
  // steg) hängs sist i kedjan hellre än att tappas tyst.
  const nodAv = new Map(model.nodes.map((n) => [n.id, n]));

  /**
   * Ankare per objekt: det uttryckliga (satelliter ur ett stegs ap-block) plus
   * HÄRLEDDA för objekt som bara har satellitrelationer.
   *
   * En intressent som hänger på ett FRITT objekt (t.ex. en intressent kopplad
   * till ett forum i kedjan) har inget anchorId – den kommer
   * inte ur något stegs ap-block. Utan härledningen räknades den som kedjenod,
   * fick rank 0 och hamnade först i kedjeraden, före processens ingång.
   */
  const iFlöde = new Set(
    model.relations.filter((r) => r.kind === "flode").flatMap((r) => [r.source, r.target]),
  );
  const ankarFör = new Map<string, string>();
  for (const n of model.nodes) {
    if (n.anchorId && nodAv.has(n.anchorId)) {
      ankarFör.set(n.id, n.anchorId);
      continue;
    }
    if (iFlöde.has(n.id)) continue; // deltar i kedjan – hör hemma där
    const till = model.relations.find(
      (r) => (r.source === n.id || r.target === n.id) && iFlöde.has(r.source === n.id ? r.target : r.source),
    );
    if (till) ankarFör.set(n.id, till.source === n.id ? till.target : till.source);
  }

  const satelliter = model.nodes.filter((n) => ankarFör.has(n.id));
  const alla = model.nodes.filter((n) => !satelliter.includes(n));

  // Objekt HELT utan kopplingar hör inte till kedjan och ska inte tänja ut
  // dess rader. De hamnade annars i kolumn 0, knuffades ner en rad var av
  // krockregeln, och sköt hela satellitbandet flera rader nedåt – tre
  // fristående noteringar räckte för att lyfta bort rollerna från sina
  // aktiviteter. De läggs i ett eget band längst ner i stället. Ett objekt med
  // egen position (utplacerat från paletten) ligger där användaren satte det
  // och rörs inte.
  const kopplade = new Set(model.relations.flatMap((r) => [r.source, r.target]));
  const lösa = alla.filter((n) => !kopplade.has(n.id) && !n.position);
  const kedja = alla.filter((n) => !lösa.includes(n));

  // ---- Rank = längsta väg längs Flöde-relationerna (deterministiskt).
  const kedjeIds = new Set(kedja.map((n) => n.id));
  const flode = model.relations.filter(
    (r) => r.kind === "flode" && kedjeIds.has(r.source) && kedjeIds.has(r.target),
  );
  const rank = new Map<string, number>();
  for (const n of kedja) rank.set(n.id, 0);
  // Bellman-Ford-liknande avslappning; |V| varv räcker och skyddar mot cykler.
  for (let varv = 0; varv < kedja.length; varv++) {
    let ändrad = false;
    for (const r of flode) {
      const nytt = (rank.get(r.source) ?? 0) + 1;
      if (nytt > (rank.get(r.target) ?? 0) && nytt <= kedja.length) {
        rank.set(r.target, nytt);
        ändrad = true;
      }
    }
    if (!ändrad) break;
  }
  // Objekt utan inkommande flöde (t.ex. ett explicit input-VO mitt i kedjan)
  // ska stå i kolumnen FÖRE sitt mål – inte längst till vänster, där det
  // krockar med kedjans start och ger en lång omväg tvärs över diagrammet.
  const harInkommande = new Set(flode.map((r) => r.target));
  for (const n of kedja) {
    if (harInkommande.has(n.id)) continue;
    const mål = flode.filter((r) => r.source === n.id).map((r) => rank.get(r.target) ?? 0);
    if (mål.length) rank.set(n.id, Math.max(0, Math.min(...mål) - 1));
  }

  // ---- Rad: huvudflödet på rad 0, ytterligare regelgrenar en rad ner.
  // Deterministiskt: relationerna gås i modellordning; första utgången ur en
  // nod ärver dess rad, efterföljande får nästa lediga rad. En sammanslagning
  // (flera inkommande) tar den ÖVERSTA raden bland sina föregångare.
  const row = new Map<string, number>();
  const utgångar = new Map<string, ApRelation[]>();
  for (const r of flode) {
    const list = utgångar.get(r.source) ?? [];
    list.push(r);
    utgångar.set(r.source, list);
  }
  const iRankordning = [...kedja].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  for (const n of iRankordning) {
    if (!row.has(n.id)) row.set(n.id, 0);
    const bas = row.get(n.id)!;
    const ut = utgångar.get(n.id) ?? [];
    ut.forEach((r, i) => {
      // Första utgången ärver radens; varje ytterligare gren en rad ner.
      // Grenar ur olika regler får dela rad – de ligger i olika kolumner.
      const önskad = bas + i;
      const nuvarande = row.get(r.target);
      // Översta raden vinner vid sammanslagning.
      if (nuvarande === undefined || önskad < nuvarande) row.set(r.target, önskad);
    });
  }
  // Två objekt i samma kolumn får aldrig dela rad (ett input-VO bredvid ett
  // auto-VO, eller två grenar som råkat mötas). Krockar knuffas nedåt i
  // deterministisk ordning: rank, sedan modellordning.
  {
    const upptaget = new Set<string>();
    const iOrdning = [...kedja].sort(
      (a, b) =>
        rank.get(a.id)! - rank.get(b.id)! ||
        kedja.indexOf(a) - kedja.indexOf(b),
    );
    for (const n of iOrdning) {
      let rad = row.get(n.id) ?? 0;
      while (upptaget.has(`${rank.get(n.id)}:${rad}`)) rad++;
      row.set(n.id, rad);
      upptaget.add(`${rank.get(n.id)}:${rad}`);
    }
  }
  const maxRad = Math.max(0, ...row.values());

  // ---- Satelliter per ankare, uppdelade i över/under.
  const över = new Map<string, ApNode[]>();
  const under = new Map<string, ApNode[]>();
  for (const s of satelliter) {
    const hylla = ÖVER.has(s.kind) ? över : under;
    const ankare = ankarFör.get(s.id)!;
    const list = hylla.get(ankare) ?? [];
    list.push(s);
    hylla.set(ankare, list);
  }
  const radBredd = (list: ApNode[] | undefined) =>
    list?.length
      ? list.reduce((sum, s) => sum + dim(s).w, 0) + d.satGapX * (list.length - 1)
      : 0;
  const radHöjd = (list: ApNode[] | undefined) =>
    list?.length ? Math.max(...list.map((s) => dim(s).h)) : 0;

  /**
   * Satelliterna UNDER en aktivitet bildar ett KLUSTER med två staplar:
   * aktörerna till vänster, IT-stödet till höger, båda liggande rakt under
   * sitt eget ankare.
   *
   * Skälet är inte bara smak. En vågrät rad under ankaret gjorde kolumnen lika bred som ALLA
   * satelliter tillsammans – fem stycken sköt isär kedjan till tre gånger
   * bredden, och pilen mellan två aktiviteter blev en halv skärm lång.
   * Staplarna gör kolumnen ungefär två symboler bred oavsett hur många
   * roller aktiviteten har.
   *
   * Uppdelningen följer relationsfärgen: aktörer hänger i den blå
   * HUKI-linjen, IT-stödet i den svarta samverkanslinjen. Med sorterna
   * blandade i samma stapel korsade linjerna varandra under aktiviteten.
   */
  // Forum och plats hänger i den SVARTA samverkanslinjen, precis som IT-stödet
  // – de hör alltså till den stapeln. På aktörssidan delade forumets svarta
  // streck stam med rollernas blå och slingrade sig runt dem för att nå den.
  const AKTÖRSSIDA: ReadonlySet<ApNodeKind> = new Set(["roll", "intressent"]);

  /**
   * Vilken ANSVARSTYP varje aktörssatellit hänger i (HUKI-bokstaven).
   *
   * Behövs för stammen: varje ansvarstyp har sin egen färg, och två aktörer
   * med olika bokstav på SAMMA stam ritar den ena ovanpå den andra. Den som
   * hamnade under såg ut som ett kort streck som inte ledde någonstans
   * (beslut 2026-09-07: "där finns ett litet streck mellan Kund-medarbetare och Teams").
   */
  const ansvarFör = new Map<string, string>();
  for (const rel of model.relations) {
    if (rel.kind !== "huki") continue;
    const bokstav = rel.huki ?? "U";
    // Satelliten är den ände som INTE är ett kedjesteg.
    for (const id of [rel.source, rel.target]) {
      if (ankarFör.has(id)) ansvarFör.set(id, bokstav);
    }
  }
  const ansvarAv = (s: ApNode) => ansvarFör.get(s.id) ?? "U";

  const delaKluster = (list: ApNode[] | undefined) => {
    const vänster: ApNode[] = [];
    const höger: ApNode[] = [];
    for (const s of list ?? []) (AKTÖRSSIDA.has(s.kind) ? vänster : höger).push(s);
    // Aktörerna står GRUPPERADE efter ansvarstyp (i den ordning typerna dyker
    // upp): varje typ har en egen stam, och en blandad stapel fick strecken
    // att korsa varandras uppgångar.
    const typer = [...new Set(vänster.map(ansvarAv))];
    vänster.sort((a, b) => typer.indexOf(ansvarAv(a)) - typer.indexOf(ansvarAv(b)));
    return { vänster, höger, antalTyper: Math.max(1, typer.length) };
  };
  const stapelHöjd = (list: ApNode[]) =>
    list.length
      ? list.reduce((sum, s) => sum + dim(s).h, 0) + d.satRadGap * (list.length - 1)
      : 0;

  /**
   * Klustrets stammar, räknade ur AKTIVITETEN (x och bredd) – aldrig ur
   * satelliterna. Se kommentaren där stammarna används nedan.
   */
  const stammarFör = (kind: ApNodeKind, ax: number, aw: number, antalTyper: number) => {
    const mitt = ax + apStamMitt(kind, aw);
    const minX = ax + 4;
    const maxX = ax + aw - 4;
    const kläm = (x: number) => Math.min(Math.max(x, minX), maxX);
    const halvSpringa = Math.min(
      Math.max(d.satGapX / 2, aw * 0.065),
      Math.max(0, aw / 2 - 4),
    );
    // Flera ansvarstyper får var sin stam, och de extra läggs UTÅT VÄNSTER
    // från aktörsstammen – inte kring den. Kring den kröp den högra fram mot
    // IT-stödets svarta, och med fyra typer på ett halvt satellitgap trängdes
    // spetsarna ihop till en klump under aktiviteten.
    const steg = d.satGapX * 0.7;
    const vänster = kläm(mitt - halvSpringa);
    const typStammar = Array.from({ length: antalTyper }, (_, i) =>
      kläm(vänster - (antalTyper - 1 - i) * steg),
    );
    return { mitt, vänster, höger: kläm(mitt + halvSpringa), typStammar, halvSpringa };
  };

  /**
   * Hur långt symbolen står från sin stam: ikonens kant ligger `gap` ifrån.
   *
   * Aktören står till VÄNSTER om
   * stammen och strecket går vågrätt ut ur ikonens högra sida, böjer och går
   * upp; IT-stödet står till HÖGER och pilen kommer in i cylinderns vänstra
   * sida. Stapeln stod förut CENTRERAD under aktiviteten, alltså mitt på
   * stammen – den översta aktörens streck gick rakt upp genom ikonen och
   * nästa aktörs fick slingra sig runt den första för att komma förbi
   * (beslut 2026-10-13: "jag gillar inte alls hur de skapas").
   *
   * Namnet står centrerat UNDER ikonen och är ofta bredare än den. Stammen
   * från en lägre aktör går upp förbi de övres namn, så avståndet räcker
   * alltid för att namnet ska sluta före stammen.
   */
  const stamGap = (list: ApNode[]) => {
    let gap = d.satGapX;
    for (const s of list) {
      const { w, h } = dim(s);
      const ikonW = ikonPortRuta(s.kind, w, h)?.w ?? w;
      gap = Math.max(gap, (w - ikonW) / 2 + d.satGapX / 2);
    }
    return gap;
  };
  /** Symbolrutans x så att ikonens kant ligger `gap` från stammen. */
  const xVidStam = (s: ApNode, stam: number, gap: number, sida: "vänster" | "höger") => {
    const { w, h } = dim(s);
    const ikonW = ikonPortRuta(s.kind, w, h)?.w ?? w;
    const ikonMitt = sida === "vänster" ? stam - gap - ikonW / 2 : stam + gap + ikonW / 2;
    return ikonMitt - w / 2;
  };
  /** Klustrets utbredning åt vänster och höger om aktivitetens mitt. */
  const klusterUtbredning = (kind: ApNodeKind, aw: number, list: ApNode[] | undefined) => {
    const { vänster, höger, antalTyper } = delaKluster(list);
    const st = stammarFör(kind, 0, aw, antalTyper);
    // Mätt från KEDJENODENS mitt – det är den kolumnen centrerar. Stammarnas
    // fäste kan ligga vid sidan av den (pratbubblans svans).
    const nodMitt = aw / 2;
    const ytterst = Math.min(...st.typStammar);
    let v = 0;
    let h = 0;
    const gv = stamGap(vänster);
    for (const s of vänster) v = Math.max(v, nodMitt - xVidStam(s, ytterst, gv, "vänster"));
    const gh = stamGap(höger);
    for (const s of höger) h = Math.max(h, xVidStam(s, st.höger, gh, "höger") + dim(s).w - nodMitt);
    return { v, h };
  };
  const klusterHöjd = (list: ApNode[] | undefined) => {
    const { vänster, höger } = delaKluster(list);
    return Math.max(stapelHöjd(vänster), stapelHöjd(höger));
  };

  // ---- Kolumnbredd: kedjenodens bredd ELLER satellitradernas, störst vinner.
  // Så får en aktivitet med tre roller under sig plats utan att satelliterna
  // kolliderar med grannkolumnens.
  const perRank = new Map<number, ApNode[]>();
  for (const n of kedja) {
    const r = rank.get(n.id)!;
    const list = perRank.get(r) ?? [];
    list.push(n);
    perRank.set(r, list);
  }
  const ranks = [...perRank.keys()].sort((a, b) => a - b);
  // Klustret är OSYMMETRISKT (aktörerna till vänster om aktivitetens mitt,
  // IT-stödet till höger), så kolumnen mäts åt vardera hållet för sig och
  // kedjenoden står där mitten hamnar – inte mitt i kolumnen. En aktivitet med
  // bara aktörer drog annars med sig lika mycket tom yta på högersidan.
  const kolBredd = new Map<number, number>();
  const kolMitt = new Map<number, number>(); // rank → mittens avstånd från kolumnens vänsterkant
  for (const r of ranks) {
    let v = 0;
    let h = 0;
    for (const n of perRank.get(r)!) {
      const w = dim(n).w;
      const kluster = klusterUtbredning(n.kind, w, under.get(n.id));
      const halv = Math.max(w, radBredd(över.get(n.id))) / 2;
      v = Math.max(v, halv, kluster.v);
      h = Math.max(h, halv, kluster.h);
    }
    kolBredd.set(r, v + h);
    kolMitt.set(r, v);
  }

  // ---- Sidbrytning (R1): packa kolumner tills sidbredden är full. Ett snitt
  // läggs aldrig mellan en regel och dess första utgång? – v1 tillåter snitt
  // mellan alla kolumner; satelliter följer alltid sitt ankares kolumn (R8).
  const pageWidth = opts?.pageWidth ?? null;
  const sidFör = new Map<number, number>(); // rank → sida
  const kolX = new Map<number, number>(); // rank → x inom sin sida
  // Kolumnens läge i den FRIA layouten (utan sidbrytningar) – referensramen
  // som manuella positioner sparas i. dx per kolumn = skillnaden mellan var
  // kolumnen ritas nu och var den ligger i fria ramen.
  const kolXFri = new Map<number, number>();
  let sida = 0;
  let x = d.margin;
  let xFri = d.margin;
  for (const r of ranks) {
    const w = kolBredd.get(r)!;
    if (pageWidth && x > d.margin && x + w + d.margin > pageWidth) {
      sida++;
      x = d.margin;
    }
    sidFör.set(r, sida);
    kolX.set(r, x);
    kolXFri.set(r, xFri);
    x += w + d.colGap;
    xFri += w + d.colGap;
  }
  const antalSidor = sida + 1;

  // ---- Vertikal geometri. Översta bandet = största kravraden; därunder
  // kedjans rader, och VARJE RAD BÄR SITT EGET satellitband direkt under sig.
  //
  // Förut låg alla satelliter i ett gemensamt band under HELA kedjan. Med två
  // kedjerader hamnade rad 0:s roller nedanför rad 1, och den blå linjen upp
  // till sin aktivitet blev flera hundra pixlar lång. Nu sitter rollen tätt
  // under sin egen aktivitet, och grenen därunder börjar först efter satelliterna.
  const övreBand = Math.max(0, ...kedja.map((n) => radHöjd(över.get(n.id))));
  const kedjeRadH = Math.max(...kedja.map((n) => dim(n).h), 0);
  const undreH: number[] = [];
  for (let r = 0; r <= maxRad; r++) {
    let hh = 0;
    for (const n of kedja) {
      if ((row.get(n.id) ?? 0) === r) hh = Math.max(hh, klusterHöjd(under.get(n.id)));
    }
    undreH.push(hh);
  }
  const kedjaTopp = d.margin + övreBand + (övreBand ? d.satGapY : 0);

  /**
   * Objektets y i en rad som börjar på `topp`. Aktiviteter och regler
   * centreras i raden; en IKONTYP centreras på sin SYMBOL, inte på hela rutan.
   *
   * Varför: verksamhetsobjektets ruta är symbol + namn under, alltså tyngre
   * nedåt. Centrerades rutan hamnade symbolen ovanför kedjans linje, och varje
   * pil till nästa aktivitet fick en Z-böj för att komma ner i höjd igen –
   * "varje koppling är krokig". Med symbolerna på samma linje som
   * aktiviteternas mitt går kedjan spikrakt.
   */
  const nodYITopp = (n: ApNode, h: number, topp: number) => {
    const mitt = topp + kedjeRadH / 2;
    const ikon = ikonPortRuta(n.kind, dim(n).w, h);
    return ikon ? mitt - (ikon.y + ikon.h / 2) : mitt - h / 2;
  };

  // Radernas lägen räknas UPPIFRÅN OCH NER, en i taget: nästa rad kan inte
  // placeras förrän den här radens verkliga underkant och satellitband är
  // kända. Manuellt flyttade objekt räknas inte in – ett objekt draget långt
  // ner ska inte knuffa nästa gren med sig.
  const radTopp: number[] = [];
  const radBotten: number[] = [];
  {
    let y = kedjaTopp;
    for (let r = 0; r <= maxRad; r++) {
      radTopp.push(y);
      let botten = y + kedjeRadH;
      for (const n of kedja) {
        if ((row.get(n.id) ?? 0) !== r || n.position) continue;
        const { h } = dim(n);
        botten = Math.max(botten, nodYITopp(n, h, y) + h);
      }
      radBotten.push(botten);
      y = botten + (undreH[r] ? d.satGapY + undreH[r] : 0) + d.rowGap;
    }
  }
  const radY = (rad: number) => radTopp[Math.min(Math.max(rad, 0), maxRad)];
  const nodY = (n: ApNode, h: number, rad: number) => nodYITopp(n, h, radY(rad));

  // ---- Placera. Varje del ritas i ett eget horisontellt band med pageGap
  // emellan (samma konvention som flödesschemats flersidiga läge).
  const sidBredd = new Map<number, number>();
  for (const r of ranks) {
    const s = sidFör.get(r)!;
    sidBredd.set(s, Math.max(sidBredd.get(s) ?? 0, kolX.get(r)! + kolBredd.get(r)! + d.margin));
  }
  const sidOffset = new Map<number, number>();
  {
    let off = 0;
    for (let s = 0; s < antalSidor; s++) {
      sidOffset.set(s, off);
      off += (pageWidth ?? sidBredd.get(s) ?? 0) + d.pageGap;
    }
  }

  const ut: ApLaidOutNode[] = [];
  const platsFör = new Map<string, ApLaidOutNode>();
  for (const n of kedja) {
    const r = rank.get(n.id)!;
    const s = sidFör.get(r)!;
    const { w, h } = dim(n);
    const mitt = kolX.get(r)! + kolMitt.get(r)!;
    // Manuell position vinner. Den är sparad i FRIA ramen och översätts hit
    // med kolumnens dx; delen (page) ändras ALDRIG av ett musdrag (R4).
    const dx = sidOffset.get(s)! + kolX.get(r)! - kolXFri.get(r)!;
    const placerad: ApLaidOutNode = {
      node: n,
      x: n.position ? n.position.x + dx : sidOffset.get(s)! + mitt - w / 2,
      y: n.position ? n.position.y : nodY(n, h, row.get(n.id) ?? 0),
      w,
      h,
      page: s,
      dx,
      dy: 0,
    };
    ut.push(placerad);
    platsFör.set(n.id, placerad);
  }

  // Underkanten på sista raden och dess satellitband – därunder börjar bandet
  // med okopplade objekt.
  const kedjaBotten = radBotten[maxRad];
  const satBotten = kedjaBotten + (undreH[maxRad] ? d.satGapY + undreH[maxRad] : 0);
  // Bandet med okopplade objekt, en rad under allt annat.
  const lösaRadH = lösa.length ? Math.max(...lösa.map((n) => dim(n).h)) : 0;
  const lösaTopp = satBotten + (lösa.length ? d.satGapY : 0);
  // Höjden räknas efter att rutnätet placerats (antalet rader är känt först då).
  let totalHöjd = lösaTopp + lösaRadH + d.margin;

  // Satelliter kring sitt ankare: kraven i en vågrät rad i det övre bandet,
  // aktörer och IT-stöd i ett kluster med två staplar direkt under ankarets
  // EGEN rad. Ankarets FAKTISKA läge styr – dras aktiviteten följer
  // satelliterna med. En satellit med egen manuell position (fria ramen)
  // översätts med sitt ankares dx.
  const placera = (s: ApNode, ankare: ApLaidOutNode, autoX: number, autoY: number) => {
    const { w, h } = dim(s);
    const placerad: ApLaidOutNode = {
      node: s,
      x: s.position ? s.position.x + ankare.dx : autoX,
      y: s.position ? s.position.y : autoY,
      w,
      h,
      page: ankare.page, // R8: satelliten följer sitt ankare
      dx: ankare.dx,
      dy: 0,
    };
    ut.push(placerad);
    platsFör.set(s.id, placerad);
  };

  for (const [anchorId, list] of över.entries()) {
    const ankare = platsFör.get(anchorId);
    if (!ankare) continue;
    let sx = ankare.x + ankare.w / 2 - radBredd(list) / 2;
    for (const s of list) {
      const { w, h } = dim(s);
      placera(s, ankare, sx, d.margin + övreBand - h);
      sx += w + d.satGapX;
    }
  }

  /**
   * Klustrets stam: den lodräta linje alla satellitstreck under en aktivitet
   * delar, och vilken sida av stammen satelliten står på.
   *
   * Med staplade satelliter kan strecken inte längre gå rakt upp var för sig –
   * de skulle ligga ovanpå varandra och dras tvärs igenom namnen på symbolerna
   * ovanför. Lösningen är en stam mellan staplarna: aktörerna kopplar in
   * från vänster, IT-stödet får sin pil ut åt höger, och bara stammen går upp
   * till aktiviteten.
   */
  const klusterStam = new Map<string, { vänster: number; höger: number }>();
  /** Aktörssidans stam per (sida, ansvarstyp), när ett kluster har flera. */
  const klusterAnsvarStam = new Map<string, Map<string, number>>();
  /** Satellitens nyckel i kartan ovan – räknad där stammarna läggs ut. */
  const klusterNyckel = new Map<string, Map<string, string>>();
  const klusterSida = new Map<string, "vänster" | "höger">();

  for (const [anchorId, list] of under.entries()) {
    const ankare = platsFör.get(anchorId);
    if (!ankare) continue;
    const { vänster, höger, antalTyper } = delaKluster(list);
    const st = stammarFör(ankare.node.kind, ankare.x, ankare.w, antalTyper);
    const toppY = radBotten[row.get(anchorId) ?? 0] + d.satGapY;
    // Varje stapel växer nedåt. Aktörerna linjerar mot den YTTERSTA
    // ansvarsstammen och IT-stödet mot sin, så att ikonerna i en stapel står
    // under varandra och varje streck är ett enda vågrätt + ett lodrätt.
    for (const [stapel, stam, sida] of [
      [vänster, Math.min(...st.typStammar), "vänster"],
      [höger, st.höger, "höger"],
    ] as const) {
      const gap = stamGap(stapel);
      let sy = toppY;
      for (const s of stapel) {
        placera(s, ankare, xVidStam(s, stam, gap, sida), sy);
        sy += dim(s).h + d.satRadGap;
      }
    }
  }

  // Stammen hänger i AKTIVITETEN, inte i satelliternas ytterkanter.
  //
  // Varje ansvarslinje möter aktivitetens underkant knappt en tiondels
  // aktivitetsbredd från MITTEN, oavsett var rollen råkar stå. Räknade vi i
  // stället stammen ur satelliterna (”strax till höger om den bredaste
  // rollen”) hamnade den vid aktivitetens ena kant så fort klustret bara hade
  // aktörer, och samma bild fick stammen på höger kant i en aktivitet och på
  // vänster i nästa (beslut 2026-09-08). Med mitten som fäste ser varje aktivitet i varje
  // process likadan ut, och satelliten går till stammen från den sida den
  // står på.
  //
  // Aktörernas blå stam och IT-stödets svarta är två SKILDA linjer, en halv
  // springa åt vardera hållet: låg de på samma x ritades den ena ovanpå den
  // andra. Springan följer AKTIVITETENS BREDD (drygt en tiondel) –
  // ett fast gap på 3 px höll isär dem i teorin men inte i bilden (beslut
  // 2026-09-07). Den kläms bara i en SMAL ruta (`stammarFör`).
  for (const [anchorId, list] of under.entries()) {
    const ankare = platsFör.get(anchorId);
    if (!ankare) continue;
    const placerade = list.map((s) => platsFör.get(s.id)).filter(Boolean) as ApLaidOutNode[];
    if (!placerade.length) continue;
    // SORTEN avgör vilken stam satelliten hänger i, inte var den råkar ligga.
    // Aktörer hänger i den blå HUKI-linjen och IT-stödet i den svarta – samma
    // uppdelning som staplarna görs efter (AKTÖRSSIDA). Geometrin dög så länge
    // automatiken placerade objekten, men i ett handplacerat utlägg ligger både
    // roll och system ofta till höger om aktivitetens mitt: då hamnade båda i
    // samma stam, blått ritades ovanpå svart, och det som syntes var en krok
    // där den blå kom in underifrån (beslut 2026-09-07).
    const vänsterSida = placerade.filter((p) => AKTÖRSSIDA.has(p.node.kind));
    const högerSida = placerade.filter((p) => !AKTÖRSSIDA.has(p.node.kind));
    for (const p of vänsterSida) klusterSida.set(p.node.id, "vänster");
    for (const p of högerSida) klusterSida.set(p.node.id, "höger");
    const nyckel = (p: ApLaidOutNode) => ansvarAv(p.node);
    const grupper = new Map<string, ApLaidOutNode[]>();
    for (const p of vänsterSida) {
      const k = nyckel(p);
      grupper.set(k, [...(grupper.get(k) ?? []), p]);
    }
    const st = stammarFör(ankare.node.kind, ankare.x, ankare.w, Math.max(1, grupper.size));
    klusterStam.set(anchorId, { vänster: st.vänster, höger: st.höger });
    /**
     * AKTÖRSSIDAN får en stam per ANSVARSTYP. Med U blå och I gul på samma
     * linje syns bara den som ritas sist. Stammarna ligger tätt kring
     * aktörsstammen, så klustret fortfarande läses som en knippe streck.
     *
     * Ordningen: VÄNSTERUT FÖRST, sedan uppifrån ner. Varje satellit går
     * vågrätt till sin egen stam; ligger en grupps aktörer till vänster om
     * klustret men får den högra stammen måste deras streck korsa grannens
     * uppgång (4.4.4: Systemägare och Informationssäkerhetsstrateg korsade
     * varandra två gånger). Inom samma läge får den översta gruppen stammen
     * längst från aktivitetens mitt och den understa närmast – annars måste
     * den undres streck gå upp förbi den övres (beslut 2026-09-07).
     */
    if (grupper.size > 1) {
      const mitt = st.mitt;
      const sidaAv = (k: string) => {
        const g = grupper.get(k)!;
        const snitt = g.reduce((sum, p) => sum + p.x + p.w / 2, 0) / g.length;
        return snitt <= mitt ? -1 : 1;
      };
      const toppAv = (k: string) => Math.min(...grupper.get(k)!.map((p) => p.y));
      const ordnade = [...grupper.keys()].sort((a, b) => {
        const sida = sidaAv(a) - sidaAv(b);
        if (sida !== 0) return sida;
        // Vänsterifrån: översta stammen ytterst. Högerifrån: spegelvänt, så
        // att den understa åter hamnar närmast mitten.
        return sidaAv(a) < 0 ? toppAv(a) - toppAv(b) : toppAv(b) - toppAv(a);
      });
      const per = new Map<string, number>();
      ordnade.forEach((k, i) => per.set(k, st.typStammar[i]));
      klusterAnsvarStam.set(anchorId, per);
      klusterNyckel.set(anchorId, new Map(vänsterSida.map((p) => [p.node.id, nyckel(p)])));
    }
  }

  // Okopplade objekt: ett RUTNÄT längst ner, vänster→höger i modellordning, på
  // den FÖRSTA delen. De hör inte till någon kolumn, så de bryts inte över
  // sidor.
  //
  // En enda lång rad räckte inte: en teckenförklaring med tio fristående
  // symboler blev bredare än hela kedjan och sköt ut ur bild. I ett
  // rutnät med LIKA breda celler linjerar symbolerna både i sid- och höjdled,
  // vilket är precis vad en teckenförklaring behöver för att gå att läsa.
  if (lösa.length) {
    const cellW = Math.max(...lösa.map((n) => dim(n).w)) + d.satGapX;
    const cellH = lösaRadH + d.satGapY / 2;
    const bredd = pageWidth ?? Math.max(...ut.map((p) => p.x + p.w), d.margin * 2);
    // En KARTA (t.ex. "Huvudprocess Kund", "4.4 IT") har bara rutor och inga
    // pilar: allt är löst, kedjan är tom och det finns ingen bredd att räkna
    // rutnätet efter. Utan det egna fallet blev raden en enda lodrät kolumn
    // och utlägget 0 px brett – kartan syntes inte alls i EA-portalen. Ett
    // ungefär kvadratiskt rutnät är det närmaste en karta kommer.
    const perRad = ut.length
      ? Math.max(1, Math.floor((bredd - d.margin) / cellW))
      : Math.max(1, Math.ceil(Math.sqrt(lösa.length)));
    lösa.forEach((n, i) => {
      const { w, h } = dim(n);
      const rad = Math.floor(i / perRad);
      const kol = i % perRad;
      ut.push({
        node: n,
        // Centrerad i sin cell – annars står en smal klocka och en bred
        // aktivitet olika långt in i kolumnen.
        x: d.margin + kol * cellW + (cellW - d.satGapX - w) / 2,
        y: lösaTopp + rad * cellH,
        w,
        h,
        page: 0,
        dx: 0,
        dy: 0,
      });
    });
  }

  // Höjden är INNEHÅLLETS, inte den uträknade radgeometrins. Ligger objekten
  // på egna positioner är radhöjderna bara en beräkning som
  // ingenting står i, och utan det här hängde flera hundra pixlar tomrum under
  // bilden i EA-portalen.
  if (ut.length) totalHöjd = Math.max(...ut.map((p) => p.y + p.h + d.margin));

  // Delens bredd räknas på KOLUMNERNA, men allt hamnar inte i en kolumn: en
  // karta utan kedja har inga alls, och objekt på egna koordinater står
  // där de står. Utan det här blev sidan för smal (kartan 0 px) – scenen fick
  // en bredd som inte rymde bilden och EA-portalen klippte eller ritade tomt.
  // Sidbrytning förekommer bara med ett satt `pageWidth`, så det finns exakt
  // en del att bredda här.
  //
  // Och när VARJE objekt har ett eget läge är kolumnerna bara en beräkning som
  // ingenting står i – precis som radhöjderna ovan. Då är bredden innehållets.
  // Annars hängde en tom remsa till höger om bilden (demoflödet för Ramar:
  // 1 820 px för 1 460 px innehåll), och Ramar skalar ner hela bredden till
  // fönstret, remsan med.
  if (pageWidth === null && ut.length) {
    const innehåll = Math.max(...ut.map((p) => p.x + p.w + d.margin));
    const allaPlacerade = ut.every((p) => p.node.position);
    sidBredd.set(0, allaPlacerade ? innehåll : Math.max(sidBredd.get(0) ?? 0, innehåll));
  }

  // ---- Raka, symmetriska streck ner till satelliterna.
  //
  // En aktivitets underkant har EN portpunkt i mitten. Två roller bredvid
  // varandra fick därför var sin Z-böj, och routern la böjarna på olika höjd –
  // "den högra ser ut att ha böjen ovanför den andra". Varje streck ska gå
  // rakt upp från sin symbol och möta aktivitetens
  // underkant PÅ SIN EGEN x. Layouten pekar därför ut portpunkterna: samma x i
  // båda ändar ⇒ ett rakt streck, och lika för alla satelliter under samma
  // aktivitet. Ligger satelliten utanför aktivitetens bredd klipps x till
  // kanten – då blir det en böj, men samma böj för alla.
  /** Användarens val för en relation – etikettnyckeln först, paret som reserv. */
  const egetVal = (rel: ApRelation): EdgeSides | undefined => {
    const stilar = opts?.edgeStyles;
    if (!stilar) return undefined;
    const text = rel.kind === "huki" ? rel.huki : rel.label;
    return (
      (text ? stilar[edgeKey(rel.source, rel.target, text)] : undefined) ??
      stilar[edgeKey(rel.source, rel.target)]
    );
  };

  /** Satellitrelationerna, med sin satellit och sitt ankare. */
  const satRelationer: { rel: ApRelation; sat: ApLaidOutNode; ankare: ApLaidOutNode }[] = [];
  for (const rel of model.relations) {
    if (rel.kind === "flode") continue;
    const a = platsFör.get(rel.source);
    const b = platsFör.get(rel.target);
    if (!a || !b) continue;
    const sat = ankarFör.get(a.node.id) === b.node.id ? a : ankarFör.get(b.node.id) === a.node.id ? b : null;
    if (!sat) continue;
    satRelationer.push({ rel, sat, ankare: sat === a ? b : a });
  }

  /**
   * GEMENSAM LINJE per aktivitet och riktning: den höjd där satelliternas
   * streck böjer, och där bokstaven står.
   *
   * Utan den låg HR:s böj på en höjd och ReachMees på en annan, och bokstaven
   * satt mitt på VAR LINJE – och eftersom en hatt och en cylinder är olika
   * höga hamnade bokstäverna på olika höjd också. "De ska linjera och vara
   * symmetriska vid böjar". Linjen läggs mitt emellan aktivitetens
   * kant och den NÄRMASTE satelliten, så ingen väg behöver gå bakåt.
   */
  const gemensamY = new Map<string, number>();
  for (const { sat, ankare } of satRelationer) {
    const under = sat.y > ankare.y;
    const ankarY = under ? ankare.y + ankare.h : ankare.y;
    const satIkon = ikonPortRuta(sat.node.kind, sat.w, sat.h);
    const satY = under
      ? sat.y + (satIkon?.y ?? 0)
      : sat.y + (satIkon ? satIkon.y + satIkon.h : sat.h);
    const nyckel = `${ankare.node.id}:${under ? "under" : "över"}`;
    const mitt = ankarY + (satY - ankarY) / 2;
    const nuvarande = gemensamY.get(nyckel);
    // Närmast aktiviteten vinner – då ligger linjen mellan ALLA satelliter och
    // aktiviteten, aldrig bortom någon av dem.
    if (
      nuvarande === undefined ||
      (under ? mitt < nuvarande : mitt > nuvarande)
    ) {
      gemensamY.set(nyckel, mitt);
    }
  }

  const ports: Record<string, { from?: Point; to?: Point; via?: Point }> = {};
  /** Anslutningssidor som klustret kräver – läggs in i `sides` längre ner. */
  const satSides: Record<string, EdgeSides> = {};
  for (const { rel, sat, ankare } of satRelationer) {
    const satIkon = ikonPortRuta(sat.node.kind, sat.w, sat.h);
    const sida = klusterSida.get(sat.node.id);
    const stammar = klusterStam.get(ankare.node.id);
    if (sida && stammar) {
      const stam =
        sida === "vänster"
          ? (klusterAnsvarStam
              .get(ankare.node.id)
              ?.get(klusterNyckel.get(ankare.node.id)?.get(sat.node.id) ?? "") ?? stammar.vänster)
          : stammar.höger;
      // Kluster: vågrätt streck ut ur symbolens sida, böj vid stammen, lodrätt
      // upp till aktivitetens underkant. Alla satelliter under samma aktivitet
      // delar stammen, så bilden får ETT streck upp i stället för fem.
      const rx = sat.x + (satIkon?.x ?? 0);
      const rw = satIkon?.w ?? sat.w;
      const ry = sat.y + (satIkon?.y ?? 0);
      const rh = satIkon?.h ?? sat.h;
      const mittY = ry + rh / 2;
      /**
       * Strecket lämnar den sida av symbolen som VETTER MOT STAMMEN.
       *
       * Sorten bestämmer VILKEN stam satelliten hänger i (aktörer i den ena,
       * IT-stödet i den andra); LÄGET bestämmer vilken väg strecket tar dit. I
       * ett utlägg vi själva räknat fram är det samma sak, men ett handplacerat
       * utlägg har objekten där processägaren lagt dem – ofta fem roller i
       * två kolumner med stammen emellan. Lämnade strecket alltid högerkanten
       * fick de högra rollerna gå ut, vända och komma tillbaka tvärs över de
       * andra: "4.4.4 ser helt tokig ut med linjer" (beslut 2026-09-07).
       */
      /**
       * Står symbolen GRENSLE över stammen går strecket rakt upp.
       *
       * Med stammen fäst i aktivitetens mitt hamnar den ofta mitt över den
       * enda rollen under en aktivitet. Ett vågrätt streck ut ur ikonens kant
       * och tillbaka in under den la sig då tvärs över symbolen det utgick
       * från – en liten hake i stället för en rak uppgång. Ett
       * lodrätt streck ur ikonens överkant är både kortare och samma bild.
       */
      const symbolMitt = rx + rw / 2;
      const rakt = stam > rx && stam < rx + rw;
      const utåtHöger = symbolMitt <= stam;
      const satPunkt = rakt
        ? { x: stam, y: ry } // ikonens överkant – aktiviteten ligger ovanför
        : { x: utåtHöger ? rx + rw : rx, y: mittY };
      const ankarPunkt = {
        x: stam,
        y: ankare.y + apKontur(ankare.node.kind, ankare.w, ankare.h, stam - ankare.x).botten,
      };
      const satÄrKällan = rel.source === sat.node.id;
      const eget = egetVal(rel);
      const satSida = rakt ? "top" : utåtHöger ? "right" : "left";
      // Böjen ligger vid stammen, i satellitens höjd. Går strecket rakt upp
      // finns ingen böj – en via NEDANFÖR startpunkten hade skickat vägen ner
      // och tillbaka upp igen.
      const böj = rakt ? undefined : { x: stam, y: mittY };
      /**
       * KLUSTRETS PUNKT vinner över en ärvd POSITION på samma sida.
       *
       * En sparad anslutningspunkt "mitt på sidan" (pos 0,5 = förvalet) är
       * inget val. Läste vi den rakt av utgick alla streck under en aktivitet
       * från samma punkt – aktivitetens mitt – och den blå HUKI-linjen
       * försvann bakom den svarta IT-stödslinjen (beslut 2026-09-07).
       * Klustrets två stammar håller isär dem, och de ska då få gälla.
       *
       * Ett eget val som pekar åt ETT ANNAT HÅLL är däremot fortfarande
       * användarens: bara sidan avgör, aldrig positionen på den. Och den som
       * DRAR en ändpunkt ska fortfarande styra: en position som avviker från
       * mitten är ett handgrepp, och då gäller det.
       */
      const draget = (pos: number | undefined) => pos !== undefined && Math.abs(pos - 0.5) > 0.001;
      const egenKällSida = eget?.sourceSide;
      const egenMålSida = eget?.targetSide;
      if (draget(eget?.sourcePos) || draget(eget?.targetPos)) {
        ports[rel.id] = {
          from: draget(eget?.sourcePos) ? undefined : satÄrKällan ? satPunkt : ankarPunkt,
          to: draget(eget?.targetPos) ? undefined : satÄrKällan ? ankarPunkt : satPunkt,
          via: böj,
        };
        satSides[rel.id] = satÄrKällan
          ? { sourceSide: satSida, targetSide: "bottom" }
          : { sourceSide: "bottom", targetSide: satSida };
        continue;
      }
      const klusterKällSida = satÄrKällan ? satSida : "bottom";
      const klusterMålSida = satÄrKällan ? "bottom" : satSida;
      ports[rel.id] = {
        from:
          egenKällSida && egenKällSida !== klusterKällSida
            ? undefined
            : satÄrKällan
              ? satPunkt
              : ankarPunkt,
        to:
          egenMålSida && egenMålSida !== klusterMålSida
            ? undefined
            : satÄrKällan
              ? ankarPunkt
              : satPunkt,
        via: böj,
      };
      satSides[rel.id] = satÄrKällan
        ? { sourceSide: satSida, targetSide: "bottom" }
        : { sourceSide: "bottom", targetSide: satSida };
      continue;
    }
    const satMitt = sat.x + (satIkon ? satIkon.x + satIkon.w / 2 : sat.w / 2);
    const x = Math.min(Math.max(satMitt, ankare.x + 6), ankare.x + ankare.w - 6);
    const satUnder = sat.y > ankare.y;
    const satY = satUnder
      ? sat.y + (satIkon?.y ?? 0) // satellitens ÖVERkant (ikonens)
      : sat.y + (satIkon ? satIkon.y + satIkon.h : sat.h);
    const kontur = apKontur(ankare.node.kind, ankare.w, ankare.h, x - ankare.x);
    const ankarY = ankare.y + (satUnder ? kontur.botten : kontur.topp);
    const satPunkt = { x: satMitt, y: satY };
    const ankarPunkt = { x, y: ankarY };
    // Satelliten är källa i HUKI och Adresserar, mål i Samverkar.
    const satÄrKälla = rel.source === sat.node.id;
    const p = satÄrKälla
      ? { from: satPunkt, to: ankarPunkt }
      : { from: ankarPunkt, to: satPunkt };
    // Har användaren VALT en kopplingspunkt på någon ände styr det valet där –
    // layoutens automatiska punkt gäller bara den ände som inte är vald.
    const eget = egetVal(rel);
    ports[rel.id] = {
      from: eget?.sourceSide || eget?.sourcePos !== undefined ? undefined : p.from,
      to: eget?.targetSide || eget?.targetPos !== undefined ? undefined : p.to,
      // Böjen (och bokstaven) hamnar på aktivitetens gemensamma linje.
      via: { x: satMitt, y: gemensamY.get(`${ankare.node.id}:${satUnder ? "under" : "över"}`)! },
    };
  }

  // ---- Anslutningssidor för in-/ut-objekt som hamnat på en annan rad.
  //
  // Ett explicit [In: …] har ingen inkommande koppling och delar kolumn med
  // kedjans egna objekt – kollisionsregeln knuffar det då en rad ner. Med
  // routerns generella regel (olika rad ⇒ lodrät anslutning) gick pilen ut ur
  // objektets ÖVERKANT och in i aktivitetens UNDERKANT: på skärmen läste det
  // som en utgång från aktiviteten som tog slut i ett objekt, tvärtemot vad
  // den betyder. Ett in-objekt ska komma in från VÄNSTER som allt annat i
  // kedjan, och ett ut-objekt lämna åt HÖGER.
  //
  // Bara relationer där exakt EN ände är ett verksamhetsobjekt berörs. Regel →
  // gren rörs aldrig: där är vägen nedåt hela poängen med grenraden.
  const sides: Record<string, EdgeSides> = { ...satSides };
  for (const rel of model.relations) {
    if (rel.kind !== "flode") continue;
    const a = platsFör.get(rel.source);
    const b = platsFör.get(rel.target);
    if (!a || !b) continue;
    if ((a.node.kind === "vo") === (b.node.kind === "vo")) continue;
    if ((row.get(rel.source) ?? 0) === (row.get(rel.target) ?? 0)) continue;
    const kolA = rank.get(rel.source)!;
    const kolB = rank.get(rel.target)!;
    if (kolA === kolB) continue; // samma kolumn – ingen vettig vågrät väg
    sides[rel.id] =
      kolA < kolB
        ? { sourceSide: "right", targetSide: "left" }
        : { sourceSide: "left", targetSide: "right" };
  }

  // ANVÄNDARENS EGNA VAL läggs på sist och vinner – kopplingspunkten man dragit
  // till en annan sida, och brytpunkten man satt. Det är här skärm och fil möts:
  // exporten har ingen draft att fråga, den läser bara layouten.
  for (const rel of model.relations) {
    const eget = egetVal(rel);
    if (eget) sides[rel.id] = { ...sides[rel.id], ...eget };
  }

  // Bilden ska rymma BRYTPUNKTERNA, inte bara objekten. Återkopplingar kan
  // dras som en räls under kedjan, långt nedanför den lägsta rutan, och med
  // höjden räknad på objekten
  // klipptes rälsen bort – i exporten gick tre streck rakt ut ur bildens
  // nederkant. Brytpunkten ligger i fria layoutens ram (invariant 5) och
  // följer källobjektets förskjutning.
  for (const rel of model.relations) {
    const källa = platsFör.get(rel.source);
    if (!källa) continue;
    const val = sides[rel.id];
    for (const wp of [val?.waypoint, val?.waypoint && val.waypoint2]) {
      if (!wp) continue;
      totalHöjd = Math.max(totalHöjd, wp.y + källa.dy + d.margin);
      if (pageWidth === null) sidBredd.set(0, Math.max(sidBredd.get(0) ?? 0, wp.x + källa.dx + d.margin));
    }
  }

  // ---- Sidhänvisningar för relationer som korsar ett snitt.
  const refs: ApPageRef[] = [];
  for (const rel of model.relations) {
    const a = ut.find((p) => p.node.id === rel.source);
    const b = ut.find((p) => p.node.id === rel.target);
    if (!a || !b || a.page === b.page) continue;
    refs.push({
      relationId: rel.id,
      riktning: "ut",
      page: a.page,
      x: a.x + a.w + 8,
      y: a.y + a.h / 2,
      text: `till del ${b.page + 1}`,
    });
    refs.push({
      relationId: rel.id,
      riktning: "in",
      page: b.page,
      x: b.x - 8,
      y: b.y + b.h / 2,
      text: `från del ${a.page + 1}`,
    });
  }

  const pages: ApPage[] = [];
  for (let s = 0; s < antalSidor; s++) {
    pages.push({
      index: s,
      x: sidOffset.get(s)!,
      y: 0,
      w: pageWidth ?? sidBredd.get(s) ?? 0,
      h: totalHöjd,
    });
  }

  const sista = pages[pages.length - 1];
  return {
    nodes: ut,
    relations: model.relations,
    ports,
    sides,
    pages,
    refs,
    width: sista ? sista.x + sista.w : 0,
    height: totalHöjd,
    scale,
  };
}
