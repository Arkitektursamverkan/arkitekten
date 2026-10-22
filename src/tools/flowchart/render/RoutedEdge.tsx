/**
 * Egen React Flow-kant som routar med SAMMA kollisionsundvikande router som
 * SVG-exporten (edge-router.ts). Utan den skulle canvasen rita `smoothstep`
 * rakt genom objekt medan exporten går runt – skärm och fil skulle säga emot
 * varandra igen.
 *
 * Hindren (alla nodrutor) delas via en modul-ref som FlowCanvas fyller innan
 * kanterna byggs. En kant undantar sina egna två ändar.
 *
 * MANUELL BRYTPUNKT: en kant kan bära en `waypoint` (i fri-layoutens koordinater,
 * som nodpositioner). Är den satt går kanten med räta vinklar rakt genom punkten
 * – så tvingar man den till andra sidan om ett objekt. Handtaget mitt på kanten
 * går att dra för att sätta/flytta brytpunkten; dubbelklick nollar den.
 */

import { BaseEdge, EdgeLabelRenderer, Position, useReactFlow, type EdgeProps } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import {
  andelAvPath,
  labelAnchor,
  labelBesideMid,
  pointAlongPath,
  dragbaraSträckor,
  pointsToPath,
  routeEdge,
  sistaSträckan,
  type Sträckgrepp,
  type Point,
  type Rect,
  type Side,
} from "../layout/edge-router";
import { snapWaypointToEdges, type Guides } from "./snap";

/** id → nodruta i flödeskoordinater. Sätts av FlowCanvas varje render. */
export const obstacleRects = { current: new Map<string, Rect>() };

/**
 * id → PORTRUTA, när den skiljer sig från hinderrutan. Affärsprocessvyns ikonobjekt är
 * mest etikett: pilen ska fästa i symbolen upptill, inte i etikettrutans kant.
 * Rutan används BARA för att räkna fram porten – hindren (och därmed väjningen)
 * går fortfarande på hela rutan, så en väg inte skär genom namnet.
 */
export const portRects = { current: new Map<string, Rect>() };

/**
 * kant-id → aktuell väg (punktlista i flödeskoordinater). Varje RoutedEdge
 * skriver in sin väg vid render; en brytpunkt som dras med SHIFT linjerar
 * mot de ANDRA vägarnas raka segment (röda hjälplinjer, som objekten).
 * Canvasen nollställer mappen när layouten byggs om, annars spökar vägar
 * från borttagna kanter kvar som linjeringsmål.
 */
export const edgePaths = { current: new Map<string, Point[]>() };

const SIDE: Record<Position, Side> = {
  [Position.Top]: "top",
  [Position.Right]: "right",
  [Position.Bottom]: "bottom",
  [Position.Left]: "left",
};

/** Data FlowCanvas lägger på en sekvenskant för att göra brytpunkten dragbar. */
/**
 * Hovertexten på en kants ETIKETT.
 *
 * Kopplingens innebörd först, handgreppet sist. En ensam bokstav ("U" på en
 * HUKI-relation) säger ingenting för den som inte kan metoden utantill – och
 * det är just bokstaven man pekar på, inte det tunna strecket bredvid. Förut
 * bar etiketten bara handgreppet ("dra för att flytta"), alltså ett svar på en
 * fråga ingen ställt, och i affärsprocessen – där etiketten varken går att dra eller
 * skriva – ingenting alls.
 */
export function etikettTitel(innebörd?: string, handgrepp?: string): string | undefined {
  return [innebörd, handgrepp].filter(Boolean).join(" · ") || undefined;
}

