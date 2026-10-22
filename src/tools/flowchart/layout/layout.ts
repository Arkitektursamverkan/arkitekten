/**
 * Deterministisk layoutmotor (KRAV 6).
 *
 * Horisontellt flöde vänster→höger som standard. Swimlanes blir vågräta band
 * med automatisk höjd. Lane-rubriken ligger som en TOPPRAD i bandet så att hela
 * bredden kan användas till flödet. Nodens kolumn (x) bestäms av "longest-path".
 *
 * SIDFORMAT-LÄGE: när en sidbredd anges (A4 etc.) delas ett för brett flöde på
 * flera SIDOR, i full skala. Varje sida är ett komplett swimlane-diagram över
 * sin del av flödet.
 *
 * Två regler gör sidorna läsbara som ett dokument – bryts de ser det ut som om
 * banorna vore hopblandade, vilket var precis felet i den gamla "ormflödes"-
 * vikningen som staplade delband i EN bild:
 *   1. ALLA banor finns på ALLA sidor, i samma ordning och med samma höjd. En
 *      bana utan innehåll på en sida ritas tom – den hoppas aldrig över.
 *   2. Sidorna skiljs åt av en tydlig sidram och ett rejält mellanrum, inte av
 *      några pixlars luft.
 *
 * Manuellt dragna positioner gäller inte i flersidigt läge: sidindelningen
 * komponerar om allt, och en koordinat från det fria utlägget pekar då på en
 * helt annan plats.
 *
 * SKALA: alla mått (nod, text, mellanrum) multipliceras med `scale` så användaren kan
 * krympa/förstora hela diagrammet. Layout, editor och export delar samma skala.
 */

import type { DataStore, Pool, ProcessModel, ProcessNode } from "@/core/model";
import { wrap } from "../render/text-util";

/** Basmått vid skala 1.0. Medvetet nätta – "något mindre" som standard. */
export const BASE_DIMS = {
  colGap: 72, // horisontellt mellanrum mellan kolumner
  rowGap: 22, // vertikalt mellanrum mellan staplade noder i en lane
  laneHeaderH: 28, // höjd på lane-rubrikens topprad
  lanePadY: 22, // vertikal marginal inuti en lane (utöver rubriken)
  lanePadX: 32, // horisontell marginal före första kolumnen
  subRowGap: 34, // vertikalt mellanrum mellan ormflödets delrader
  nodeW: 132,
  nodeH: 54,
  decisionW: 112,
  decisionH: 78,
  eventD: 60, // diameter på event-cirklar (start/slut)
  poolLabelW: 26, // bredd på BPMN-poolens vänsteretikett
  dataW: 118, // datalager-artefaktens bredd
  dataH: 46, // datalager-artefaktens höjd
  blackBoxH: 54, // höjd på en svart-låda-pool (mottagare)
  poolGap: 18, // lodrätt mellanrum mellan pooler
  pageGap: 64, // mellanrum mellan två sidor i ett flersidigt utlägg
  minLaneH: 108,
  labelFont: 12, // bastextstorlek i noder (px)
  typeFont: 8.5, // typ-etikettens storlek (px)
} as const;

/** Bakåtkompatibelt alias. */
export const DIMS = BASE_DIMS;

/**
 * Tak för en manuell banhöjd. Höjden styr radantalet, och radantalet styr hur
 * många varv nodplaceringen gör – ett skenande värde hänger sidan. Speglas i
 * LaneNodeView, men motorn måste klara ett dåligt värde på egen hand: höjden
 * kan komma ur en sparad fil.
 */
export const MAX_LANE_HEIGHT = 4000;

/** Minsta marginal inuti en bana som dragits ihop för hand. */
const MIN_LANE_PAD = 6;

export type Dims = { -readonly [K in keyof typeof BASE_DIMS]: number };

/** Skalar alla basmått med `scale`. */
export function scaledDims(scale: number, spacing = 1): Dims {
  const out = {} as Dims;
  for (const k of Object.keys(BASE_DIMS) as (keyof typeof BASE_DIMS)[]) {
    out[k] = BASE_DIMS[k] * scale;
  }
  // Täthet: bara AVSTÅNDEN skalas – objektens mått rörs inte. Golv på 0.5 så
  // att kanterna alltid har plats att routas mellan objekten.
  const s = Math.min(1, Math.max(0.5, spacing));
  if (s !== 1) {
    out.colGap *= s;
    out.rowGap *= s;
    out.lanePadY *= s;
    out.lanePadX *= s;
  }
  return out;
}

/**
 * ---- Word-figurer -------------------------------------------------------
 *
 * Diagrammen ska klistras in som figurer i Word-rapporter. Word skalar alltid
 * bilden till textspaltens bredd, så diagrammets px-bredd säger ingenting om
 * hur stort det blir på pappret – bara hur mycket som TRYCKS IHOP på vägen dit.
 *
 * Det gör att skalreglaget inte påverkar läsbarheten i Word alls: skalas allt
 * upp lika mycket normaliserar Word bort det igen. Det enda som styr om texten
 * går att läsa är hur MÅNGA kolumner som ska samsas om spaltbredden.
 *
 * Därför räknas figurbredden ut baklänges, ur textstorleken vi kräver.
 */

/** Textspaltens bredd i en stående A4-rapport med normala marginaler. */
const WORD_SPALT_MM = 160;
/** Under ~7 pt går nodtexten inte att läsa i en utskriven rapport. */
const MIN_WORD_PT = 7;
const PT_I_MM = 0.3528;

/**
 * Hur bred (logiska px) får en figur vara för att nodtexten ska bli minst
 * MIN_WORD_PT när Word skalar den till spaltbredden?
 *   textstorlek i mm = labelFont × (WORD_SPALT_MM / figurbredd)
 */
export const WORD_FIGURE_WIDTH = Math.round(
  (BASE_DIMS.labelFont * WORD_SPALT_MM) / (MIN_WORD_PT * PT_I_MM),
);

/** Nodtextens storlek i punkter när en figur av bredden `width` hamnar i Word. */
export function wordPointSize(width: number): number {
  return (BASE_DIMS.labelFont * WORD_SPALT_MM) / width / PT_I_MM;
}

/**
 * Valbara sidformat. `width` = total diagrambredd i px (null = fri bredd).
 * `aspect` = höjd/bredd för pappersramen i editorn; null = figuren är exakt så
 * hög som innehållet kräver, vilket är vad en Word-figur ska vara.
 */
export const PAGE_FORMATS = {
  word: {
    id: "word",
    label: "Word-figur",
    width: WORD_FIGURE_WIDTH as number | null,
    aspect: null as number | null,
  },
  free: { id: "free", label: "Fri bredd", width: null as number | null, aspect: null as number | null },
  wide: { id: "wide", label: "Bred", width: 1600 as number | null, aspect: null as number | null },
  a4p: { id: "a4p", label: "A4 stående", width: 1000 as number | null, aspect: 1.4142 as number | null },
  a4l: { id: "a4l", label: "A4 liggande", width: 1414 as number | null, aspect: 0.7071 as number | null },
} as const;

export type PageFormatId = keyof typeof PAGE_FORMATS;

export interface LayoutOptions {
  /** Total sidbredd i px. null/undefined = fri bredd (en enda sida). */
  pageWidth?: number | null;
  /**
   * Sidhöjd i px. Anges bara för riktiga pappersformat, och används enbart till
   * att ge sidramen rätt proportioner – innehållet styr aldrig sidhöjden.
   */
  pageHeight?: number | null;
  /** Global storleksfaktor för alla objekt. Default 1. */
  scale?: number;
  /**
   * Krymp resultatet till innehållets bredd när det inte fyller sidan.
   * A4 ska behålla hela sidbredden (ramen ska stämma), men ett format utan
   * pappersram ska inte lämna en tredjedel av diagrammet tomt.
   */
  shrinkToContent?: boolean;
  /**
   * Täthet 0.5–1: skalar AVSTÅNDEN mellan objekt (kolumn- och radmellanrum,
   * banmarginaler) utan att röra objektens egna mått. 1 = normal, lägre =
   * tätare diagram som ryms på färre delar.
   */
  spacing?: number;
}

export interface LaidOutNode {
  node: ProcessNode;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Vilken sida noden hamnade på (0 i enkelsidigt läge). */
  page: number;
  /**
   * Förskjutningen från den FRIA layoutens koordinater. Editorn drar bort den
   * när användaren flyttar objektet, så att den sparade positionen alltid
   * uttrycks i fria koordinater oavsett vilket format man råkar titta i.
   */
  dx: number;
  dy: number;
}

export interface LaidOutLane {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Höjd på rubrikens topprad. */
  headerH: number;
  /** Vilken sida bandet ligger på (0 i enkelsidigt läge). */
  page: number;
}

/** BPMN-pool: ram runt alla lanes med en tunn vänsteretikett. */
export interface LaidOutPool {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bredd på vänsteretiketten (vertikal text). */
  labelW: number;
  title: string;
  /** Vilken sida poolramen hör till (0 i enkelsidigt läge). */
  page: number;
}

/**
 * Sidhänvisning: märket som ersätter en kant som korsar en sidbrytning.
 *
 * En pil från sida 1 till sida 3 blir annars ett streck tvärs genom hela
 * dokumentet, förbi allt som ligger emellan. Standarden i flödesscheman är en
 * hänvisning i var ände – "fortsätter på sida 3" respektive "från sida 1".
 */
export interface LaidOutPageRef {
  /** Noden märket hänger på. */
  nodeId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** Sidan märket ritas på. */
  page: number;
  /** Kanten märket hör till – behövs för att kunna dölja just det här märket. */
  edgeSource: string;
  edgeTarget: string;
  /** "in" = märket vid målet ("från del N"), "ut" = märket vid källan. */
  sida: "in" | "ut";
  /** Stubben: från punkten på noden … */
  fromX: number;
  fromY: number;
  /** … till punkten på märket. */
  toX: number;
  toY: number;
}

/**
 * Plats som reserveras i sidled för sidhänvisningarna, på var sida om flödet.
 *
 * Utan den fick ett märke i första kolumnen negativt x och vändes åt andra
 * hållet – ett INGÅENDE märke hamnade då till höger om sin nod, mitt på den
 * utgående kanten. Det såg ut som att delen kom in från fel håll, och märket
 * såg ut att höra till kopplingen det låg ovanpå.
 */
const REF_GUTTER = 70;
/** Måttet på ett hänvisningsmärke. Hålls nätt – det äter av flödets bredd. */
const REF_PAD = 12;
const REF_TECKEN = 5.2;
const REF_STUB = 6;
const REF_H = 17;

/** En sida i ett flersidigt utlägg. Ritas som pappersram runt sitt innehåll. */
export interface LaidOutPage {
  /** 1-baserat nummer, som det visas för läsaren. */
  number: number;
  /** Totalt antal delar – för "Del 2 av 3". */
  total: number;
  /** Färdig etikett: "Del 2 av 3" för figurer, "Sida 2 av 3" för pappersformat. */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Datalager ritas som artefakt vid sidan av flödet, aldrig i det. */
export interface LaidOutDataStore {
  store: DataStore;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Vilken sida artefakten hamnade på (0 i enkelsidigt läge). */
  page: number;
  /** Förskjutning från fria koordinater – se LaidOutNode. */
  dx: number;
  dy: number;
}

/** Svart-låda-pool: en annan deltagare vars inre inte modelleras. */
export interface LaidOutBlackBox {
  pool: Pool;
  x: number;
  y: number;
  w: number;
  h: number;
  labelW: number;
  /** Vilken sida bandet ligger på (0 i enkelsidigt läge). */
  page: number;
}

export interface LayoutResult {
  nodes: LaidOutNode[];
  lanes: LaidOutLane[];
  /** En poolram per sida. Tom lista när det inte finns några banor. */
  pools: LaidOutPool[];
  /** Sidorna i utlägget. Alltid minst en. */
  pages: LaidOutPage[];
  /** Sidhänvisningar för kanter som korsar en sidbrytning. Tom i enkelsidigt läge. */
  pageRefs: LaidOutPageRef[];
  /** Datalager-artefakter. */
  dataStores: LaidOutDataStore[];
  /** Mottagarpooler under processens pool. */
  blackBoxes: LaidOutBlackBox[];
  width: number;
  height: number;
  /** Sidbredd som användes (null i fri-läge) – för A4-ram i editorn. */
  pageWidth: number | null;
  /** Storleksfaktorn som användes – så export kan skala text lika. */
  scale: number;
  /**
   * Diagnostik från sidindelningen – underlag för regelgranskningen
   * (docs/sidbrytningsregler.md, page-rules.ts). Saknas i fri-läge.
   */
  pageDiag?: {
    /** Innehållsytans vänsterkant och bredd på varje del. */
    contentLeft: number;
    contentW: number;
    /** Snitt som flyttats TIDIGARE än packningen ville, för att hålla ihop en gateway-grupp (R3). */
    tidigaSnitt: number;
  };
  /**
   * Banor vars MANUELLA höjd är mindre än innehållet kräver. Layouten
   * respekterar valet till 100 % – det här är REKOMMENDATIONEN som UI:t visar
   * i stället för att tyst åsidosätta användaren.
   */
  laneVarningar?: LaneVarning[];
}

/** En bana vars manuella höjd underskrider innehållets behov. */
export interface LaneVarning {
  laneId: string;
  /** Den manuellt satta höjden (px). */
  höjd: number;
  /** Minsta höjd som rymmer innehållet (px). */
  rekommenderad: number;
  /** Delen varningen gäller (0-baserad) – saknas = alla delar / fri form. */
  del?: number;
}

/** Har lanen datalager som behöver en egen rad? */
function laneHasStores(model: ProcessModel, laneId: string): boolean {
  return model.dataStores.some((ds) => ds.laneId === laneId);
}

/**
 * Placerar datalagren under flödesraden i sin lane, lodrätt under den aktivitet
 * de hör ihop med. Görs efter att alla noder placerats, eftersom den kopplade
 * aktiviteten kan ligga i en annan lane som placeras senare.
 */
function placeDataStores(
  model: ProcessModel,
  laidNodes: LaidOutNode[],
  laneBottom: Map<string, number>,
  d: Dims,
  laidLanes: LaidOutLane[],
): LaidOutDataStore[] {
  /** Banans lodräta intervall – ett lager får aldrig ritas utanför sitt band. */
  const band = new Map(laidLanes.map((l) => [l.id, { topp: l.y + l.headerH, botten: l.y + l.h }]));
  const nodeById = new Map(laidNodes.map((n) => [n.node.id, n]));
  const out: LaidOutDataStore[] = [];
  const nästaX = new Map<string, number>();
  /** Upptagna x-intervall per lane, så två lager inte hamnar ovanpå varandra. */
  const upptaget = new Map<string, { från: number; till: number }[]>();

  /**
   * Cylinderns höjd växer med etiketten: lockbågen tar 2·ry upptill och
   * varje textrad behöver sin radhöjd. Med fast höjd tvingades långa
   * etiketter krympas till oläslighet eller strök ihop med lockets linje –
   * samma princip som affärsprocessens ikontypers etikettmått.
   */
  const skala = d.dataH / BASE_DIMS.dataH;
  const dsHöjd = (label: string) => {
    const rader = wrap(label, 16).length;
    return Math.max(d.dataH, (2 * 8 + rader * 15 + 6) * skala);
  };

  for (const ds of model.dataStores) {
    const dataH = dsHöjd(ds.label);
    // Hellre skrivaren än läsaren – lagret hör visuellt ihop med den som
    // skapar posten.
    // Placera lagret där det ligger i KRONOLOGIN, alltså vid noden det stod
    // direkt efter i kedjan. Ankras det på skrivaren hamnar det fel: skrivaren
    // kan vara en aktivitet långt tidigare, och loggposten som skapas sist
    // ritades då i början av diagrammet.
    const efter = ds.afterNodeId ? nodeById.get(ds.afterNodeId) : undefined;
    const läsare = model.dataAssociations.find(
      (a) => a.dataStoreId === ds.id && a.direction === "read",
    );
    const läsarBox = läsare ? nodeById.get(läsare.nodeId) : undefined;
    const anchor =
      efter && läsarBox
        ? {
            x: (efter.x + efter.w / 2 + läsarBox.x + läsarBox.w / 2) / 2 - d.dataW / 2,
            w: d.dataW,
          }
        : (efter ?? läsarBox);
    const fallback = nästaX.get(ds.laneId) ?? d.poolLabelW + d.lanePadX;
    let x = anchor ? anchor.x + anchor.w / 2 - d.dataW / 2 : fallback;

    // Två aktiviteter kan ligga på samma x i olika banor – då hamnar deras
    // lager ovanpå varandra och bara det sist ritade syns. Skjut åt höger tills
    // platsen är fri.
    const rader = upptaget.get(ds.laneId) ?? [];
    let krock = true;
    while (krock) {
      krock = rader.some((r) => x < r.till && r.från < x + d.dataW);
      if (krock) x += d.dataW + d.colGap / 2;
    }
    rader.push({ från: x, till: x + d.dataW });
    upptaget.set(ds.laneId, rader);

    nästaX.set(ds.laneId, x + d.dataW + d.colGap);
    const autoY = (laneBottom.get(ds.laneId) ?? 0) - d.lanePadY - dataH;
    // RIMLIGHETSVAKTEN gäller även datalager. Utan referenspunkten var den
    // avstängd här: en skenande sparad position (t.ex. från ett vilset drag)
    // ritade cylindern långt utanför sin del, tvärs över sidramarna, och drog
    // upp banhöjden på delar som såg tomma ut. Ligger positionen orimligt
    // långt från autoplatsen används autoplatsen i stället.
    const dsPos = giltigPosition(ds.position, { x, y: autoY });
    // Även en "rimlig" position klampas in i BANDET: ett lager i SharePoint
    // ska ligga i SharePoint-bandet, inte en bit ned i nästa del.
    const b = band.get(ds.laneId);
    const yRå = dsPos?.y ?? autoY;
    const y = b ? Math.min(Math.max(yRå, b.topp + 2), b.botten - dataH - 2) : yRå;
    out.push({
      store: ds,
      x: dsPos?.x ?? x,
      y,
      w: d.dataW,
      h: dataH,
      page: 0,
      dx: 0,
      dy: 0,
    });
  }
  return out;
}

/** Lägger mottagarpoolerna som egna band under processens pool. */
function placeBlackBoxes(
  model: ProcessModel,
  top: number,
  width: number,
  d: Dims,
  page = 0,
): LaidOutBlackBox[] {
  const out: LaidOutBlackBox[] = [];
  let y = top + d.poolGap;
  for (const p of model.pools.filter((p) => p.blackBox)) {
    out.push({ pool: p, x: 0, y, w: width, h: d.blackBoxH, labelW: d.poolLabelW, page });
    y += d.blackBoxH + d.poolGap;
  }
  return out;
}

/**
 * En manuell banhöjd tas aldrig för god. Den kommer från ett musdrag eller ur
 * en sparad fil, och den styr radantalet: ett NaN gick rakt igenom till
 * `new Array(radantal)`, som kastar RangeError och river hela React-trädet.
 * Returnerar 0 för "använd auto-höjden".
 */
function giltigLaneHöjd(height: number | undefined): number {
  if (!height || !Number.isFinite(height) || height <= 0) return 0;
  return Math.min(height, MAX_LANE_HEIGHT);
}

/**
 * Hur långt från sin auto-plats ett objekt får vara manuellt flyttat.
 *
 * En manuell position är en JUSTERING. Något som ligger 4 000 px från sin plats
 * är inte justerat utan trasigt – och eftersom banan alltid omsluter sina noder
 * drar ett sådant värde upp banhöjden, diagramhöjden och därmed kameran. Då ser
 * det ut som att alla objekt försvunnit, fast de bara hamnat utanför bild.
 */
const MAX_MANUAL_DRIFT = 2000;

/**
 * En sparad position används bara om den går att lita på.
 *
 * `auto` är platsen layouten själv hade valt. Ett NaN eller Infinity smittar
 * banhöjd, diagramhöjd och allt som räknas på dem; ett orimligt avstånd från
 * `auto` betyder att positionen sparats i en annan koordinatrymd än den vi
 * ritar i. Båda ska falla tillbaka på auto-placeringen i stället för att tas
 * för goda.
 */
function giltigPosition(
  p: { x: number; y: number } | null | undefined,
  auto?: { x: number; y: number },
) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return undefined;
  if (auto && (Math.abs(p.x - auto.x) > MAX_MANUAL_DRIFT || Math.abs(p.y - auto.y) > MAX_MANUAL_DRIFT)) {
    return undefined;
  }
  return p;
}