export interface RoutedEdgeData extends Record<string, unknown> {
  /** Brytpunkt i FRI-layoutens koordinater (eller undefined = automatisk väg). */
  waypoint?: { x: number; y: number } | null;
  /** Källnodens förskjutning från fri-layouten, för att översätta brytpunkten. */
  srcDx?: number;
  srcDy?: number;
  /** Sätter (fri-koordinater) eller nollar (null) brytpunkten. Saknas = ej dragbar. */
  onWaypointChange?: (source: string, target: string, point: Point | null, label?: string) => void;
  /** Andra brytpunkten (fri-koordinater) – var sista sträckan in i målet går. */
  waypoint2?: { x: number; y: number } | null;
  /**
   * Flyttar sista sträckan (sätter `waypoint2`) eller nollar den. Saknas = den
   * sträckan har inget handtag. Se `sistaSträckan` i edge-router.
   */
  onWaypoint2Change?: (source: string, target: string, point: Point | null, label?: string) => void;
  /** Etikettens läge längs kanten som andel 0–1. Saknas = labelAnchor väljer. */
  labelPos?: number;
  /**
   * Flyttar etiketten (andel 0–1) eller återställer den (null). Saknas =
   * etiketten går inte att dra – t.ex. i låst läge.
   */
  onLabelPosChange?: (source: string, target: string, andel: number | null, label?: string) => void;
  /**
   * Sätter kantens ETIKETT. Saknas = etiketten går inte att redigera (låst läge).
   * Tom sträng betyder "ingen etikett" på en handritad pil; på en gren vägrar
   * mellanlagret (se etikettHinder).
   */
  onLabelTextChange?: (source: string, target: string, nuvarande: string | undefined, ny: string) => void;
  /**
   * Etiketten redigeras just nu. Styrs UTIFRÅN: React Flow lägger en egen
   * osynlig interaktionsbana ovanpå kanten, så ett dubbelklick på vår egen
   * träffyta nådde aldrig fram. Canvasen fångar `onEdgeDoubleClick` i stället.
   */
  redigerar?: boolean;
  /** Stänger fältet (canvasen äger vilken kant som redigeras). */
  onStängEtikett?: () => void;
  /** Öppnar fältet – används av brytpunktshandtaget, se onDoubleClick där. */
  onÖppnaEtikett?: () => void;
  /** Varför en etikett inte går att sätta – visas medan man skriver. */
  etikettHinder?: (nuvarande: string | undefined, ny: string) => string | null;
  /**
   * Rak väg utan väjning (meddelandeflöden): en streckad annotering som ritas
   * under objekten ska gå rakt, inte böja runt dem.
   */
  rak?: boolean;
  /**
   * Hovertext för kopplingen (native tooltip). Ritas som ett osynligt svep
   * längs banan med ett <title> i – så räcker det att peka VAR SOM HELST på
   * kopplingen, man behöver inte träffa den lilla etiketten.
   */
  titel?: string;
  /**
   * Portpunkter som LAYOUTEN pekat ut (flödeskoordinater). Används när en kant
   * ska börja/sluta på en bestämd punkt i stället för mitt på en sida –
   * affärsprocessens satellitstreck, som annars trängdes i aktivitetens mittport och fick var
   * sin böj. Punkterna gäller bara medan noden ligger på sin layoutplats;
   * dras den följer kanten handen.
   */
  from?: Point;
  to?: Point;
  /**
   * Etiketten ritas BREDVID banan i stället för på den (affärsprocessvyn). En kort
   * koppling – strecket ner till en roll – blev annars fyra saker i stället för
   * en: streck, vit etikettruta, streck igen, pil. Och brytpunktshandtaget,
   * som annars flyttas undan för etiketten, kan sitta kvar mitt på.
   */
  etikettBredvid?: boolean;
  /**
   * Böjpunkt som LAYOUTEN pekat ut (flödeskoordinater) – affärsprocessvyns gemensamma
   * linje under en aktivitet, där alla satellitstreck böjer och alla bokstäver
   * står. Användarens egen brytpunkt vinner alltid över den.
   */
  via?: Point;
  /**
   * Kantnyckelns etikett när den skiljer sig från den UTSKRIVNA
   * (affärsprocessens HUKI: "U" är förvalet och skrivs inte ut, men nyckeln
   * bär det). Läses av den som
   * behöver identifiera kanten i mellanlagret – aldrig av renderingen.
   */
  etikettNyckel?: string;
  /**
   * Hörnradie på vägen. Affärsprocessens rityta sätter den (strecken svänger
   * mjukt); flödesschemat lämnar den tom och behåller sina räta vinklar. Kommer HÄR
   * och inte som en egen regel i canvasen: exporten och scenen läser samma
   * `pointsToPath`, och en radie som bara syntes på skärmen hade varit precis
   * den glidningen invariant 1 finns för.
   */
  hörnradie?: number;
}