function nodeSize(n: ProcessNode, d: Dims): { w: number; h: number } {
  if (n.type === "decision") return { w: d.decisionW, h: d.decisionH };
  if (n.type === "start" || n.type === "end") return { w: d.eventD, h: d.eventD };
  return { w: d.nodeW, h: d.nodeH };
}

/**
 * Beräknar kolumn-rank för varje nod = längsta väg från en källnod.
 * Cykelsäker via relaxering (Bellman-Ford-liknande, DAG-vänlig).
 */
export function computeRanks(model: ProcessModel): Map<string, number> {
  const rank = new Map<string, number>();
  for (const n of model.nodes) rank.set(n.id, 0);
  const N = model.nodes.length;

  /** Relaxering framåt längs kanterna. Höjer bara – aldrig sänker. */
  const relaxera = () => {
    for (let iter = 0; iter < N; iter++) {
      let changed = false;
      for (const e of model.edges) {
        const rs = rank.get(e.source);
        const rt = rank.get(e.target);
        if (rs === undefined || rt === undefined) continue;
        if (rt < rs + 1) {
          rank.set(e.target, rs + 1);
          changed = true;
        }
      }
      if (!changed) break;
    }
  };

  relaxera();

  // ---- Avklippta noder behåller sin plats i kronologin.
  //
  // En nod utan inkommande kant får rank 0 – alltså FÖRSTA kolumnen. För en
  // startnod är det rätt. För en nod vars koppling tagits bort är det fel: den
  // teleporterade från slutet av flödet till början, och i ett flersidigt
  // utlägg såg det ut som att den försvunnit. Noderna ligger i stegens ordning,
  // så föregående nod är en ärlig ankarpunkt.
  //
  // UNDANTAG: en HELT lös nod (varken in- eller utgående kant) tillhör ingen
  // kedja alls. Den ärver ändå kronologin så länge föregående nod ligger i
  // SAMMA bana – då är de uppenbart en rad – men vid ett BANBYTE börjar
  // räkningen om. Utan undantaget blev en ren översiktsbild (objekt utan
  // kopplingar, ett per process) en trappa lika bred som antalet objekt, och
  // gick inte att få in på en sida. Kravet på cut-noden ovan är oförändrat:
  // en nod vars INKOMMANDE koppling tagits bort har fortfarande sin utgång
  // kvar och behåller därför sin plats i kronologin.
  const inGrad = new Map<string, number>();
  const utGrad = new Map<string, number>();
  for (const n of model.nodes) {
    inGrad.set(n.id, 0);
    utGrad.set(n.id, 0);
  }
  for (const e of model.edges) {
    inGrad.set(e.target, (inGrad.get(e.target) ?? 0) + 1);
    utGrad.set(e.source, (utGrad.get(e.source) ?? 0) + 1);
  }

  let flyttad = false;
  for (let i = 1; i < model.nodes.length; i++) {
    const n = model.nodes[i];
    if (n.type === "start" || (inGrad.get(n.id) ?? 0) > 0) continue;
    const föregående = model.nodes[i - 1];
    const heltLös = (utGrad.get(n.id) ?? 0) === 0;
    if (heltLös && föregående.laneId !== n.laneId) continue;
    const efter = (rank.get(föregående.id) ?? 0) + 1;
    if ((rank.get(n.id) ?? 0) < efter) {
      rank.set(n.id, efter);
      flyttad = true;
    }
  }
  // Flyttades någon måste dess efterföljare med.
  if (flyttad) relaxera();

  // ---- Skicka→motta-par delar KOLUMN.
  //
  // Ett mottagningssteg ("Ny handläggare får e-post …") fick annars kolumnen
  // EFTER sitt utskick och hamnade snett upp/ner-till-höger. Pilen mellan dem
  // blev då en trappa – ut åt höger, sedan lodrätt – fast den ska vara ett
  // RAKT lodrätt streck mellan banorna. Med samma kolumn ligger mottagningen
  // exakt ovanför/under utskicket och pilen pekar rakt ner (eller upp).
  const källorTill = new Map<string, string[]>();
  for (const e of model.edges) {
    (källorTill.get(e.target) ?? källorTill.set(e.target, []).get(e.target)!).push(e.source);
  }
  const nodById = new Map(model.nodes.map((n) => [n.id, n]));
  for (const n of model.nodes) {
    if (n.type !== "notification" || n.messageDirection !== "receive") continue;
    const unika = [...new Set(källorTill.get(n.id) ?? [])];
    if (unika.length !== 1) continue; // flera inflöden – låt kolumnordningen stå
    const sändare = nodById.get(unika[0]);
    if (!sändare || sändare.laneId === n.laneId) continue; // samma bana = rad, inte kolumn
    rank.set(n.id, rank.get(sändare.id) ?? 0);
  }

  // ---- Packa om till löpande kolumnnummer. Utan detta lämnade justeringen
  // ovan tomma kolumner efter sig, och varje tom kolumn är en nodbredd luft.
  const använda = [...new Set([...rank.values()])].sort((a, b) => a - b);
  const om = new Map(använda.map((r, i) => [r, i]));
  for (const [id, r] of rank) rank.set(id, om.get(r)!);

  return rank;
}

/** En kolumn (rank-grupp) inom en lane: staplade noder som hör ihop. */


/** Placerar en grupps staplade noder centrerat kring (gx, rowTop..rowTop+rowH). */






/**
 * Placerar en kolumngrupp. Varje nod hamnar på sin egen gren-rad (laneRow) så
 * att Ja/Nej-grenar ligger under varandra i stället för i rad. Noder som delar
 * både kolumn och rad staplas som förut.
 */
/**
 * Antal rader en lane ska rada upp sina objekt på utifrån MANUELL höjd.
 * 0 = ingen manuell höjd = AUTO (radantalet styrs då av parallell-djupet, så
 * parallella steg staplas lodrätt och sidbredden respekteras).
 */
function rowsForHeight(height: number | undefined, d: Dims, storeH: number): number {
  const h = giltigLaneHöjd(height);
  if (!h) return 0; // auto
  const content = h - d.laneHeaderH - 2 * d.lanePadY - storeH;
  return Math.max(1, Math.floor((content + d.rowGap) / (d.nodeH + d.rowGap)));
}

/**
 * Radar upp en lanes noder i banan.
 *
 * Varje nod placeras helst på sin FLÖDESPOSITION (kolumn = colX[rank]) så att
 * objekt i olika banor linjerar lodrätt. Parallella steg (samma rank) staplas
 * lodrätt i samma kolumn – annars trycks de ut i sidled och spränger sidbredden.
 *
 * `rowCount` = 0 → AUTO: exakt så många rader som parallell-djupet kräver (varje
 * kolumn en egen rad per parallell gren). Sätter användaren en manuell höjd styr den
 * radantalet i stället: FÄRRE rader (lägre bana) → parallella steg sprids i
 * sidled (bredare); FLER rader → de staplas på höjden.
 */
function placeLaneNodes(
  laneNodes: ProcessNode[],
  rank: Map<string, number>,
  colX: number[],
  contentTop: number,
  rowCount: number,
  d: Dims,
  out: LaidOutNode[],
): number {
  const sorterad = [...laneNodes].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const rowY = (r: number) => contentTop + r * (d.nodeH + d.rowGap);

  // Parallell-djup = största antal noder på samma rank. Auto-radantalet.
  const perRank = new Map<number, number>();
  for (const n of sorterad) {
    const r = rank.get(n.id) ?? 0;
    perRank.set(r, (perRank.get(r) ?? 0) + 1);
  }
  const parRader = Math.max(1, ...perRank.values());
  // Fler rader än det finns noder är alltid slöseri: de blir tomma, men varje
  // nod prövar VARJE rad för att hitta sin plats. Taket gör kostnaden linjär i
  // antalet noder i stället för i banans höjd.
  const rader = Math.min(Math.max(1, sorterad.length), Math.max(1, rowCount || parRader));

  const rowRight = new Array(rader).fill(-Infinity);
  // En bana utan noder använder NOLL nodrader. Returnerades 1 reserverade
  // banan plats för en aktivitet den inte har – en bana med bara datalager
  // (t.ex. SharePoint) blev därför 56 px högre än den behövde och gick inte
  // att dra ihop lika långt som de andra.
  let used = laneNodes.length ? 1 : 0;
  for (const n of sorterad) {
    const { w, h } = nodeSize(n, d);
    const önskadX = colX[rank.get(n.id) ?? 0] ?? colX[0];
    // Välj rad: den som ger minsta x, helst == önskadX (då hamnar parallella
    // steg lodrätt i samma kolumn i stället för att knuffas åt höger).
    let rad = 0;
    let bäst = Infinity;
    for (let r = 0; r < rader; r++) {
      const x = Math.max(önskadX, rowRight[r] + d.colGap);
      const kostnad = (x > önskadX + 0.5 ? 1e9 : 0) + x + r * 0.001;
      if (kostnad < bäst) {
        bäst = kostnad;
        rad = r;
      }
    }
    const x = Math.max(önskadX, rowRight[rad] + d.colGap);
    rowRight[rad] = x + w;
    used = Math.max(used, rad + 1);
    const auto = { x, y: rowY(rad) + (d.nodeH - h) / 2 };
    const pos = giltigPosition(n.position, auto);
    out.push({
      node: n,
      x: pos?.x ?? auto.x,
      y: pos?.y ?? auto.y,
      w,
      h,
      page: 0, // sätts av sidindelningen
      dx: 0,
      dy: 0,
    });
  }
  return used;
}



/**
 * Innehållshöjd (under banhuvudet) som krävs för att omsluta de noder som just
 * lagts i `out` från index `från`. Räknar nodernas FAKTISKA underkant, så en
 * manuellt nedåtdragen nod aldrig hamnar utanför banan. `storeH` reserverar
 * plats för artefaktraden under noderna.
 */
function laneNodeExtent(
  out: LaidOutNode[],
  från: number,
  laneTop: number,
  d: Dims,
  padY: number,
  storeH: number,
): number {
  let maxBottom = -Infinity;
  for (let i = från; i < out.length; i++) maxBottom = Math.max(maxBottom, out[i].y + out[i].h);
  if (maxBottom === -Infinity) return d.laneHeaderH;
  return maxBottom - (laneTop + d.laneHeaderH) + padY + storeH;
}

/**
 * Kolumnernas bredd och x-läge, en kolumn per rank. Delas av den fria layouten
 * och av sidindelningen – snittet mellan två delar måste gå exakt där en kolumn
 * slutar, annars klyvs en nod på mitten.
 */
export function columnGeometry(model: ProcessModel, rank: Map<string, number>, d: Dims) {
  const maxRank = Math.max(0, ...[...rank.values()]);
  const colWidth: number[] = new Array(maxRank + 1).fill(d.nodeW);
  for (const n of model.nodes) {
    const r = rank.get(n.id) ?? 0;
    colWidth[r] = Math.max(colWidth[r], nodeSize(n, d).w);
  }
  const colX: number[] = [];
  let cx = d.poolLabelW + d.lanePadX;
  for (let r = 0; r <= maxRank; r++) {
    colX[r] = cx;
    cx += colWidth[r] + d.colGap;
  }
  return { colWidth, colX, maxRank, slut: cx - d.colGap };
}