/**
 * Ska brytpunktens handtag finnas? EN regel, på ett ställe.
 *
 * Vakterna avgör om handtaget ska ERBJUDAS – inte om en pågående gest får
 * fortsätta. Därför slår `drarNu` ut allt annat: handtaget är ett DOM-element som
 * bär sin egen pointer-capture, så avmonteras det mitt i en dragning följer
 * capturen med, `pointerup` landar på objektet under, och brytpunkten sparas
 * aldrig. Precis det hände så fort man förde böjen in över någon av ändarna –
 * värst på de streckade kopplingarna, där noden och datalagret ofta står tätt
 * ihop och det är några få pixlar dit.
 */
export function brytpunktDragbar(v: {
  /** Finns någon som kan ta emot ändringen? (låst läge skickar ingen.) */
  harHandlare: boolean;
  /** En dragning pågår just nu. */
  drarNu: boolean;
  /** Vägens längd i pixlar – på en mycket kort väg finns inget att böja. */
  längd: number;
  /** Kanten har redan en brytpunkt (då ska handtaget alltid gå att ta i). */
  harBrytpunkt: boolean;
  /** Handtaget skulle hamna inne i något av objekten i ändarna. */
  iÄnde: boolean;
}): boolean {
  if (!v.harHandlare) return false;
  if (v.drarNu) return true;
  // En EGEN brytpunkt gör handtaget gripbart oavsett var den hamnat. Drog man
  // böjen in över ett objekt försvann handtaget annars, och punkten gick inte
  // att ta tillbaka – varken flytta eller nolla med dubbelklick.
  if (v.harBrytpunkt) return true;
  return v.längd >= 24 && !v.iÄnde;
}

/**
 * Var handtaget ska sitta när den ÖNSKADE platsen (vägens mitt) ligger inne i
 * ett av objekten i ändarna.
 *
 * Handtaget glider då längs vägen till närmaste punkt som är fri, i stället för
 * att försvinna. Att dölja det var fel svar: en streckad koppling mellan en
 * aktivitet och ett datalager strax intill har ofta sin mittpunkt inne i den ena
 * rutan, och då gick böjen inte att flytta alls fast vägen var över hundra pixlar
 * lång. `null` när HELA vägen ligger inne i objekten – då finns inget att böja.
 */
export function friHandtagsAndel(
  pts: Point[],
  fritt: (p: Point) => boolean,
  /** Andelen handtaget helst sitter på (mitten, eller 0,72 när en etikett är i vägen). */
  önskad = 0.5,
): number | null {
  if (fritt(pointAlongPath(pts, önskad))) return önskad;
  // Sök utåt från den önskade platsen, växelvis framåt och bakåt, så att
  // handtaget hamnar så nära mitten som möjligt.
  for (let steg = 1; steg <= 20; steg++) {
    for (const andel of [önskad + steg * 0.04, önskad - steg * 0.04]) {
      if (andel < 0.02 || andel > 0.98) continue;
      if (fritt(pointAlongPath(pts, andel))) return andel;
    }
  }
  return null;
}