/** Fri layout (standard): ett långt horisontellt band per lane, allt på en sida. */
function layoutFree(model: ProcessModel, rank: Map<string, number>, d: Dims, scale: number): LayoutResult {
  const { colX, slut } = columnGeometry(model, rank, d);
  let totalWidth = slut + d.lanePadX;
  // Ett manuellt draget objekt kan ligga längre åt höger än sista kolumnen.
  // Räknas det inte in hamnar det utanför både sin bana och sidan.
  for (const n of model.nodes) {
    const p = giltigPosition(n.position);
    if (p) totalWidth = Math.max(totalWidth, p.x + nodeSize(n, d).w + d.lanePadX);
  }
  for (const ds of model.dataStores) {
    const p = giltigPosition(ds.position);
    if (p) totalWidth = Math.max(totalWidth, p.x + d.dataW + d.lanePadX);
  }

  const lanes = orderedLanes(model);
  const laidNodes: LaidOutNode[] = [];
  const laidLanes: LaidOutLane[] = [];
  const laneBottom = new Map<string, number>();
  const laneVarningar: LaneVarning[] = [];
  let laneTop = 0;

  for (const lane of lanes) {
    const laneNodes = model.nodes.filter((n) => n.laneId === lane.id);
    const storeH = laneHasStores(model, lane.id) ? d.dataH + d.rowGap : 0;
    // En MANUELL höjd får krympa marginalen. Utan det stoppade minimihöjden
    // (banhuvud + full marginal + en nodrad) dig vid 138 px, oavsett hur
    // hårt du drog – det såg ut som att banan inte gick att minska.
    const manuell = giltigLaneHöjd(lane.height);
    const rowCount = rowsForHeight(lane.height, d, storeH);
    const rader = laneNodes.length ? Math.max(1, rowCount || 1) : 0;
    const nodrader = rader ? rader * d.nodeH + (rader - 1) * d.rowGap : 0;
    const padY = manuell
      ? Math.max(MIN_LANE_PAD, Math.min(d.lanePadY, (manuell - d.laneHeaderH - nodrader - storeH) / 2))
      : d.lanePadY;
    const contentTop = laneTop + d.laneHeaderH + padY;
    const före = laidNodes.length;
    const used = placeLaneNodes(laneNodes, rank, colX, contentTop, rowCount, d, laidNodes);
    // Banan måste alltid omsluta sina noder – även manuellt dragna (sparad
    // position). Annars hänger en nedåtdragen nod utanför banan när banan krymper.
    const nodeH = laneNodeExtent(laidNodes, före, laneTop, d, padY, storeH);
    const innehåll = (used ? used * d.nodeH + (used - 1) * d.rowGap : 0) + 2 * padY + storeH;
    const autoH = Math.max(d.minLaneH - d.laneHeaderH, innehåll, nodeH);
    // ANVÄNDAREN ÄGER BANHÖJDEN. En manuellt satt höjd gäller till 100 % –
    // även när den är mindre än innehållet (objekten sticker då ut över
    // grannbandet, och layouten RAPPORTERAR en rekommenderad minsta höjd i
    // laneVarningar i stället för att tyst åsidosätta valet).
    // Taket gäller den automatiska höjden: utan det kunde en enda nod med en
    // position långt ned dra upp banan tills allt annat hamnade utanför bild.
    if (manuell && manuell - d.laneHeaderH < Math.max(innehåll, nodeH)) {
      laneVarningar.push({
        laneId: lane.id,
        höjd: manuell,
        rekommenderad: Math.ceil(Math.max(innehåll, nodeH) + d.laneHeaderH),
      });
    }
    const contentH = Math.min(
      MAX_LANE_HEIGHT,
      manuell ? Math.max(8, manuell - d.laneHeaderH) : autoH,
    );
    const laneH = d.laneHeaderH + contentH;

    laidLanes.push({
      id: lane.id,
      title: lane.title,
      x: d.poolLabelW,
      y: laneTop,
      w: totalWidth - d.poolLabelW,
      h: laneH,
      headerH: d.laneHeaderH,
      page: 0,
    });
    laneTop += laneH;
    laneBottom.set(lane.id, laneTop);
  }

  const pool = makePool(model, d, totalWidth, laneTop, 0);
  const dataStores = placeDataStores(model, laidNodes, laneBottom, d, laidLanes);
  const blackBoxes = placeBlackBoxes(model, laneTop, totalWidth, d);
  const höjd = blackBoxes.length ? blackBoxes[blackBoxes.length - 1].y + d.blackBoxH : laneTop;
  return {
    nodes: laidNodes,
    lanes: laidLanes,
    pools: pool ? [pool] : [],
    pages: [{ number: 1, total: 1, label: "", x: 0, y: 0, w: totalWidth, h: höjd }],
    pageRefs: [],
    dataStores,
    blackBoxes,
    width: totalWidth,
    height: höjd,
    pageWidth: null,
    scale,
    laneVarningar,
  };
}

/**
 * Delar kolumnerna i delar som var för sig ryms på sidbredden. Snittet går
 * alltid MELLAN två kolumner, aldrig genom en, så ingen nod klyvs.
 * Returnerar varje dels intervall i den fria layoutens x-rymd.
 *
 * REGLERNA (docs/sidbrytningsregler.md):
 *  R2 – packa girigt: en del avslutas först när nästa kolumn inte ryms.
 *  R3 – men ett snitt får inte gå mellan en gateway och det första steget i
 *       någon av dess grenar, om gruppen ryms på en egen del. Då flyttas
 *       snittet bakåt till närmast tillåtna gräns (`tidigaSnitt` räknar dem –
 *       det är packningsförluster som R3 motiverar).
 */
function planeraSidor(
  colWidth: number[],
  colX: number[],
  contentW: number,
  model: ProcessModel,
  rank: Map<string, number>,
  d: Dims,
): { delar: { från: number; till: number }[]; tidigaSnitt: number } {
  // Förbjudna snittgränser (R3): gränsen mellan en gateway och dess NÄRMASTE
  // grenhuvud (grenmål i kolumnen direkt intill). Nej-vägen och senare grenar
  // får korsa ett snitt – det är naturlig läsning med märkt hänvisning – men
  // gatewayn och grenen som ritas intill den hör ihop. (Hela gren-kedjor går
  // inte att hålla ihop: kedjade beslut ger överlappande grupper som aldrig
  // ryms samtidigt på en smal sida.)
  const förbjuden = new Set<number>();
  for (const n of model.nodes) {
    if (n.type !== "decision") continue;
    const rD = rank.get(n.id);
    if (rD === undefined) continue;
    const harNäraGren = model.edges.some(
      (e) => e.source === n.id && rank.get(e.target) === rD + 1,
    );
    if (!harNäraGren) continue;
    const bredd = colX[rD + 1] + colWidth[rD + 1] - colX[rD];
    if (bredd > contentW) continue; // ryms inte ens ensamma – delning oundviklig
    förbjuden.add(rD + 1);
  }

  const delar: { från: number; till: number }[] = [];
  let start = 0;
  let tidigaSnitt = 0;
  for (let r = 0; r < colWidth.length; r++) {
    const slut = colX[r] + colWidth[r];
    if (r > start && slut - colX[start] > contentW) {
      // Snitt behövs före kolumn r. Är gränsen förbjuden: backa till närmast
      // tillåtna. Finns ingen (hela delen inuti en grupp) skärs ändå vid r.
      let b = r;
      while (b > start + 1 && förbjuden.has(b)) b--;
      if (förbjuden.has(b)) b = r; // ingen tillåten gräns – nödfall
      if (b < r) tidigaSnitt++;
      delar.push({ från: colX[start], till: colX[b] - d.colGap / 2 });
      start = b;
      r = b; // fortsätt packningen från det faktiska snittet
    }
  }
  delar.push({ från: colX[start] ?? 0, till: Infinity });
  return { delar, tidigaSnitt };
}

/**
 * Bygger sidhänvisningarna för de kanter som korsar ett snitt.
 *
 * Tre regler, alla inlärda av att bryta mot dem:
 *
 *  1. INGÅENDE märke till vänster, UTGÅENDE till höger. Alltid. Vänds ett
 *     ingående märke åt höger för att få plats ser delen ut att komma in
 *     bakifrån. Plats garanteras av REF_GUTTER i stället.
 *  2. Sitter det redan en kant på den sidan – alltså har noden en granne på
 *     samma del – läggs märket OVANFÖR noden. Annars hamnar det mitt på
 *     kopplingen mellan två sammankopplade noder och ser ut att höra till den.
 *  3. Texten säger riktningen i ord ("från del 3" / "till del 5"). Två pilar
 *     som bara skiljer sig i placering går inte att läsa.
 */
/**
 * Var formens UNDRE kontur ligger, som andel av höjden, vid en given andel av
 * bredden. En ruta har sin underkant längst ner hela vägen; en romb och en
 * cirkel har det bara på mitten.
 */
function konturUnder(typ: string, andel: number): number {
  const frånMitt = Math.abs(andel - 0.5);
  if (typ === "decision") return 1 - frånMitt;
  if (typ === "start" || typ === "end") return 0.5 + Math.sqrt(Math.max(0, 0.25 - frånMitt * frånMitt));
  return 1;
}

/**
 * Stubbens VÄG, från noden till märket. Ligger märket inte i linje med
 * fästpunkten går vägen i räta vinklar – aldrig på snedden, och aldrig som
 * ett löst streck. EN regel, en plats: skärmen
 * (`PageRefView`) och exporten (`svg.ts`) ritar båda den här vägen.
 */
export function hänvisningsStubbe(
  r: Pick<LaidOutPageRef, "fromX" | "fromY" | "toX" | "toY">,
): { x: number; y: number }[] {
  const från = { x: r.fromX, y: r.fromY };
  const till = { x: r.toX, y: r.toY };
  if (Math.abs(r.fromX - r.toX) <= 0.5 || Math.abs(r.fromY - r.toY) <= 0.5) return [från, till];
  // Märket snett NEDANFÖR: rakt ner ur konturen, sedan in i märket.
  if (r.toY > r.fromY) return [från, { x: r.fromX, y: r.toY }, till];
  // Märket har knuffats UPPÅT av ett annat märke på samma sida (R5): ut ur
  // nodens sida, upp i springan och in – ett trappsteg i stället för en sned.
  const mitt = (r.fromX + r.toX) / 2;
  return [från, { x: mitt, y: r.fromY }, { x: mitt, y: r.toY }, till];
}

function byggSidhänvisningar(
  model: ProcessModel,
  laidNodes: LaidOutNode[],
  laidStores: LaidOutDataStore[],
  d: Dims,
): LaidOutPageRef[] {
  const skala = d.nodeH / BASE_DIMS.nodeH;
  // Datalagren räknas med. En association kan spänna över lika många snitt som
  // en sekvenskant – "Loggpost skapas" skrivs på del 3 men ritas på del 5 – och
  // utan hänvisning står artefakten kvar utan någon synlig koppling alls.
  const nod = new Map<
    string,
    { x: number; y: number; w: number; h: number; page: number; laneId: string; typ: string }
  >();
  for (const n of laidNodes) {
    nod.set(n.node.id, { x: n.x, y: n.y, w: n.w, h: n.h, page: n.page, laneId: n.node.laneId, typ: n.node.type });
  }
  for (const ds of laidStores) {
    nod.set(ds.store.id, { x: ds.x, y: ds.y, w: ds.w, h: ds.h, page: ds.page, laneId: ds.store.laneId, typ: "datastore" });
  }

  /** Alla riktade kopplingar som kan behöva en hänvisning. */
  const kopplingar = [
    ...model.edges.map((e) => ({
      source: e.source,
      target: e.target,
      label: e.label,
      hideIn: e.hideRefIn,
      hideUt: e.hideRefOut,
    })),
    ...model.dataAssociations.map((a) => ({
      source: a.direction === "write" ? a.nodeId : a.dataStoreId,
      target: a.direction === "write" ? a.dataStoreId : a.nodeId,
      label: undefined as string | undefined,
      hideIn: a.hideRefIn,
      hideUt: a.hideRefOut,
    })),
  ];

  /** Har objektet en granne på SAMMA del åt det hållet? */
  const grannePåSidan = (id: string, åtHöger: boolean): boolean => {
    const mig = nod.get(id);
    if (!mig) return false;
    return kopplingar.some((k) => {
      const annan = k.source === id ? nod.get(k.target) : k.target === id ? nod.get(k.source) : undefined;
      if (!annan || annan.page !== mig.page) return false;
      return åtHöger ? annan.x > mig.x : annan.x < mig.x;
    });
  };

  const märke = (
    id: string,
    text: string,
    åtHöger: boolean,
    kant: { source: string; target: string },
  ): LaidOutPageRef | null => {
    const n = nod.get(id);
    if (!n) return null;
    const kantfält = { edgeSource: kant.source, edgeTarget: kant.target, sida: åtHöger ? ("ut" as const) : ("in" as const) };
    const nodeId = id;
    void nodeId;
    const w = (REF_PAD + text.length * REF_TECKEN) * skala;
    const h = REF_H * skala;
    const stub = REF_STUB * skala;

    if (!grannePåSidan(id, åtHöger)) {
      const x = åtHöger ? n.x + n.w + stub : n.x - stub - w;
      const y = n.y + n.h / 2 - h / 2;
      return {
        nodeId: id,
        ...kantfält,
        x,
        y,
        w,
        h,
        text,
        page: n.page,
        fromX: åtHöger ? n.x + n.w : n.x,
        fromY: n.y + n.h / 2,
        toX: åtHöger ? x : x + w,
        toY: y + h / 2,
      };
    }

    // Sidan är upptagen av flödet (t.ex. Ja-pilen ur en gateway). Märket ska
    // ÄNDÅ sitta på UTGÅNGSSIDAN – flödet fortsätter ju åt det hållet – men
    // förskjutet nedåt, som en andra utgång under den ordinarie. Den gamla
    // "ovanför noden"-placeringen läste åt fel håll: ett "Nej · till del 5"
    // hamnade uppe till vänster fast Nej-vägen fortsätter åt höger, och för en
    // nod vid delens kant gled märket ut i marginalen.
    const x = åtHöger ? n.x + n.w + stub : n.x - stub - w;
    // Strax UNDER nodens underkant: mitthöjden är upptagen av den ordinarie
    // pilen och dess etikett (Ja), och de får inte täcka varandra.
    const y = n.y + n.h + 3;
    return {
      nodeId: id,
      ...kantfält,
      x,
      y,
      w,
      h,
      text,
      page: n.page,
      // Stubben börjar PÅ FORMENS KONTUR. Rutans underkant duger bara för en
      // ruta: under en romb eller en cirkel är hörnen av rutan tom luft, och
      // strecket hängde löst bredvid symbolen – en koppling som inte mynnade
      // ut i någonting (2026-10-02).
      fromX: åtHöger ? n.x + n.w * 0.75 : n.x + n.w * 0.25,
      fromY: n.y + n.h * konturUnder(n.typ, åtHöger ? 0.75 : 0.25),
      toX: åtHöger ? x : x + w,
      toY: y + h / 2,
    };
  };

  const ut: LaidOutPageRef[] = [];
  for (const k of kopplingar) {
    const a = nod.get(k.source);
    const b = nod.get(k.target);
    if (!a || !b || a.page === b.page) continue;
    const kant = { source: k.source, target: k.target };
    // Kantens etikett ("Ja"/"Nej") MÅSTE följa med i märket. Korsar en
    // beslutsgren ett snitt är hänvisningen det enda stället grenvalet syns –
    // utan etiketten försvann Ja/Nej helt ur ett flersidigt utlägg.
    const källa = k.hideUt
      ? null
      : märke(k.source, k.label ? `${k.label} · till del ${b.page + 1}` : `till del ${b.page + 1}`, true, kant);
    const mål = k.hideIn
      ? null
      : märke(k.target, k.label ? `${k.label} · från del ${a.page + 1}` : `från del ${a.page + 1}`, false, kant);
    if (källa) ut.push(källa);
    if (mål) ut.push(mål);
  }

  // ---- REGEL R5: märkena är skarvens enda ledtråd och måste gå att läsa.
  // Två märken på samma nod (t.ex. Ja + Nej från samma gateway) landade förr
  // exakt ovanpå varandra. Kolliderande märken skjuts uppåt tills de går fria
  // från både varandra och noderna; linjens fästpunkt följer med.
  const överlappar = (p: LaidOutPageRef, q: { x: number; y: number; w: number; h: number }) =>
    p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y;
  const placerade: LaidOutPageRef[] = [];
  const noderPerSida = [...nod.values()];
  for (const ref of ut) {
    let steg = 0;
    while (
      steg < 12 &&
      (placerade.some((p) => p.page === ref.page && överlappar(ref, p)) ||
        noderPerSida.some((n) => n.page === ref.page && överlappar(ref, n)))
    ) {
      ref.y -= ref.h + 4;
      steg++;
    }
    // Vertikal linje (märke ovanför nod): linjen slutar vid märkets underkant.
    // Sidledslinje: fästet följer märkets nya mitt.
    if (ref.fromX === ref.toX) ref.toY = ref.y + ref.h;
    else ref.toY = ref.y + ref.h / 2;
    placerade.push(ref);
  }
  return ut;
}