export function RoutedEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
  labelStyle,
  data,
}: EdgeProps) {
  const d = (data ?? {}) as RoutedEdgeData;
  const { screenToFlowPosition } = useReactFlow();
  const dragging = useRef(false);
  /** Lokalt släp-läge (fri-koordinater) medan man drar – slipper recompile per musruck. */
  const [dragFree, setDragFree] = useState<Point | null>(null);
  /** Röda hjälplinjer medan brytpunkten Shift-linjeras mot andra kanter. */
  const [guide, setGuide] = useState<Guides | null>(null);
  /**
   * Släppunkten som REF, alltid färsk. React 18 skjuter upp och slår ihop
   * state-uppdateringar från pointermove (låg prioritet) – vid pointerup kunde
   * `dragFree` fortfarande vara null trots ett helt drag, och brytpunkten
   * sparades aldrig. Ur refen läses det som faktiskt drogs.
   */
  const dragPos = useRef<Point | null>(null);
  /**
   * Dragning av en SLÄTT STRÄCKA (se `dragbaraSträckor`): vilket grepp som
   * drar, och de två punkterna medan det pågår. Egna vakter (invariant 6).
   */
  const grepp = useRef<Sträckgrepp | null>(null);
  const [dragFree2, setDragFree2] = useState<Point | null>(null);
  const sträckDrag = useRef<{ via: Point | null; via2: Point | null } | null>(null);
  /**
   * Etikettens egen dragning. Skild från brytpunktens: ett dragghandtag agerar
   * bara på SIN egen gest, annars flyttar en pekare som sveper förbi fel sak.
   * Andelen ligger i en ref av samma skäl som `dragPos` ovan.
   */
  /**
   * ETIKETTEN REDIGERAS. Dubbelklick på kopplingen (linjen eller etiketten)
   * öppnar fältet – samma gest som på ett objekt. Ett dubbelklick på etiketten
   * nollade tidigare dess läge längs vägen; den återställningen bor nu på
   * brytpunktshandtaget, som är den enda gest som fanns för den ändå.
   */
  const [etikettText, setEtikettText] = useState("");
  const etikettAvbruten = useRef(false);
  const etikettRef = useRef<HTMLInputElement>(null);
  const labelDrag = useRef(false);
  const labelAndel = useRef<number | null>(null);
  const [labelDragAndel, setLabelDragAndel] = useState<number | null>(null);

  const dx = d.srcDx ?? 0;
  const dy = d.srcDy ?? 0;
  const toLocal = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  const toFree = (p: Point): Point => ({ x: p.x - dx, y: p.y - dy });

  // Fri-koordinat som gäller just nu: släp-läget vinner, annars det sparade.
  // Utan egen brytpunkt används layoutens (den gemensamma linjen).
  const free = dragFree ?? d.waypoint ?? null;
  const via = free ? toLocal(free) : (d.via ?? null);
  // Den andra punkten gäller bara ihop med en EGEN brytpunkt.
  const free2 = free ? (dragFree2 ?? d.waypoint2 ?? null) : null;
  const via2 = free2 ? toLocal(free2) : null;

  // Kantändar kan bära canvas-prefix (ds_ för datalager, bb_N_ för pooler)
  // medan hindren är nycklade på modell-id. Utan rensningen kände en
  // dataassociation inte igen sitt EGET datalager som ände och routade runt
  // sin egen cylinder.
  const rensa = (id: string) => id.replace(/^ds_/, "").replace(/^bb_\d+_/, "");
  const srcId = rensa(source);
  const tgtId = rensa(target);
  const obstacles: Rect[] = [];
  if (!d.rak) {
    for (const [id, r] of obstacleRects.current) {
      if (id !== srcId && id !== tgtId) obstacles.push(r);
    }
  }

  // PORTARNA räknas ur LAYOUTENS rutor – samma regel som exporten – inte ur
  // React Flows mätta handtagspositioner. Mätningen kunde ligga några pixlar
  // utanför layoutrutan (stale handleBounds), så auto-kanter ritades 3–4 px
  // fel på skärmen jämfört med filen: en Shift-linjering som såg perfekt ut
  // på ytan var bevisligen sned i exporten (en exporterad 5.svg). React Flows värde
  // används bara när noden är LÅNGT från sin layoutplats – dvs. mitt i ett
  // pågående drag, då kanten ska följa med handen.
  const sidaAv = (b: Rect, side: Side): Point =>
    side === "top"
      ? { x: b.x + b.w / 2, y: b.y }
      : side === "bottom"
        ? { x: b.x + b.w / 2, y: b.y + b.h }
        : side === "left"
          ? { x: b.x, y: b.y + b.h / 2 }
          : { x: b.x + b.w, y: b.y + b.h / 2 };

  const layoutPort = (id: string, side: Side, rfPort: Point, utpekad?: Point): Point => {
    const b = obstacleRects.current.get(id);
    // Ingen känd ruta – t.ex. ett mottagarband (svart låda), som inte är ett
    // objekt utan en pool. Har LAYOUTEN pekat ut punkten gäller den; annars
    // återstår React Flows mätta handtag. Utan `utpekad` här landade
    // meddelandeflödet på bandets CACHADE handtagsläge: flyttade man avsändaren
    // följde pilens start med men dess slut stod kvar där noden hade legat.
    if (!b) return utpekad ?? rfPort;
    const p = sidaAv(b, side);
    // Ligger noden LÅNGT från sin layoutplats dras den just nu – då ska kanten
    // följa handen, alltså React Flows mätta port.
    if (Math.abs(p.x - rfPort.x) + Math.abs(p.y - rfPort.y) >= 12) return rfPort;
    // Layoutens egen punkt vinner (satellitstrecken), därefter en egen portruta
    // (affärsprocessvyns ikonobjekt fäster pilen i symbolen, inte i etikettrutans kant).
    // Handtagen sitter kvar i kanten – flyttades de dit hamnade de mitt i rutan
    // och stal dragningen av objektet.
    if (utpekad) return utpekad;
    const port = portRects.current.get(id);
    return port ? sidaAv(port, side) : p;
  };
  const from = layoutPort(srcId, SIDE[sourcePosition], { x: sourceX, y: sourceY }, d.from);
  const to = layoutPort(tgtId, SIDE[targetPosition], { x: targetX, y: targetY }, d.to);

  const pts = routeEdge({
    from,
    fromSide: SIDE[sourcePosition],
    to,
    toSide: SIDE[targetPosition],
    obstacles,
    via,
    via2,
  });
  // Dela vägen med andra kanter – Shift-linjeringens mål.
  edgePaths.current.set(id, pts);
  const path = pointsToPath(pts, d.hörnradie ?? 0);

  // Etiketten mitt på vägens LÄNGD – samma ankare som SVG-exporten använder.
  // I affärsprocessvyn läggs den bredvid strecket (samma regel, labelBesideMid).
  // Etiketten står vid BÖJEN när layouten pekat ut en – då hamnar alla
  // bokstäver under samma aktivitet på samma höjd. Annars mitt på vägen.
  const bredvid = d.etikettBredvid
    ? d.via && !free
      ? { x: d.via.x + 6, y: d.via.y, sida: "höger" as const }
      : labelBesideMid(pts)
    : null;
  const mid = bredvid ?? labelAnchor(pts, d.labelPos);
  /**
   * Under en pågående dragning följer etiketten pekarens projektion PÅ vägen
   * (den kan inte lämna kopplingen), annars sitter den på sitt ankare. Samma
   * uppdelning som brytpunkten: tillståndet ritar, refen sparar.
   */
  const etikettLäge = labelDragAndel !== null ? pointAlongPath(pts, labelDragAndel) : mid;
  // Handtaget: på brytpunkten om satt. Annars mitt på vägen – utom när en
  // etikett sitter där: då läggs handtaget en bit längre fram, annars täcker
  // det etiketten och stjäl dess klick.

  /**
   * Banans längd – ett handtag mitt på en mycket kort koppling ligger ovanpå
   * objekten i ändarna och tar emot klick som var menade för dem (satellitens
   * streck kan bli några få pixlar när aktiviteten dragits ner mot rollen).
   * Det finns heller inget att böja på en så kort väg.
   */
  const längd = pts.reduce(
    (sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y)),
    0,
  );
  /**
   * …och handtaget får inte ligga OVANPÅ något av objekten i ändarna. Dras en
   * aktivitet ner mot sin roll hamnar mittpunkten inuti rutan, och då tar
   * handtaget emot klicket som var menat för objektet – man kunde varken välja
   * eller flytta det.
   */
  const iRuta = (p: Point, id: string) => {
    const r = obstacleRects.current.get(id);
    return Boolean(r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
  };
  /**
   * Var handtaget FÅR sitta: inte inne i ändobjekten, och inte ovanpå
   * ETIKETTEN. Etiketten är klickbar (dubbelklick skriver texten, drag flyttar
   * den längs vägen) – låg handtaget över den tog det både klicket och draget,
   * och dubbelklicket nollade brytpunkten i stället för att öppna textfältet.
   */
  const fritt = (p: Point) =>
    !iRuta(p, srcId) &&
    !iRuta(p, tgtId) &&
    (!label || Math.hypot(p.x - mid.x, p.y - mid.y) > 26);
  /**
   * Har kanten en EGEN brytpunkt sitter handtaget på den, punkt. Annars mitt på
   * vägen – eller 0,72 in när en etikett sitter i mitten och skulle täckas – och
   * ligger den platsen inne i ett av ändobjekten GLIDER handtaget undan längs
   * vägen i stället för att försvinna.
   */
  const önskadAndel = label && !bredvid ? 0.72 : 0.5;
  const autoAndel = friHandtagsAndel(pts, fritt, önskadAndel);
  const handle = free
    ? via!
    : pointAlongPath(pts, autoAndel ?? önskadAndel);
  const draggable = brytpunktDragbar({
    harHandlare: Boolean(d.onWaypointChange),
    drarNu: dragFree !== null,
    längd,
    harBrytpunkt: Boolean(via),
    // Hela vägen låg inne i objekten – då finns ingen fri plats alls.
    iÄnde: autoAndel === null,
  });
  // Etiketten skiljer två pilar mellan samma nodpar åt i mellanlagrets nycklar.
  const edgeLabel = typeof label === "string" ? label : undefined;

  /**
   * DRAGBARA STRÄCKOR. Med en egen brytpunkt tar man tag i LINJEN där man ser
   * den – rälsen flyttas upp/ner, en lodrät sträcka i sidled, och sista
   * sträckan in mot målet går förbi målets satelliter. Handtaget på själva
   * brytpunkten finns kvar, men den kan ligga tusentals pixlar bort.
   */
  const sista = sistaSträckan(SIDE[sourcePosition], to, SIDE[targetPosition]);
  const sträckor =
    free && d.onWaypointChange
      ? dragbaraSträckor(pts, { fromSide: SIDE[sourcePosition], to, toSide: SIDE[targetPosition], via }).filter(
          (x) => !x.grepp.startsWith("via2") || Boolean(d.onWaypoint2Change),
        )
      : [];
  const onSträckDown = (g: Sträckgrepp) => (e: React.PointerEvent) => {
    if (e.button !== 0) return; // bara vänsterknappen
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    grepp.current = g;
  };
  const onSträckMove = (e: React.PointerEvent) => {
    const g = grepp.current;
    if (!g || !via) return; // bara vår EGEN dragning
    if (!(e.buttons & 1)) return;
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const nu = sträckDrag.current ?? { via: null, via2: null };
    if (g === "via.x" || g === "via.y") {
      const ny = toFree(g === "via.x" ? { x: p.x, y: via.y } : { x: via.x, y: p.y });
      sträckDrag.current = { ...nu, via: ny };
      setDragFree(ny);
    } else if (sista) {
      const ny = toFree(sista.via2(p));
      sträckDrag.current = { ...nu, via2: ny };
      setDragFree2(ny);
    }
  };
  const onSträckUp = (e: React.PointerEvent) => {
    if (!grepp.current) return;
    grepp.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    const slut = sträckDrag.current; // refen, inte state – state kan släpa efter
    sträckDrag.current = null;
    setDragFree(null);
    setDragFree2(null);
    if (slut?.via) d.onWaypointChange?.(source, target, slut.via, edgeLabel);
    if (slut?.via2) d.onWaypoint2Change?.(source, target, slut.via2, edgeLabel);
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // bara vänsterknappen startar en dragning
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true;
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current) return; // bara vår egen dragning, inte en pekare som sveper förbi
    if (!(e.buttons & 1)) return; // bara medan vänsterknappen hålls
    let p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    // SHIFT: linjera mot de ANDRA kopplingarnas raka segment, med röda
    // hjälplinjer – samma gest och samma tolerans som objektlinjeringen.
    if (e.shiftKey) {
      const andra: Point[][] = [];
      for (const [eid, väg] of edgePaths.current) {
        if (eid !== id) andra.push(väg);
      }
      const res = snapWaypointToEdges(p, andra);
      p = res.position;
      setGuide(res.guides);
    } else if (guide) {
      setGuide(null);
    }
    dragPos.current = toFree(p);
    setDragFree(dragPos.current);
  };
  const onUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    const slut = dragPos.current; // refen, inte state – state kan släpa efter
    dragPos.current = null;
    setDragFree(null);
    setGuide(null);
    if (slut) d.onWaypointChange?.(source, target, slut, edgeLabel);
  };
  /**
   * Dubbelklick på brytpunktshandtaget.
   *
   * Finns en egen brytpunkt nollas den – tillbaka till automatisk väg. Finns
   * ingen är det inget att nolla, och då släpper handtaget fram ETIKETTEN i
   * stället: handtaget sitter mitt på pilen, alltså precis där man dubbelklickar
   * för att skriva en etikett, och det svalde gesten utan att göra något.
   */
  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (free) d.onWaypointChange?.(source, target, null, edgeLabel);
    else d.onÖppnaEtikett?.();
  };

  /* ---- Etiketten dras längs kanten. Samma vakter som brytpunkten: bara
     vänsterknappen, bara vår EGEN dragning, och läget sparas som ANDEL av
     vägen så att det överlever att objekten flyttas. ---- */
  const etikettFlyttbar = Boolean(d.onLabelPosChange) && Boolean(label);
  const onLabelDown = (e: React.PointerEvent) => {
    if (!etikettFlyttbar || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    labelDrag.current = true;
  };
  const onLabelMove = (e: React.PointerEvent) => {
    if (!labelDrag.current) return;
    if (!(e.buttons & 1)) return;
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    labelAndel.current = andelAvPath(pts, p);
    setLabelDragAndel(labelAndel.current);
  };
  const onLabelUp = (e: React.PointerEvent) => {
    if (!labelDrag.current) return;
    labelDrag.current = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    const andel = labelAndel.current;
    labelAndel.current = null;
    setLabelDragAndel(null);
    if (andel !== null) d.onLabelPosChange?.(source, target, andel, edgeLabel);
  };
  const redigerar = Boolean(d.redigerar && d.onLabelTextChange);
  /**
   * Fyll fältet med kantens nuvarande etikett när redigeringen ÖPPNAS.
   *
   * I en effekt, inte under ritningen. Förut sattes texten mitt i renderingen
   * bakom en ref-spärr; i React:s dubbelrendering (StrictMode) slog spärren
   * igen på den kastade renderingen, och fältet öppnades TOMT – man såg aldrig
   * "Nej" när man skulle ändra den (2026-10-13, i båda verktygen).
   */
  useEffect(() => {
    if (!redigerar) return;
    etikettAvbruten.current = false;
    setEtikettText(edgeLabel ?? "");
    // Bara när fältet öppnas – inte när etiketten ändras medan man skriver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redigerar]);
  const sparaEtikett = () => {
    d.onStängEtikett?.();
    if (etikettAvbruten.current) {
      etikettAvbruten.current = false;
      return;
    }
    if (etikettText.trim() !== (edgeLabel ?? "")) {
      d.onLabelTextChange?.(source, target, edgeLabel, etikettText.trim());
    }
  };
  const hinder = d.etikettHinder?.(edgeLabel, etikettText) ?? null;

  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {/* Osynligt svep längs banan: bär hovertexten OCH tar dubbelklicket, så
          att även en OMÄRKT koppling går att sätta etikett på – man behöver inte
          en etikett för att kunna skapa en. pointer-events på STRECKET (inte
          ytan), annars lade banan beslag på klick i hela sin omslutande ruta. */}
      {(d.titel || d.onLabelTextChange) && (
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={16}
          style={{ pointerEvents: "stroke" }}
          className="ark-edge-hint"
        >
          {d.titel && <title>{d.titel}</title>}
        </path>
      )}
      {/* SIST, ovanpå hovertextens svep – annars tog det greppet. */}
      {sträckor.map(({ i, grepp: g }) => (
        <path
          key={g}
          d={`M${pts[i].x},${pts[i].y} L${pts[i + 1].x},${pts[i + 1].y}`}
          data-edge-grepp={`${source}->${target}:${g}`}
          className={`ark-edge-grepp ark-edge-grepp--${g.endsWith("x") ? "x" : "y"}`}
          fill="none"
          stroke="transparent"
          strokeWidth={16}
          pointerEvents="stroke"
          onPointerDown={onSträckDown(g)}
          onPointerMove={onSträckMove}
          onPointerUp={onSträckUp}
          onPointerCancel={onSträckUp}
          onDoubleClick={(e) => {
            // Dubbelklick på sista sträckan släpper den tillbaka framför porten.
            if (!g.startsWith("via2")) return;
            e.stopPropagation();
            d.onWaypoint2Change?.(source, target, null, edgeLabel);
          }}
        >
          <title>
            {g.startsWith("via2")
              ? "Dra för att flytta sträckan in i målet i sidled · dubbelklick återställer"
              : "Dra för att flytta sträckan"}
          </title>
        </path>
      ))}
      {(label || draggable || redigerar) && (
        <EdgeLabelRenderer>
          {guide?.y !== undefined && (
            <div
              className="ark-guide ark-edge-guide"
              style={{
                position: "absolute",
                transform: `translate(${(handle.x - 2500).toFixed(1)}px, ${guide.y.toFixed(1)}px)`,
                width: 5000,
                height: 1.5,
              }}
            />
          )}
          {guide?.x !== undefined && (
            <div
              className="ark-guide ark-edge-guide"
              style={{
                position: "absolute",
                transform: `translate(${guide.x.toFixed(1)}px, ${(handle.y - 2500).toFixed(1)}px)`,
                width: 1.5,
                height: 5000,
              }}
            />
          )}
          {redigerar && (
            <div
              className="ark-edge-label-edit"
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${etikettLäge.x}px, ${etikettLäge.y}px)`,
                pointerEvents: "all",
              }}
              // Klick i fältet får inte nå ritytan (den avmarkerar kanten).
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <input
                ref={etikettRef}
                autoFocus
                value={etikettText}
                placeholder="Etikett"
                onChange={(e) => setEtikettText(e.target.value)}
                onBlur={sparaEtikett}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!hinder) sparaEtikett();
                  }
                  if (e.key === "Escape") {
                    etikettAvbruten.current = true;
                    d.onStängEtikett?.();
                  }
                }}
              />
              {hinder && <span className="ark-edge-label-fel">{hinder}</span>}
            </div>
          )}
          {label && !redigerar && (
            <div
              style={{
                position: "absolute",
                // Bredvid strecket: förskjut från punkten i stället för att
                // centrera på den, så texten inte lägger sig över linjen.
                transform: `translate(${
                  bredvid?.sida === "höger" ? "0" : "-50%"
                }, ${bredvid?.sida === "ovanför" ? "-100%" : "-50%"}) translate(${etikettLäge.x}px, ${etikettLäge.y}px)`,
                // Etiketten måste kunna PEKAS PÅ för att hovertexten ska visas.
                // Utan titel är den genomsläpplig som förut, så ett klick når
                // ritytan under den.
                pointerEvents: etikettFlyttbar || d.titel ? "all" : "none",
                cursor: etikettFlyttbar ? "grab" : undefined,
                ...labelStyle,
              }}
              className={`ark-edge-label ${bredvid ? "ark-edge-label--bredvid" : ""} ${
                labelDragAndel !== null ? "dragging" : ""
              }`}
              title={etikettTitel(
                d.titel,
                d.onLabelTextChange
                  ? "Dubbelklick skriver etiketten · dra för att flytta den längs kopplingen"
                  : etikettFlyttbar
                    ? "Dra för att flytta etiketten längs kopplingen"
                    : undefined,
              )}
              onDoubleClick={(e) => {
                // Etiketten ligger i ett EGET DOM-lager utanför kantens SVG, så
                // React Flows `onEdgeDoubleClick` fångar den aldrig. Utan den
                // här handlaren hände ingenting när man dubbelklickade texten –
                // det mest naturliga stället att sikta på.
                if (!d.onLabelTextChange) return;
                e.stopPropagation();
                d.onÖppnaEtikett?.();
              }}
              onPointerDown={onLabelDown}
              onPointerMove={onLabelMove}
              onPointerUp={onLabelUp}
              onPointerCancel={onLabelUp}
            >
              {label}
            </div>
          )}
          {draggable && (
            <div
              data-edge={`${source}->${target}`}
              className={`ark-edge-waypoint ${free ? "set" : ""}`}
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${handle.x}px, ${handle.y}px)`,
                pointerEvents: "all",
              }}
              title={
                free
                  ? "Dra för att flytta banan · Shift linjerar mot andra kopplingar · dubbelklick återställer"
                  : "Dra för att styra banan · håll Shift för att linjera mot andra kopplingars linjer"
              }
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onDoubleClick={onDoubleClick}
            />
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}