/**
 * Flersidig layout = ett SNITT i den fria layouten, inte en egen layout.
 *
 * Det här är kärnan. Räknade sidindelningen ut sina egna positioner blev den
 * fria vyn och delarna två skilda koordinatrymder: allt användaren drog i den ena
 * pekade fel i den andra, och positioner sparade i ett delat läge förstörde
 * den fria vyn när man bytte tillbaka. Nu placeras allt EN gång, i den fria
 * layouten – delarna flyttar bara på det som redan ligger rätt.
 *
 * Varje objekt bär med sig sin förskjutning (`dx`/`dy`) så att editorn kan
 * räkna tillbaka till fria koordinater när användaren drar något i ett delat läge.
 */
function layoutPaged(
  fri: LayoutResult,
  model: ProcessModel,
  rank: Map<string, number>,
  pageWidth: number,
  pageHeight: number | null,
  d: Dims,
  scale: number,
): LayoutResult {
  // Plats reserveras på båda sidor om flödet för sidhänvisningarna, så att ett
  // ingående märke aldrig behöver vändas åt fel håll för att få plats.
  const gutter = REF_GUTTER * (d.nodeH / BASE_DIMS.nodeH);
  const contentLeft = d.poolLabelW + d.lanePadX + gutter;
  const contentW = Math.max(d.nodeW, pageWidth - d.lanePadX - gutter - contentLeft);
  // Ett pappersformat ger SIDOR; en figur utan pappersram ger DELAR som var
  // och en klistras in som en egen bild i rapporten.
  const ord = pageHeight != null ? "Sida" : "Del";

  const { colWidth, colX } = columnGeometry(model, rank, d);
  const { delar, tidigaSnitt } = planeraSidor(colWidth, colX, contentW, model, rank, d);

  /** Vilken del ligger en KOLUMN i? */
  const delFörKolumn = (col: number): number => {
    const x = colX[col] ?? colX[0] ?? 0;
    for (let i = delar.length - 1; i >= 0; i--) if (x >= delar[i].från) return i;
    return 0;
  };
  /** Reserv för objekt utan kolumn: mittpunkten i den fria layouten. */
  const delFör = (x: number, w: number): number => {
    const mitt = x + w / 2;
    for (let i = delar.length - 1; i >= 0; i--) if (mitt >= delar[i].från) return i;
    return 0;
  };

  /**
   * REGEL R4 (docs/sidbrytningsregler.md): deltillhörighet avgörs av FLÖDES-
   * ORDNINGEN (kolumnen), aldrig av var objektet råkar ha dragits. Tidigare
   * styrde mittpunkten – ett manuellt flyttat objekt kunde då teleportera till
   * en annan del, slita en gren från sin gateway och ge bakåthänvisningar
   * ("till del 2" från del 3). Flödet blev omöjligt att följa.
   */
  const nodDel = new Map(fri.nodes.map((n) => [n.node.id, delFörKolumn(rank.get(n.node.id) ?? 0)]));
  // Manuellt pinnade noder (dragna till en annan bild) går dit användaren
  // valde. Hänvisningar och kopplingar följer med automatiskt – de härleds ur
  // deltillhörigheten längre ned.
  for (const n of fri.nodes) {
    if (n.node.pagePin !== undefined) {
      nodDel.set(n.node.id, Math.min(Math.max(0, n.node.pagePin), delar.length - 1));
    }
  }
  // Ett datalager följer sin ankaraktivitet; utan ankare gäller mittpunkten.
  const storeDel = new Map(
    fri.dataStores.map((ds) => {
      const ankare = ds.store.afterNodeId ? nodDel.get(ds.store.afterNodeId) : undefined;
      return [ds.store.id, ankare ?? delFör(ds.x, ds.w)];
    }),
  );

  // REGEL R1: en del utan innehåll ritas inte. Delarna planeras ur kolumn-
  // geometrin, FÖRE pinnarna – pinnar användaren bort det enda som låg på
  // sista delen blev den kvar som en tom ruta med bara bantitlar ("Del 3 av 3"
  // utan ett enda objekt). Delen tas bort här, efter att pinnarna räknats in,
  // och de kvarvarande numreras om så hänvisningarna pekar rätt.
  {
    const använda = new Set([...nodDel.values(), ...storeDel.values()]);
    if (använda.size < delar.length) {
      const behållna = delar.map((_, i) => i).filter((i) => använda.has(i));
      // Allt tomt (modell utan objekt): behåll en del så figuren finns kvar.
      if (!behållna.length) behållna.push(0);
      const omnumrering = new Map(behållna.map((gammal, ny) => [gammal, ny]));
      for (const [id, del] of nodDel) nodDel.set(id, omnumrering.get(del) ?? 0);
      for (const [id, del] of storeDel) storeDel.set(id, omnumrering.get(del) ?? 0);
      const kvar = behållna.map((i) => delar[i]);
      delar.length = 0;
      delar.push(...kvar);
    }
  }

  const laidNodes: LaidOutNode[] = [];
  const laidLanes: LaidOutLane[] = [];
  const laidStores: LaidOutDataStore[] = [];
  const laidBoxes: LaidOutBlackBox[] = [];
  const pools: LaidOutPool[] = [];
  const pages: LaidOutPage[] = [];
  const delVarningar: LaneVarning[] = [];

  let delTop = 0;
  delar.forEach((del, i) => {
    // Delen börjar om vid vänsterkanten: allt flyttas lika mycket i sidled.
    const dx = contentLeft - del.från;
    const nodärHär = fri.nodes.filter((n) => nodDel.get(n.node.id) === i);
    const lagerHär = fri.dataStores.filter((ds) => storeDel.get(ds.store.id) === i);

    let top = delTop;
    for (const bana of fri.lanes) {
      const egnaNoder = nodärHär.filter((n) => n.node.laneId === bana.id);
      const egnaLager = lagerHär.filter((ds) => ds.store.laneId === bana.id);
      // ALLA banor finns på ALLA delar, i samma ordning – ordningen är det som
      // gör delarna läsbara i följd. Men en bana utan innehåll på just den här
      // delen faller ihop till bara sin rubrikrad; ritas den i full höjd blir
      // figuren mest tom luft.
      const harInnehåll = egnaNoder.length > 0 || egnaLager.length > 0;
      // REGEL R6: banans höjd på en del bestäms av innehållet på DEN delen.
      // Den globala höjden (bana.h) rymmer alla delars rader – på en del där
      // banan bara har en rad gav den våningar av tom luft. En MANUELLT dragen
      // höjd gäller alla delar – utom när en PER-DEL-höjd satts på just den
      // här delen: den vinner (banan kan behöva vara extra bred på en enda del).
      const swim = model.swimlanes.find((l) => l.id === bana.id);
      const manuellDel = giltigLaneHöjd(swim?.pageHeights?.[i]);
      const manuell = giltigLaneHöjd(swim?.height) > 0;
      let h = harInnehåll ? bana.h : d.laneHeaderH;
      const botten = harInnehåll
        ? Math.max(...egnaNoder.map((n) => n.y + n.h), ...egnaLager.map((ds) => ds.y + ds.h))
        : 0;
      if (manuellDel > 0) {
        // Användaren äger höjden till 100 % – även per del. För liten höjd ger
        // en rekommendation (laneVarningar), aldrig ett veto.
        h = d.laneHeaderH + Math.max(8, manuellDel - d.laneHeaderH);
        const behov = harInnehåll ? botten - bana.y + d.lanePadY : d.laneHeaderH;
        if (h < behov) {
          delVarningar.push({ laneId: bana.id, höjd: manuellDel, rekommenderad: Math.ceil(behov), del: i });
        }
      } else if (harInnehåll && !manuell) {
        h = Math.min(bana.h, Math.max(d.laneHeaderH + d.nodeH, botten - bana.y + d.lanePadY));
      }
      const dy = top - bana.y;

      // Objektets ritade läge klampas in i delens innehållsyta: deltillhörighet
      // styrs av kolumnen (R4), så ett manuellt x-läge från en annan dels rymd
      // får inte rita objektet utanför pappret.
      const klampaX = (x: number, w: number) =>
        Math.min(Math.max(x, contentLeft), contentLeft + contentW - w);
      for (const n of egnaNoder)
        laidNodes.push({ ...n, x: klampaX(n.x + dx, n.w), y: n.y + dy, page: i, dx, dy });

      /**
       * REGEL R8 håller ihop satellit och ankare: ett datalager följer sin
       * aktivitet till samma del. Ligger ankaret sist på delen hamnar dess
       * lager BORTOM delens högerkant – och klampades vart och ett för sig
       * landade de alla på samma x, staplade ovanpå varandra så att bara det
       * sist ritade syntes. Fyra listskrivningar från ett klick blev en enda
       * oläslig cylinder med fyra sidhänvisningar bredvid.
       *
       * Lagren i en bana placeras därför som en RAD: i sin fria ordning och
       * aldrig ovanpå varandra. Ryms raden inte som den ligger packas den ihop
       * med minsta lucka och skjuts in från högerkanten – tätt är läsbart,
       * staplat är det inte.
       */
      const iOrdning = [...egnaLager].sort((a, b) => a.x - b.x);
      const lagerX = new Map<string, number>();
      const lucka = d.colGap / 2;
      const höger = contentLeft + contentW;
      let nästaLedigt = contentLeft;
      for (const ds of iOrdning) {
        const x = Math.max(ds.x + dx, contentLeft, nästaLedigt);
        lagerX.set(ds.store.id, x);
        nästaLedigt = x + ds.w + lucka;
      }
      if (nästaLedigt - lucka > höger) {
        // Packad bredd med minsta lucka. Får inte ens den plats hamnar raden
        // vid vänsterkanten och tillåts sticka ut – ett lager som ritas utanför
        // pappret går att upptäcka, ett som ritas under ett annat gör det inte.
        const packad = iOrdning.reduce((s, ds) => s + ds.w, 0) + lucka * (iOrdning.length - 1);
        let x = Math.max(contentLeft, höger - packad);
        for (const ds of iOrdning) {
          lagerX.set(ds.store.id, x);
          x += ds.w + lucka;
        }
      }
      for (const ds of egnaLager)
        laidStores.push({
          ...ds,
          x: lagerX.get(ds.store.id) ?? klampaX(ds.x + dx, ds.w),
          y: ds.y + dy,
          page: i,
          dx,
          dy,
        });

      laidLanes.push({
        ...bana,
        x: d.poolLabelW,
        y: top,
        w: pageWidth - d.poolLabelW,
        h,
        page: i,
      });
      top += h;
    }

    const pool = makePool(model, d, pageWidth, top - delTop, i, delTop);
    if (pool) pools.push(pool);

    // Mottagarpoolerna ritas bara på de delar där ett meddelandeflöde faktiskt
    // utgår – de är egna deltagare, inte banor, så de flyttar inte banordningen.
    const härIds = new Set(nodärHär.map((n) => n.node.id));
    const aktiva = new Set(
      model.messageFlows.filter((mf) => härIds.has(mf.nodeId)).map((mf) => mf.poolId),
    );
    const boxar = placeBlackBoxes(
      { ...model, pools: model.pools.filter((p) => aktiva.has(p.id)) },
      top,
      pageWidth,
      d,
      i,
    );
    laidBoxes.push(...boxar);
    if (boxar.length) top = boxar[boxar.length - 1].y + d.blackBoxH;

    // Ett pappersformat har en given sidhöjd oavsett hur mycket som står på
    // sidan. En figur är exakt så hög som sitt innehåll.
    const höjd = Math.max(top - delTop, pageHeight ?? 0);
    pages.push({
      number: i + 1,
      total: delar.length,
      label: delar.length > 1 ? `${ord} ${i + 1} av ${delar.length}` : "",
      x: 0,
      y: delTop,
      w: pageWidth,
      h: höjd,
    });
    delTop += höjd + d.pageGap;
  });

  const pageRefs = byggSidhänvisningar(model, laidNodes, laidStores, d);

  return {
    nodes: laidNodes,
    lanes: laidLanes,
    pools,
    pages,
    pageRefs,
    dataStores: laidStores,
    blackBoxes: laidBoxes,
    width: pageWidth,
    height: delTop - d.pageGap,
    pageWidth,
    scale,
    pageDiag: { contentLeft, contentW, tidigaSnitt },
    laneVarningar: [...(fri.laneVarningar ?? []), ...delVarningar],
  };
}

/** Bygger poolramen om det finns lanes. */
function makePool(
  model: ProcessModel,
  d: Dims,
  width: number,
  height: number,
  page: number,
  top = 0,
): LaidOutPool | null {
  if (height <= 0) return null;
  return {
    x: 0,
    y: top,
    w: width,
    h: height,
    labelW: d.poolLabelW,
    title: model.title || "Process",
    page,
  };
}

/** Lanes i ordning; behåller bara de som faktiskt har noder. */
function orderedLanes(model: ProcessModel) {
  // Datalager är inte noder men bor ändå i en lane – utan dem här försvinner
  // en lane som bara innehåller artefakter, och artefakterna hamnar utanför bild.
  const usedLanes = new Set([
    ...model.nodes.map((n) => n.laneId),
    ...model.dataStores.map((ds) => ds.laneId),
  ]);
  return model.swimlanes.filter((l) => usedLanes.has(l.id)).sort((a, b) => a.order - b.order);
}

/**
 * Plockar ut EN del ur ett flersidigt utlägg som ett eget, komplett resultat
 * med y-noll i delens överkant.
 *
 * Det är så en figur klistras in i Word: en bild per del. Delen renderas med
 * samma kod som helheten – kanter vars ena ände ligger på en annan del faller
 * bort av sig själv, eftersom noden inte finns med i resultatet.
 */
export function extractPage(res: LayoutResult, index: number): LayoutResult {
  const sida = res.pages[index];
  if (!sida) return res;
  const dy = sida.y;
  const flytta = <T extends { y: number }>(o: T): T => ({ ...o, y: o.y - dy });
  return {
    ...res,
    nodes: res.nodes.filter((n) => n.page === index).map(flytta),
    lanes: res.lanes.filter((l) => l.page === index).map(flytta),
    pools: res.pools.filter((p) => p.page === index).map(flytta),
    dataStores: res.dataStores.filter((d) => d.page === index).map(flytta),
    blackBoxes: res.blackBoxes.filter((b) => b.page === index).map(flytta),
    pageRefs: res.pageRefs.filter((r) => r.page === index).map(flytta),
    pages: [{ ...sida, y: 0 }],
    height: sida.h,
  };
}

/** Kör layout på en modell (endast noder/kanter för aktuellt perspektiv). */
export function layoutModel(model: ProcessModel, opts?: LayoutOptions): LayoutResult {
  const rank = computeRanks(model);
  const scale = opts?.scale ?? 1;
  const d = scaledDims(scale, opts?.spacing ?? 1);
  const pageWidth = opts?.pageWidth ?? null;
  if (!pageWidth) return layoutFree(model, rank, d, scale);

  // Ryms flödet på EN sida används den fria layouten rakt av – då slipper vi
  // både sidramar och omkomponering för ingenting.
  const fri = layoutFree(model, rank, d, scale);
  if (fri.width <= pageWidth) {
    const sidHöjd = Math.max(fri.height, opts?.pageHeight ?? 0);
    const en = opts?.shrinkToContent
      ? fri
      : { ...fri, ...sträckTill(fri, pageWidth, d) };
    return {
      ...en,
      pageWidth,
      pages: [{ number: 1, total: 1, label: "", x: 0, y: 0, w: en.width, h: sidHöjd }],
    };
  }

  // Bredare än sidan → snitta den fria layouten i delar. Allt är redan placerat,
  // inklusive manuellt dragna objekt; delarna flyttar bara på det.
  return layoutPaged(fri, model, rank, pageWidth, opts?.pageHeight ?? null, d, scale);
}

/** Sträcker lanes och pool till full sidbredd (A4-ramen ska stämma). */
function sträckTill(res: LayoutResult, width: number, d: Dims) {
  return {
    width,
    lanes: res.lanes.map((l) => ({ ...l, w: width - (res.pools.length ? d.poolLabelW : 0) })),
    pools: res.pools.map((p) => ({ ...p, w: width })),
    blackBoxes: res.blackBoxes.map((b) => ({ ...b, w: width })),
  };
}
