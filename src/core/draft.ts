/**
 * ProcessDraft – Arkitektens *mellanlager*.
 *
 * Bärande designprincip (utökad från model.ts):
 *   Text (rå eller AI-tolkad) → ProcessDraft → ProcessModel → layout → diagram
 *
 * Draften är en PLATT, numrerad steglista. Den är avsiktligt enklare än
 * ProcessModel: inga kanter, ingen graf – bara steg i ordning, plus en
 * markering för de steg som hör till en beslutsgren. Det gör den redigerbar
 * i en tabell (byt typ, skriv om text, flytta upp/ned, ta bort) utan att
 * användaren behöver tänka på pilar.
 *
 * `compileDraft` är den DETERMINISTISKA kompileringen draft → modell. Både
 * regelparsern och AI-lagret producerar drafter; de går genom exakt samma
 * kompilering, så diagrammet ritas likadant oavsett var draften kom ifrån.
 */

import { portalbana } from "./organisation";
import {
  emptyModel,
  type DataAssociation,
  type DataStore,
  type EdgeSide,
  type TextPlacement,
  type MessageFlow,
  type Pool,
  type GatewayKind,
  type NodeType,
  type Perspective,
  type ProcessEdge,
  type ProcessModel,
  type ProcessNode,
  type Swimlane,
} from "./model";

/**
 * HUKI-ansvar för en roll/intressent på en aktivitet (affärsprocessen):
 * H = Huvudansvar, U = Utför, K = Konsulteras, I = Informeras.
 */
export type Huki = "H" | "U" | "K" | "I";

/**
 * Affärsprocessens satelliter på ett steg – det som i "Affärsprocess"-typen ritas
 * runt aktiviteten (roller/IT-stöd under, krav/tid över) samt förädlings-
 * kedjans in/ut-verksamhetsobjekt. Ligger på steget i MELLANLAGRET så att
 * samma innehåll kan visas både som flödesschema och som affärsprocess;
 * flödesschemat ignorerar blocket helt.
 */
export interface ApStegInfo {
  /** Roller (hatt) med HUKI-bokstav på relationen. */
  roller?: { namn: string; huki?: Huki }[];
  /** Intressenter (ellips) med HUKI-bokstav. */
  intressenter?: { namn: string; huki?: Huki }[];
  /** Applikationer/IT-stöd (cylinder) – relationen "Samverkar med". */
  applikationer?: string[];
  /** Arkiv (låda) – relationen "Samverkar med". */
  arkiv?: string[];
  /** Krav (hexagon) – relationen "Adresserar", ritas över aktiviteten. */
  krav?: string[];
  /** Tid (klocka) – relationen "Adresserar", ritas över aktiviteten. */
  tid?: string;
  /** Forum (pratbubbla). */
  forum?: string;
  /** Plats (nål). */
  plats?: string;
  /** Problem (!) – förbättringsobjekt kopplade till aktiviteten. */
  problem?: string[];
  /** Risker (varningstriangel). */
  risker?: string[];
  /** Möjligheter (?). */
  mojligheter?: string[];
  /** Input-verksamhetsobjekt som ritas FÖRE steget i kedjan. */
  input?: string;
  /**
   * Output-verksamhetsobjekt EFTER steget. Saknas = ett förslag genereras
   * automatiskt ur aktivitetens namn ("Genomför urval" → "Urval genomfört").
   * `null` = inget objekt alls (förslaget bortvalt).
   */
  output?: string | null;
  /**
   * Steget är en DELPROCESS, inte en aktivitet – den gula pilen. Reglerna
   * skiljer på "något som utförs här" och "en process som körs på annat håll",
   * och de ritas med olika form. Flaggan ligger här hos
   * satelliterna eftersom den bara betyder något i affärsprocessvyn; flödesschemat
   * ritar steget som vanligt.
   */
  delprocess?: boolean;
  /**
   * Steget är ett FORUM i kedjan, inte en aktivitet – pratbubblan. Ett forum
   * har möten som arbetssätt (bereda, genomföra eller kommunicera) och står i
   * en aktivitets ställe när aktiviteten alltid ska genomföras i mötesform.
   * Skrivs `[Forum]` (utan kolon) i texten. `forum` ovan är något annat: ett
   * forum som SATELLIT (Samverkar med).
   */
  iMötesform?: boolean;
}

/** Vilken beslutsgren ett steg hör till. Saknas = steget ligger i huvudflödet. */
export interface BranchRef {
  /** Id på beslutssteget grenen hänger under. */
  stepId: string;
  /** Grenens etikett, t.ex. "Ja" / "Nej" / "Hög prioritet". */
  label: string;
}

/** Ett steg i mellanlagret – motsvarar exakt en nod i diagrammet. */
export interface DraftStep {
  id: string;
  type: NodeType;
  /** Etiketten som visas i noden. */
  text: string;
  laneId: string;
  /** Endast för decision: BPMN-gateway-typ. */
  gateway?: GatewayKind;
  /**
   * Endast för decision med EN uttalad gren: namnet på den MOTSATTA vägen, den
   * som faller igenom till nästa steg. Saknas = härlett ur grenen (Ja → Nej,
   * Nej → Ja, annars "Annars"). Den vägen har inga egna steg som kan bära
   * etiketten, så den bor här – annars gick "Nej" inte att döpa om alls.
   */
  motsattEtikett?: string;
  /** Sätts på steg som ligger inuti en beslutsgren. */
  branchOf?: BranchRef;
  /** Spårbarhet: index i källtexten. −1 = tillagt manuellt eller av notation. */
  sourceIndex: number;
  /** Ursprunglig textfras (för spårbarhets-inspektören). */
  sourceText?: string;
  /** Åsidosätter lanens standardperspektiv om satt. */
  perspectives?: Perspective[];
  /** Fritextnot, t.ex. AI:ns motivering. Visas som tooltip i mellanlagret. */
  note?: string;
  /**
   * Mottagande deltagare för ett meddelande (notifiering). Ger ett
   * meddelandeflöde ut till en svart-låda-pool. Ligger på steget så att den
   * går att ändra i mellanlagret – tolkningen hör hemma där, inte i
   * kompileringen.
   */
  recipient?: string;
  /**
   * Skickar steget ett meddelande eller tar det emot ett? En mottagning
   * utförs av MOTTAGAREN och ger inget utgående meddelandeflöde.
   */
  messageDirection?: "send" | "receive";
  /**
   * Manuellt satt position från editorn. null/saknas = auto-layout bestämmer.
   * Ligger på steget (inte bara i modellen) så att den följer med när flödet
   * sparas, versioneras och öppnas igen.
   */
  position?: { x: number; y: number } | null;
  /** Manuell textstorlek för steget (faktor, 1 = normal). */
  textSize?: number;
  /** Var texten placeras i noden. Saknas = centrerat. */
  textPlacement?: TextPlacement;
  /** Affärsprocessens satelliter (roller, IT-stöd, krav, in/ut-objekt). Se ApStegInfo. */
  ap?: ApStegInfo;
}

/** Manuellt valda kopplingspunkter för en kant. */
/** En koppling användaren dragit för hand. */
export interface ManualEdge {
  source: string;
  target: string;
  label?: string;
}

export interface EdgeSides {
  sourceSide?: EdgeSide;
  targetSide?: EdgeSide;
  /**
   * VAR på sidan pilen fäster: 0 = sidans början (vänster/överst), 1 = slutet,
   * 0,5 = mitten. Saknas = mitten.
   *
   * Fyra punkter räcker inte i praktiken: en pil kan behöva fästa t.ex.
   * 60 % in på aktivitetens underkant, och två pilar till samma
   * sida ska kunna gå bredvid varandra i stället för ovanpå varandra.
   */
  sourcePos?: number;
  targetPos?: number;
  /**
   * Etikett på en HÄRLEDD kant (kedjepil). Grenar bär sin etikett i steget
   * (`branchOf.label`) och handritade pilar i sin egen post – en kedjepil har
   * ingen sådan plats, så den bor här bland kantens övriga presentationsval.
   */
  label?: string;
  /**
   * Dolda sidhänvisningar för en kant som korsar ett snitt.
   * "in" = märket vid MÅLET ("från del N"), "ut" = märket vid KÄLLAN.
   *
   * En gateway med två grenar som båda landar på nästa del ger två märken som
   * båda säger "från del N". De är inte dubbletter – de hör till olika noder –
   * men i en färdig figur vill man ibland bara behålla det ena.
   */
  hideRefIn?: boolean;
  hideRefOut?: boolean;
  /**
   * Manuell brytpunkt i fri-layoutens koordinater. Kanten dras med räta vinklar
   * genom punkten så att man kan tvinga den runt andra sidan av ett objekt.
   */
  waypoint?: { x: number; y: number };
  /**
   * ANDRA brytpunkten, närmast målet (fri-layoutens koordinater). Gäller bara
   * tillsammans med `waypoint`: vägen går ut ur källan, genom `waypoint`,
   * genom den här och in i målet. Ritytan sätter den när man drar SISTA
   * STRÄCKAN i sidled – punkten ligger då i höjd med målets port, så pilen går
   * rakt in. Se `sistaSträckan` i edge-router.
   */
  waypoint2?: { x: number; y: number };
  /**
   * Etikettens läge längs kanten som ANDEL av vägens längd (0–1). Saknas =
   * `labelAnchor` väljer. Sparas som andel, inte koordinat, så att en flyttad
   * "Ja"/"Nej" följer med när objekten flyttas eller sidformatet byts.
   */
  labelPos?: number;
}

/**
 * Nyckel för en kant i `edgeStyles`/`removedEdges`. Kanter har inga stabila
 * id:n – de skapas om vid varje kompilering – så de identifieras av sitt
 * nodpar, plus ETIKETTEN när en finns.
 *
 * Etiketten behövs för att två pilar kan dela nodpar: ett beslut vars båda
 * grenar landar i samma steg ger "Ja" och "Nej" mellan samma noder. Utan
 * etiketten i nyckeln träffade en borttagning eller stiländring BÅDA pilarna.
 * Nycklar utan etikett fungerar fortfarande (bakåtkompatibelt) och läses som
 * reserv när ingen etikettnyckel matchar – se `edgeStyleFor`/`ärBorttagen`.
 */
export function edgeKey(source: string, target: string, label?: string): string {
  const bas = `${source}->${target}`;
  return label ? `${bas}#${label}` : bas;
}

/**
 * Stil för en kant: etikettnyckeln vinner, par-nyckeln är reserv.
 *
 * `parNyckelnÄgs` stänger av reserven. Den behövs när det FINNS en omärkt kant
 * mellan samma nodpar – då är par-nyckeln dess egen, och en märkt kant får inte
 * ärva den. Utan spärren flyttades båda pilarna av ett enda drag: man drog i den
 * handritade och Nej-pilen hoppade med, så kopplingspunkten gick aldrig att
 * lägga där man ville. Reserven finns bara för data som sparades innan
 * etiketten blev en del av nyckeln.
 */
function edgeStyleFor(
  draft: ProcessDraft,
  source: string,
  target: string,
  label?: string,
  parNyckelnÄgs?: ReadonlySet<string>,
): EdgeSides | undefined {
  const styles = draft.edgeStyles;
  if (!styles) return undefined;
  if (label) {
    const egen = styles[edgeKey(source, target, label)];
    if (egen) return egen;
    if (parNyckelnÄgs?.has(`${source}->${target}`)) return undefined;
  }
  return styles[edgeKey(source, target)];
}

/** Är kanten borttagen? Etikettnyckeln eller par-nyckeln räcker. */
function ärBorttagen(borttagna: Set<string>, source: string, target: string, label?: string): boolean {
  return (
    (label !== undefined && borttagna.has(edgeKey(source, target, label))) ||
    borttagna.has(edgeKey(source, target))
  );
}

/** Varifrån draften kommer – styr vad UI:t visar och kan generera om. */
export type DraftOrigin = "rules" | "ai" | "manual";

/**
 * Diagramtyp – ett PRESENTATIONSVAL på flödet, inte en annan modell.
 * "flode" = dagens flödesschema med simbanor, "affarsprocess" = Affärsprocess
 * (vågrätt processflöde utan simbanor). Samma mellanlager bär båda.
 */
export type DiagramType = "flode" | "affarsprocess";

export interface ProcessDraft {
  title: string;
  subtitle?: string;
  /** Vald diagramtyp. Saknas = "flode" (flödesschema). */
  diagramType?: DiagramType;
  lanes: Swimlane[];
  steps: DraftStep[];
  /**
   * Steg som ligger FRITT på ytan – placerade ur verktygsraden men ännu inte
   * inkedjade. De ritas som vanliga objekt men kopplas inte automatiskt till
   * flödet, och får inget auto-slut.
   *
   * Samma princip som affärsprocessens `apFria`, av samma skäl: kedjas ett placerat objekt
   * in automatiskt ritas hela flödet om, och det ser ut som att objekt
   * försvinner. Man knyter in det själv genom att dra en koppling.
   */
  fria?: string[];
  /** Manuellt valda kopplingspunkter, nyckel = `edgeKey(source, target)`. */
  edgeStyles?: Record<string, EdgeSides>;
  /**
   * Kopplingar användaren tagit bort, som `edgeKey(source, target)`.
   * Kanterna räknas fram ur stegens ordning, så en borttagen koppling kan inte
   * "raderas" – den undertrycks vid kompileringen och kan tas tillbaka.
   *
   * Gäller ALLA sorters kopplingar: sekvensflöden, dataassociationer och
   * meddelandeflöden. Nyckeln är nodparet, vilket fungerar lika bra för ett
   * datalager- eller pool-id.
   */
  removedEdges?: string[];
  /**
   * Kopplingar användaren dragit själv.
   *
   * Kanterna räknas annars fram ur stegens ordning – det här är hur man lägger
   * till en koppling som texten inte gav. Sorten härleds vid kompileringen ur
   * vad ändarna är: ett datalager i någon ände ger en dataassociation, en
   * mottagarpool ger ett meddelandeflöde, annars ett sekvensflöde.
   */
  extraEdges?: ManualEdge[];
  /**
   * Etiketter användaren ändrat på auto-noder (slut-event som notationen lade
   * till, inte steg i mellanlagret). De har inga steg att uppdatera, så deras
   * omdöpta namn sparas här på nod-id – samma stabila id som positioner nycklas
   * på – och läggs på vid kompileringen. Utan detta gick ett auto-slut inte att
   * döpa om: ändringen togs emot men fanns ingenstans att spara.
   */
  autoLabels?: Record<string, string>;
  /**
   * Manuella positioner för auto-noder (se autoLabels). Auto-noder är inga steg,
   * så deras utdragna läge kan inte sparas på ett steg – det ligger här på nod-id
   * och läggs på vid kompileringen. Utan detta hoppade ett flyttat auto-slut
   * tillbaka till sin autoplacering direkt.
   */
  autoPositions?: Record<string, { x: number; y: number } | null>;
  /**
   * Den avskalade presentationsbilden (tools/ramar/avskalad.ts): rutor som
   * flyttats för hand där, nycklade på objektets id. EGEN koordinatram –
   * presentationsbildens, inte verktygets – så en flytt i den ena bilden rör
   * aldrig den andra (invariant 5).
   */
  presentation?: {
    lägen?: Record<string, { x: number; y: number }>;
    /** Var kopplingarna lämnar/går in i rutorna – nycklat på kantnyckeln (med etikett). */
    kopplingar?: Record<string, { sourceSide?: EdgeSide; sourcePos?: number; targetSide?: EdgeSide; targetPos?: number }>;
  };
  /**
   * Textstorlek (faktor) för objekt som inte är steg – satelliter, insprängda
   * verksamhetsobjekt, auto-slut och fria objekt. Steg bär sin egen i
   * `step.textSize`. Se `setTextSize`.
   */
  autoTextSizes?: Record<string, number>;
  /**
   * Banbyte för auto-noder (se autoLabels). Ett auto-slut hänger normalt i samma
   * bana som noden det avslutar; väljer man en annan bana i mellanlagret sparas
   * valet här på nod-id och läggs på vid kompileringen. Utan detta gick ett
   * auto-slut inte att flytta till en annan simbana alls.
   */
  autoLanes?: Record<string, string>;
  /**
   * Manuellt vald DEL i flersidigt utlägg, per nod-id (0-baserad). Sätts när
   * ett objekt dras till en annan del; hänvisningar och kopplingar räknas om
   * automatiskt eftersom de härleds ur deltillhörigheten. Fungerar för både
   * steg och auto-noder (nycklas på nod-id).
   */
  pagePins?: Record<string, number>;
  /**
   * FRIA affärsprocessobjekt, utplacerade från paletten. Ett fritt objekt har INGEN
   * koppling alls förrän användaren drar en pil – först då knyts det in
   * (en roll blir aktivitetens roll, ett VO blir dess ut-objekt, en fri
   * aktivitet blir ett kedjesteg). Id:t (fri_<n>) sätts EN gång vid
   * placeringen och lagras här – det härleds aldrig om, så positioner och
   * omdöpningar kan inte förskjutas. `kind` är ApNodeKind (som sträng för
   * att inte dra ap-modellen in i kärnan).
   */
  apFria?: {
    id: string;
    kind: string;
    namn: string;
    /** Bara för kind "vo": "objekt" (förval), "dokument" eller "meddelande". */
    variant?: string;
  }[];
  /**
   * RUTINER i affärsprocessverktyget: arbetsbeskrivningen bakom ett krav ("Rutin för
   * eDiscovery Search"), nycklad på kravets nod-id – satellitens härledda id
   * eller det fria objektets lagrade. Texten är en rad per moment; en indragen
   * rad är en underpunkt (se `core/rutin.ts`). Bor på draften och inte i
   * stegets ap-block, så att den följer med versionen men inte tolkas om när
   * beskrivningen redigeras.
   */
  apRutiner?: Record<string, { text: string }>;
  meta: {
    /** Användarens råtext. */
    sourceText: string;
    /** AI-beskrivningen (den städade texten), om draften kom från AI. */
    aiText?: string;
    origin: DraftOrigin;
    /** Alla textfragment som identifierats (för spårbarhet). */
    sourceFragments: string[];
    warnings: string[];
  };
}

export function emptyDraft(): ProcessDraft {
  return {
    title: "",
    lanes: [],
    steps: [],
    meta: { sourceText: "", origin: "manual", sourceFragments: [], warnings: [] },
  };
}

/** Kanoniska swimlanes (speglar rules.ts LANE – duplicerat här för att undvika cykel). */
const LANE_USER = "Användare";

/**
 * Standardperspektiv för en swimlane: användar-/portalnära lanes syns i båda
 * vyerna, rent tekniska lanes bara i systemvyn.
 */
export function laneDefaultPerspectives(id: string): Perspective[] {
  if (id === LANE_USER || id === portalbana()) return ["business", "system"];
  return ["system"];
}

/** Skapar en swimlane med standardvärden. */
export function makeLane(id: string, order: number): Swimlane {
  return { id, title: id, order, perspectives: laneDefaultPerspectives(id) };
}

/** Motsatt grenetikett – används när ett beslut bara har en uttalad gren. */
function complementLabel(label: string): string {
  const t = label.trim().toLowerCase();
  if (t === "ja") return "Nej";
  if (t === "nej") return "Ja";
  return "Annars";
}

/**
 * Scope-nyckel för gruppering: "" = huvudflödet, annars beslut + grenetikett.
 *
 * Separatorn är NUL just för att den aldrig kan förekomma i ett steg-id eller
 * en grenetikett. ALLA ställen som bygger en scope-nyckel måste gå via
 * `branchScope` – tidigare byggdes nyckeln på två ställen med olika separator,
 * vilket tyst gjorde att grensteg inte hittades i trädordningen.
 */
export function branchScope(stepId: string, label: string): string {
  return `${stepId}\u0000${label}`;
}

function scopeKey(step: DraftStep): string {
  return step.branchOf ? branchScope(step.branchOf.stepId, step.branchOf.label) : "";
}

interface MergePoint {
  id: string;
  label?: string;
}

/**
 * Kompilerar mellanlagret till en komplett ProcessModel.
 *
 * Regler:
 *  - Steg i samma scope kedjas i ordning.
 *  - Ett beslutssteg grenar ut till varje gren-scope som pekar på det.
 *  - Nästa steg efter beslutet återförenar grenarnas svansar. Har beslutet
 *    bara EN uttalad gren faller motsatta vägen igenom direkt till nästa steg
 *    (kant märkt "Nej"/"Ja"/"Annars").
 *  - Slut-event normaliseras strukturellt (samma regler som tidigare i parsern).
 */
/**
 * Banan ett slut-event ska ligga i: HUVUDVÄGENS sista steg.
 *
 * Ett slut-event utför ingenting eget – det avslutar de vägar som når det, och
 * flödet ska gå vidare i samma bana som steget före. Huvudvägen är den ingång
 * som ligger DJUPAST in i flödet: den kedja där arbetet faktiskt utförs. De
 * korta grenarna in i ett slut är återvändsgränder ("Kommentera går inte att
 * välja") och ska inte avgöra var processen slutar.
 *
 * Två regler stod här förut och båda var fel:
 *   - kompileringsordningen (`nodes[nodes.length - 1]`), alltså ett grensteg som
 *     kan ligga var som helst;
 *   - flest inkommande vägar, med delningspunkten som skiljedomare. Den la
 *     slutet hos aktören som ställde frågan i stället för hos den som avslutade
 *     arbetet – "Klart" hamnade i portalen fast steget före låg i Power
 *     Automate.
 *
 * `undefined` när ingen ingång går att knyta till en nod; anroparen väljer då
 * sitt eget förval.
 *
 * EXPORTERAD för att `scripts/ratta-slutbanor.mts` rättar redan sparade flöden
 * med exakt samma regel – två kopior hade gett skärm och fil olika svar.
 */
export function banaFörSlut(
  ingångar: ReadonlyArray<{ id: string }>,
  nodes: ReadonlyArray<{ id: string; laneId: string }>,
  edges: ReadonlyArray<{ source: string; target: string }>,
): string | undefined {
  const kandidater = ingångar
    .map((i) => nodes.find((n) => n.id === i.id))
    .filter((n): n is { id: string; laneId: string } => Boolean(n));
  if (kandidater.length === 0) return undefined;
  const djup = djupFrånStart(nodes, edges);
  // Djupast vinner; vid lika djup den FÖRSTA, alltså huvudflödets egen ordning.
  return kandidater.reduce((bäst, k) =>
    (djup.get(k.id) ?? 0) > (djup.get(bäst.id) ?? 0) ? k : bäst,
  ).laneId;
}

/**
 * Längsta vägen från en ingångslös nod till varje nod – "hur djupt in i flödet".
 * Måttet skiljer huvudvägen från en kort sidogren; en cykel bryts av `pågår`, så
 * ett flöde som råkar gå i ring ger ett tal i stället för en oändlig slinga.
 */
function djupFrånStart(
  nodes: ReadonlyArray<{ id: string }>,
  edges: ReadonlyArray<{ source: string; target: string }>,
): Map<string, number> {
  const inkommande = new Map<string, string[]>();
  for (const e of edges) {
    if (!inkommande.has(e.target)) inkommande.set(e.target, []);
    inkommande.get(e.target)!.push(e.source);
  }
  const djup = new Map<string, number>();
  const pågår = new Set<string>();
  const räkna = (id: string): number => {
    const känt = djup.get(id);
    if (känt !== undefined) return känt;
    if (pågår.has(id)) return 0; // cykel – bryt utan att låsa oss
    pågår.add(id);
    const före = inkommande.get(id) ?? [];
    const v = före.length === 0 ? 0 : 1 + Math.max(...före.map(räkna));
    pågår.delete(id);
    djup.set(id, v);
    return v;
  };
  for (const n of nodes) räkna(n.id);
  return djup;
}

/** Dolda sidhänvisningar för en riktad koppling, ur `edgeStyles`. */
function refFlaggor(draft: ProcessDraft, source: string, target: string) {
  const v = draft.edgeStyles?.[edgeKey(source, target)];
  return { hideRefIn: v?.hideRefIn, hideRefOut: v?.hideRefOut };
}

export function compileDraft(draft: ProcessDraft): ProcessModel {
  const model = emptyModel();
  model.title = draft.title;
  model.subtitle = draft.subtitle;
  model.meta.sourceText = draft.meta.sourceText;
  model.meta.sourceFragments = [...draft.meta.sourceFragments];
  model.meta.warnings = [...draft.meta.warnings];

  // ---- Swimlanes: behåll angivna, lägg till de som steg refererar till.
  const lanes = new Map<string, Swimlane>();
  for (const l of draft.lanes) lanes.set(l.id, { ...l });
  for (const s of draft.steps) {
    if (!lanes.has(s.laneId)) lanes.set(s.laneId, makeLane(s.laneId, lanes.size));
  }

  // ---- Gruppera steg per scope (bevarar inbördes ordning).
  const scopes = new Map<string, DraftStep[]>();
  /** Grenetiketter per beslutssteg, i den ordning de först dyker upp. */
  const branchLabels = new Map<string, string[]>();
  for (const s of draft.steps) {
    const key = scopeKey(s);
    const list = scopes.get(key);
    if (list) list.push(s);
    else scopes.set(key, [s]);

    if (s.branchOf) {
      const labels = branchLabels.get(s.branchOf.stepId) ?? [];
      if (!labels.includes(s.branchOf.label)) labels.push(s.branchOf.label);
      branchLabels.set(s.branchOf.stepId, labels);
    }
  }

  // Processens egen pool. Mottagare läggs till som svarta lådor vid behov.
  const huvudpool: Pool = { id: "process", title: draft.title || "Process", order: 0 };
  const pools: Pool[] = [huvudpool];
  const dataStores: DataStore[] = [];
  const dataAssociations: DataAssociation[] = [];
  const messageFlows: MessageFlow[] = [];
  let artefaktN = 0;

  /** Hämtar (eller skapar) den svarta lådan för en mottagare. */
  const mottagarpool = (namn: string): Pool => {
    const id = `pool_${namn}`;
    const fanns = pools.find((p) => p.id === id);
    if (fanns) return fanns;
    const ny: Pool = { id, title: namn, order: pools.length, blackBox: true };
    pools.push(ny);
    return ny;
  };

  const nodes: ProcessNode[] = [];
  const edges: ProcessEdge[] = [];
  let edgeN = 0;
  const borttagna = new Set(draft.removedEdges ?? []);
  /**
   * Noder vars utgående koppling användaren tagit bort. De ska INTE få ett
   * automatiskt slut-event: att radera en pil ska klippa flödet, inte trolla
   * fram en ny "Klart"-nod. Att noden blir hängande syns i BPMN-kontrollen –
   * det är ärligare än att dölja konsekvensen av valet.
   */
  const klippta = new Set<string>();
  /** Steg som ligger fritt – se ProcessDraft.fria. */
  const fria = new Set(draft.fria ?? []);
  /**
   * Nodpar som en HANDRITAD, omärkt pil äger par-nyckeln till. En märkt kant på
   * samma par får då inte falla tillbaka på den nyckeln – annars flyttar ett
   * enda drag båda pilarna, och kopplingspunkten går aldrig att lägga rätt.
   */
  const parNyckelnÄgs = new Set(
    (draft.extraEdges ?? []).filter((e) => !e.label).map((e) => `${e.source}->${e.target}`),
  );
  const addEdge = (source: string, target: string, label?: string) => {
    // Bortvald koppling ritas inte alls.
    if (ärBorttagen(borttagna, source, target, label)) {
      klippta.add(source);
      return;
    }
    // Manuellt satta kopplingspunkter läggs på vid skapandet, så att både
    // canvas och exportörerna ser samma kant.
    const sides = edgeStyleFor(draft, source, target, label, parNyckelnÄgs);
    edges.push({
      id: `e${++edgeN}`,
      source,
      target,
      // En kedjepil kan ha fått en etikett för hand – grenens egen vinner alltid.
      label: label ?? sides?.label,
      sourceSide: sides?.sourceSide,
      targetSide: sides?.targetSide,
      waypoint: sides?.waypoint,
      labelPos: sides?.labelPos,
      hideRefIn: sides?.hideRefIn,
      hideRefOut: sides?.hideRefOut,
      perspectives: ["business", "system"],
    });
  };

  const emitted = new Set<string>();
  /**
   * Datalager vars läsare ännu inte skapats, med det scope de väntar i.
   * Vilken scope spelar roll: ett mejl inuti en GREN får inte avbryta väntan
   * för huvudflödet – då tappades en korrekt läsning bara för att grenen råkade
   * innehålla en notifiering.
   */
  const väntandeLäsning: { id: string; key: string }[] = [];
  /**
   * Senaste steget som faktiskt UTFÖR arbete.
   *
   * Ett datalager skrivs av den aktivitet som gör jobbet – inte av det som
   * råkade stå närmast före i texten. Undantagna är:
   *  - notifieringar (ett mejl skapar ingen loggpost),
   *  - gateways (en gateway routar, den utför inget),
   *  - event (start/slut är inga aktiviteter).
   * Utan den åtskillnaden pekade "Loggpost skapas" först på ett mejlutskick
   * och därefter på gatewayen "Hög prioritet?" – båda lika fel.
   */
  let sistaUtförare: string | null = null;
  const ärUtförare = (t: NodeType) => t === "activity" || t === "system" || t === "integration";

  /**
   * Scopens släktskap. En läsning får bara korsa scopegränsen UPPÅT eller
   * NEDÅT i grenträdet:
   *  - skrivs lagret i huvudflödet läser vilken gren som helst det,
   *  - skrivs det i en gren läser huvudflödet efter sammanflödet det,
   *  - och en gren nästlad under den grenen läser också det.
   * Men ALDRIG i sidled: Ja-grenen skriver, och då kan inte Nej-grenen läsa –
   * den vägen kördes ju aldrig. (Hände på riktigt: "Byt godkännare går inte
   * att välja" fick en streckad pil från loggposten som Ja-grenen skrev.)
   */
  const scopeFörälder = new Map<string, string>();
  for (const s of draft.steps) {
    if (s.type !== "decision") continue;
    const egetScope = scopeKey(s);
    for (const gren of draft.steps) {
      if (gren.branchOf?.stepId === s.id) {
        scopeFörälder.set(branchScope(s.id, gren.branchOf.label), egetScope);
      }
    }
  }
  /** Är `a` samma scope som `b`, eller en förfader till det? */
  const ärFörfader = (a: string, b: string): boolean => {
    let k: string | undefined = b;
    const sedda = new Set<string>();
    while (k !== undefined && !sedda.has(k)) {
      if (k === a) return true;
      sedda.add(k);
      k = scopeFörälder.get(k);
    }
    return false;
  };
  /** Får ett lager skrivet i `skrivScope` läsas i `läsScope`? */
  const fårLäsas = (skrivScope: string, läsScope: string) =>
    ärFörfader(skrivScope, läsScope) || ärFörfader(läsScope, skrivScope);

  /** Bygger en kedja av steg i ett scope. Returnerar öppna utgångar. */
  function compileChain(key: string, entry: MergePoint[]): MergePoint[] {
    let merges = entry;
    const kedja = scopes.get(key) ?? [];
    for (const step of kedja) {
      if (emitted.has(step.id)) continue; // skydd mot cirkulära grenreferenser
      emitted.add(step.id);

      // ---- Datalager är en ARTEFAKT, inte ett flödesobjekt.
      // Det får aldrig ligga i sekvensflödet (formellt BPMN-fel). I stället
      // hoppar flödet över det, och lagret kopplas med dataassociationer:
      // föregående aktivitet SKRIVER till det, nästa aktivitet LÄSER från det.
      if (step.type === "datastore") {
        dataStores.push({
          id: step.id,
          label: step.text,
          laneId: step.laneId,
          sourceIndex: step.sourceIndex,
          sourceText: step.sourceText,
          // Föregående nod i kedjan – artefaktens plats i kronologin.
          afterNodeId: merges[0]?.id,
          position: step.position ?? null,
          perspectives: step.perspectives ?? laneDefaultPerspectives(step.laneId),
          textSize: step.textSize,
        });
        // Skrivaren är den senaste riktiga utföraren; saknas en sådan faller
        // vi tillbaka på det som flödet kommer ifrån.
        const skrivare = sistaUtförare ? [sistaUtförare] : merges.map((m) => m.id);
        for (const id of skrivare) {
          const sidor = edgeStyleFor(draft, id, step.id);
          dataAssociations.push({
            id: `da${++artefaktN}`,
            nodeId: id,
            dataStoreId: step.id,
            direction: "write",
            // Samma presentationsval som för kanter: en association som korsar
            // ett snitt får sidhänvisningar, och de går att dölja var för sig.
            ...refFlaggor(draft, id, step.id),
            // Manuellt valda kopplingspunkter – utan dem satt streckade
            // kopplingar fast i botten→topp och gick inte att styra alls.
            sourceSide: sidor?.sourceSide,
            targetSide: sidor?.targetSide,
            // Brytpunkten bor i samma post som sidorna. En streckad koppling är
            // lika mycket i vägen som en heldragen, så böjen måste gå att flytta.
            waypoint: sidor?.waypoint,
            label: sidor?.label,
            perspectives: ["business", "system"],
          });
        }
        väntandeLäsning.push({ id: step.id, key });
        continue; // merges lämnas orörda – kedjan går vidare förbi lagret
      }

      nodes.push({
        id: step.id,
        type: step.type,
        label: step.text,
        laneId: step.laneId,
        gateway: step.type === "decision" ? (step.gateway ?? "exclusive") : undefined,
        sourceIndex: step.sourceIndex,
        sourceText: step.sourceText,
        perspectives: step.perspectives ?? laneDefaultPerspectives(step.laneId),
        position: step.position ?? null,
        messageDirection: step.type === "notification" ? (step.messageDirection ?? "send") : undefined,
        recipient: step.type === "notification" ? step.recipient?.trim() || undefined : undefined,
        textSize: step.textSize,
        textPlacement: step.textPlacement,
      });

      if (ärUtförare(step.type)) sistaUtförare = step.id;

      // Datalager som passerats precis före läses av nästa UTFÖRARE – inte av
      // en gateway eller ett mejl som råkar stå närmast. Finns ingen utförare
      // efteråt skapas ingen läsning alls; ett lager som bara skrivs är
      // fullt rimligt och syns i BPMN-kontrollen om det är oavsiktligt.
      // En gateway är genomskinlig – den routar bara, så läsningen får passera
      // förbi den. Allt annat som inte utför arbete (mejl, event) BRYTER
      // väntan i SITT EGET scope: hade den fått passera skulle en kvittenssida
      // långt senare se ut att läsa loggposten.
      if (!ärUtförare(step.type) && step.type !== "decision") {
        for (let i = väntandeLäsning.length - 1; i >= 0; i--) {
          if (väntandeLäsning[i].key === key) väntandeLäsning.splice(i, 1);
        }
      }

      // Utförare får läsa över scopegränsen – en gren som startar med ett
      // Power Automate-flöde läser mycket riktigt posten som just skapades –
      // men bara uppåt/nedåt i grenträdet, aldrig från ett syskon (fårLäsas).
      if (ärUtförare(step.type)) {
        // Bara lager i samma gren-gren av trädet – ett syskonscope lämnas kvar
        // och väntar på en läsare som faktiskt kan ha kört skrivningen.
        const läsbara = väntandeLäsning.filter((v) => fårLäsas(v.key, key));
        for (const v of läsbara) väntandeLäsning.splice(väntandeLäsning.indexOf(v), 1);
        for (const väntande of läsbara) {
          const sidor = edgeStyleFor(draft, väntande.id, step.id);
          dataAssociations.push({
            id: `da${++artefaktN}`,
            nodeId: step.id,
            dataStoreId: väntande.id,
            direction: "read",
            ...refFlaggor(draft, väntande.id, step.id),
            sourceSide: sidor?.sourceSide,
            targetSide: sidor?.targetSide,
            // Brytpunkten bor i samma post som sidorna. En streckad koppling är
            // lika mycket i vägen som en heldragen, så böjen måste gå att flytta.
            waypoint: sidor?.waypoint,
            label: sidor?.label,
            perspectives: ["business", "system"],
          });
        }
      }

      // Notifieringar skickar till en annan DELTAGARE – meddelandeflöde ut ur
      // poolen, aldrig en streckad pil mellan två objekt i samma pool.
      // En MOTTAGNING ger inget utgående meddelandeflöde – pilen går hit, inte
      // härifrån. Den som tar emot skickar inget.
      if (step.type === "notification" && step.messageDirection !== "receive") {
        const mottagare = step.recipient?.trim();
        // En mottagare som redan är en BANA i processen är ingen extern part.
        // Ett meddelandeflöde måste korsa en poolgräns; går det till någon som
        // ligger inuti samma pool är det inte ett meddelandeflöde utan intern
        // kommunikation. Annars dyker samma deltagare upp två gånger – en gång
        // som bana högst upp och en gång som svart låda längst ned.
        const internMottagare =
          mottagare !== undefined &&
          [...lanes.values()].some((l) => l.id === mottagare || l.title === mottagare);
        if (internMottagare) {
          // STRIKT BPMN: inget meddelandeflöde inom poolen. Mottagaren deltar i
          // processen, så kommunikationen ska vara ett SEKVENSFLÖDE till hens
          // mottagningssteg. Det ordnas i `pairMessageSteps`, som flyttar
          // mottagningen till direkt efter utskicket. Saknas ett sådant steg
          // finns inget att rita – då säger vi det i stället för att tiga.
          const harMottagning = draft.steps.some(
            (x) =>
              x.type === "notification" &&
              x.messageDirection === "receive" &&
              x.laneId === mottagare,
          );
          if (!harMottagning) {
            model.meta.warnings.push(
              `"${step.text}" går till ${mottagare}, som deltar i processen. ` +
                `Lägg till ett mottagningssteg i ${mottagare}-banan så blir kopplingen ett sekvensflöde.`,
            );
          }
        }
        if (mottagare && !internMottagare) {
          const pool = mottagarpool(mottagare);
          const stilar = edgeStyleFor(draft, step.id, pool.id);
          messageFlows.push({
            id: `mf${++artefaktN}`,
            nodeId: step.id,
            poolId: pool.id,
            sourceSide: stilar?.sourceSide,
            // Var på bandet pilen landar. Saknas = rakt under avsändaren.
            targetPos: stilar?.targetPos,
            label: stilar?.label,
            // Finns en brytpunkt gäller den framför den raka vägen ner till
            // mottagarbandet – automatiken är ett förval, inte ett förbud.
            waypoint: stilar?.waypoint,
            perspectives: ["business", "system"],
          });
        }
      }

      // FRITT objekt: ritas, men kedjas varken in eller vidare, och får inget
      // auto-slut. Det ligger där tills man drar en koppling till eller från det.
      if (fria.has(step.id)) {
        klippta.add(step.id);
        continue;
      }
      for (const m of merges) addEdge(m.id, step.id, m.label);

      if (step.type === "decision") {
        const labels = branchLabels.get(step.id) ?? [];
        if (labels.length === 0) {
          // Beslut utan grenar – flödet fortsätter rakt fram.
          merges = [{ id: step.id }];
        } else {
          const exits: MergePoint[] = [];
          for (const label of labels) {
            const tail = compileChain(branchScope(step.id, label), [{ id: step.id, label }]);
            exits.push(...tail);
          }
          // Endast en uttalad gren → motsatta vägen faller igenom till nästa steg.
          if (labels.length === 1)
            exits.push({ id: step.id, label: step.motsattEtikett ?? complementLabel(labels[0]) });
          merges = exits;
        }
      } else if (step.type === "end" && step === kedja[kedja.length - 1]) {
        // ETT SLUT ÄR ETT SLUT. Står det sist i sin kedja lämnar det ingen
        // öppen utgång – annars återförenades grenen med nästa steg i
        // huvudflödet, slutet fick en pil ut och gjordes om till en aktivitet
        // ("Inget att ta vidare" i Innovation - demo, 2026-10-01). Ett slut
        // MITT i en kedja lämnas som förut: där säger stegen efter emot det.
        merges = [];
      } else {
        merges = [{ id: step.id }];
      }
    }
    return merges;
  }

  const finalExits = compileChain("", []);

  // Ligger ett beslut sist i flödet finns en öppen, MÄRKT utgång ("Nej") som
  // inget efterföljande steg fångar upp. Då samlas alla öppna utgångar i ett
  // gemensamt slut-event – annars skulle Nej-vägen tyst försvinna och
  // gatewayen se ut att bara ha en väg.
  if (finalExits.some((m) => m.label)) {
    // Stabilt id: det finns högst ETT gemensamt slut per flöde, så namnet kan
    // aldrig förskjutas till en annan nod (jfr end_<nodId> i normalizeFlowEvents).
    const endId = "end_final";
    nodes.push({
      id: endId,
      type: "end",
      label: draft.autoLabels?.[endId] ?? "Klart",
      // Banan kommer ur DET SOM LEDER IN i slutet, inte ur kompilerings-
      // ordningen. `nodes[nodes.length - 1]` stod här förut: den senast
      // kompilerade noden är ofta ett grensteg i en annan bana, och slutet
      // hamnade då i en bana som ingen pil går till.
      laneId: draft.autoLanes?.[endId] ?? banaFörSlut(finalExits, nodes, edges) ?? portalbana(),
      sourceIndex: -1,
      perspectives: ["business", "system"],
      position: draft.autoPositions?.[endId] ?? null,
    });
    for (const m of finalExits) addEdge(m.id, endId, m.label);
  }

  // Grensteg vars beslut saknas (t.ex. beslutet raderades i mellanlagret):
  // kedja in dem sist i huvudflödet så inget tappas tyst.
  for (const s of draft.steps) {
    if (!emitted.has(s.id)) {
      emitted.add(s.id);
      nodes.push({
        id: s.id,
        type: s.type,
        label: s.text,
        laneId: s.laneId,
        gateway: s.type === "decision" ? (s.gateway ?? "exclusive") : undefined,
        sourceIndex: s.sourceIndex,
        sourceText: s.sourceText,
        perspectives: s.perspectives ?? laneDefaultPerspectives(s.laneId),
        position: null,
      });
      model.meta.warnings.push(`Steget "${s.text}" saknar beslut att hänga under.`);
    }
  }

  assignLaneRows(nodes, draft, branchLabels);

  model.nodes = nodes;
  model.edges = edges;
  model.pools = pools;
  model.dataStores = dataStores;
  model.dataAssociations = dataAssociations;
  model.messageFlows = messageFlows;

  // ---- Manuellt dragna kopplingar. Sorten härleds ur vad ändarna ÄR, så att
  // användaren bara behöver dra en linje – inte välja typ i en dialog.
  const lagerIds = new Set(dataStores.map((x) => x.id));
  const poolIds = new Set(pools.filter((p) => p.blackBox).map((p) => p.id));
  for (const e of draft.extraEdges ?? []) {
    /**
     * INGEN borttagningskontroll här. En handritad koppling finns för att
     * användaren ritade den; att ta bort en sådan RADERAR posten (se
     * `removeEdge`), medan `removedEdges` bara undertrycker HÄRLEDDA pilar.
     *
     * Kontrollen låg här förut och gav ett fel som såg ut som magi: hade man
     * tidigare tagit bort ett besluts grenpilar låg deras nycklar kvar
     * (`s8->s11#Ja`, `s8->s11#Nej`). Drog man sedan en egen koppling mellan
     * samma par och döpte den till "Ja" – det man naturligt skriver på en pil
     * ut ur ett beslut – träffade etiketten den gamla nyckeln, och BÅDE
     * kopplingen och etiketten försvann i samma ögonblick som man skrev den.
     * Grenpilarna är egna kanter och undertrycks fortfarande, i `addEdge`.
     */
    const flaggor = refFlaggor(draft, e.source, e.target);
    if (lagerIds.has(e.source) || lagerIds.has(e.target)) {
      const skriver = lagerIds.has(e.target);
      const nodId = skriver ? e.source : e.target;
      const lagerId = skriver ? e.target : e.source;
      // Kopplingen kan redan finnas härledd: skrivaren till ett datalager är
      // alltid närmast föregående utförare. Drar användaren samma linje för
      // hand ska den INTE bli en andra pil ovanpå den första – två identiska
      // streckade kopplingar såg ut som en tjock, skev linje och gick bara att
      // ta bort en i taget.
      const fanns = dataAssociations.some(
        (a) =>
          a.nodeId === nodId &&
          a.dataStoreId === lagerId &&
          a.direction === (skriver ? "write" : "read"),
      );
      if (fanns) continue;
      const sidor = edgeStyleFor(draft, e.source, e.target);
      dataAssociations.push({
        id: `da${++artefaktN}`,
        nodeId: skriver ? e.source : e.target,
        dataStoreId: skriver ? e.target : e.source,
        direction: skriver ? "write" : "read",
        ...flaggor,
        sourceSide: sidor?.sourceSide,
        targetSide: sidor?.targetSide,
        waypoint: sidor?.waypoint,
        // En HANDRITAD association bär etiketten på sin egen post; en härledd
        // har ingen sådan och får den ur kantens presentationsval. Läste bara
        // det senare skrevs etiketten men syntes aldrig.
        label: e.label ?? sidor?.label,
        perspectives: ["business", "system"],
      });
    } else if (poolIds.has(e.target)) {
      const mfStilar = edgeStyleFor(draft, e.source, e.target);
      messageFlows.push({
        id: `mf${++artefaktN}`,
        nodeId: e.source,
        poolId: e.target,
        label: e.label ?? mfStilar?.label,
        sourceSide: mfStilar?.sourceSide,
        targetPos: mfStilar?.targetPos,
        waypoint: mfStilar?.waypoint,
        perspectives: ["business", "system"],
      });
    } else {
      /**
       * Finns redan en pil mellan paret ska den handritade INTE bli en andra
       * ovanpå den. Samma hållning som för datalagren ovan.
       *
       * En OMÄRKT handritad pil på ett par som redan har en märkt (t.ex.
       * grenkanten "Nej") gav två pilar längs samma väg, varav bara den ena bar
       * etikett – exakt det som såg ut som att Nej-etiketten hade försvunnit.
       * Två pilar mellan samma par är däremot HELT giltigt när båda är grenar
       * ("Ja" och "Nej" till samma steg), och det fallet rörs inte: en
       * handritad kant bär aldrig etikett.
       */
      if (!e.label && edges.some((x) => x.source === e.source && x.target === e.target)) continue;
      const sides = edgeStyleFor(draft, e.source, e.target, e.label);
      edges.push({
        id: `e${++edgeN}`,
        source: e.source,
        target: e.target,
        label: e.label,
        sourceSide: sides?.sourceSide,
        targetSide: sides?.targetSide,
        waypoint: sides?.waypoint,
        labelPos: sides?.labelPos,
        ...flaggor,
        perspectives: ["business", "system"],
      });
    }
  }

  // ---- Borttagna streckade kopplingar undertrycks på samma nyckel som
  // sekvensflödena: nodparet.
  model.dataAssociations = dataAssociations.filter(
    (a) =>
      !borttagna.has(
        a.direction === "write" ? edgeKey(a.nodeId, a.dataStoreId) : edgeKey(a.dataStoreId, a.nodeId),
      ),
  );
  model.messageFlows = messageFlows.filter((f) => !ärBorttagen(borttagna, f.nodeId, f.poolId, f.label));
  normalizeFlowEvents(
    model,
    klippta,
    draft.autoLabels,
    draft.autoPositions,
    borttagna,
    draft.autoLanes,
    draft.edgeStyles,
  );
  model.swimlanes = [...lanes.values()]
    .sort((a, b) => a.order - b.order)
    .map((l) => ({ ...l, poolId: huvudpool.id }));

  // ---- Manuellt valda delar (dragen mellan bilder i flersidigt läge).
  // Läggs på sist så att även auto-noder (slut-event) kan pinnas.
  if (draft.pagePins) {
    for (const n of model.nodes) {
      const pin = draft.pagePins[n.id];
      if (pin !== undefined) n.pagePin = pin;
    }
  }

  return model;
}

/**
 * BPMN-korrigering av start/slut-event utifrån flödets STRUKTUR:
 *  - ett "slut" som har ett nästa steg degraderas till aktivitet,
 *  - ett "start" med inkommande flöde degraderas till aktivitet,
 *  - varje terminal utan slut får ett automatiskt slut-event "Klart".
 * Auto-eventen är notation (sourceIndex −1), inte uppfunna aktiviteter.
 *
 * ID-STABILITET: auto-slutets id härleds ur noden det hänger på (`end_<nodId>`),
 * ALDRIG ur en räknare. Räknar-id:n (auto1, auto2 …) förskjöts så fort en ny
 * terminal dök upp tidigare i flödet – och eftersom namn, läge, bana och
 * borttagna pilar nycklas på id:t hoppade användarens ändringar då tyst över
 * till FEL slut-event. Ett härlett id kan inte förskjutas.
 */
export function normalizeFlowEvents(
  model: ProcessModel,
  /** Noder som medvetet klippts av – de ska inte få auto-slut. */
  skipAutoEnd: Set<string> = new Set(),
  /** Omdöpta auto-noder, keyade på nod-id (se ProcessDraft.autoLabels). */
  autoLabels: Record<string, string> = {},
  /** Flyttade auto-noder, keyade på nod-id (se ProcessDraft.autoPositions). */
  autoPositions: Record<string, { x: number; y: number } | null> = {},
  /** Bortvalda kopplingar som `edgeKey`. Ett bortvalt auto-slut återskapas inte. */
  removedEdges: Set<string> = new Set(),
  /** Banbyten för auto-noder, keyade på nod-id (se ProcessDraft.autoLanes). */
  autoLanes: Record<string, string> = {},
  /**
   * Kantens presentationsval. Auto-slutets pil skapas HÄR och inte via
   * `addEdge`, så utan den här uppslagningen gick den inte att sätta etikett på
   * – man skrev, och ingenting hände.
   */
  edgeStyles: Record<string, EdgeSides> = {},
) {
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  for (const n of model.nodes) {
    outCount.set(n.id, 0);
    inCount.set(n.id, 0);
  }
  for (const e of model.edges) {
    outCount.set(e.source, (outCount.get(e.source) ?? 0) + 1);
    inCount.set(e.target, (inCount.get(e.target) ?? 0) + 1);
  }

  for (const n of model.nodes) {
    if (n.type === "end" && (outCount.get(n.id) ?? 0) > 0) n.type = "activity";
    if (n.type === "start" && (inCount.get(n.id) ?? 0) > 0) n.type = "activity";
  }

  const terminals = model.nodes.filter(
    (n) => (outCount.get(n.id) ?? 0) === 0 && n.type !== "end" && !skipAutoEnd.has(n.id),
  );
  for (const t of terminals) {
    const endId = `end_${t.id}`;
    model.nodes.push({
      id: endId,
      type: "end",
      label: autoLabels[endId] ?? "Klart",
      laneId: autoLanes[endId] ?? t.laneId,
      sourceIndex: -1,
      perspectives: ["business", "system"],
      position: autoPositions[endId] ?? null,
    });
    // Har användaren tagit bort just den här kopplingen ritas PILEN inte, men
    // slut-noden får ligga kvar där den var – annars såg det ut som att den
    // försvann. Att radera pilen klipper flödet; noden blir hängande och det
    // syns i BPMN-kontrollen.
    if (removedEdges.has(edgeKey(t.id, endId))) continue;
    const stil = edgeStyles[edgeKey(t.id, endId)];
    model.edges.push({
      id: `${endId}-e`,
      source: t.id,
      target: endId,
      label: stil?.label,
      sourceSide: stil?.sourceSide,
      targetSide: stil?.targetSide,
      waypoint: stil?.waypoint,
      labelPos: stil?.labelPos,
      perspectives: ["business", "system"],
    });
  }
}

/*
 * BORTTAGET: markMessageFlows().
 *
 * Den satte kind="message" (streckad) på varje kant till eller från en
 * notifiering. Det är ett formellt BPMN-fel: ett meddelandeflöde får ENDAST
 * gå mellan olika deltagare (pooler), aldrig mellan två objekt i samma pool.
 * Inom poolen är allt sekvensflöde. Meddelanden till andra parter ligger nu i
 * `model.messageFlows` och pekar på en mottagarpool.
 */

/* ------------------------------------------------------------------ */
/* Redigeringshjälpare för mellanlagret (rena funktioner, testbara).   */
/* ------------------------------------------------------------------ */

/**
 * Ordnar om stegen till "trädordning": varje beslut följs direkt av sina
 * grensteg (rekursivt). Kompileringen bryr sig inte om ordningen mellan
 * scope, men mellanlagrets UI och flyttfunktionen gör det – ett beslut och
 * dess grenar ska hänga ihop som ett block.
 */
export function normalizeOrder(draft: ProcessDraft): ProcessDraft {
  const byScope = new Map<string, DraftStep[]>();
  for (const s of draft.steps) {
    const key = scopeKey(s);
    const list = byScope.get(key);
    if (list) list.push(s);
    else byScope.set(key, [s]);
  }
  const labelsOf = (stepId: string) =>
    [...byScope.keys()]
      .filter((k) => k.startsWith(branchScope(stepId, "")))
      .sort(
        (a, b) =>
          draft.steps.findIndex((s) => scopeKey(s) === a) -
          draft.steps.findIndex((s) => scopeKey(s) === b),
      );

  const out: DraftStep[] = [];
  const seen = new Set<string>();
  const walk = (key: string) => {
    for (const s of byScope.get(key) ?? []) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
      for (const childKey of labelsOf(s.id)) walk(childKey);
    }
  };
  walk("");
  // Föräldralösa grensteg sist, så inget tappas.
  for (const s of draft.steps) if (!seen.has(s.id)) out.push(s);

  // Var ordningen redan rätt: returnera SAMMA objekt. Anropare kan då
  // jämföra med === för att avgöra om något faktiskt ändrades, i stället för
  // att markera flödet som ändrat varje gång panelen råkar rita om sig.
  const oförändrad = out.every((s, i) => s === draft.steps[i]);
  return oförändrad ? draft : { ...draft, steps: out };
}

/** Sista index i steg-blocket som börjar på `i` (steget + alla dess grensteg). */
function blockEnd(steps: DraftStep[], i: number): number {
  const ids = new Set([steps[i].id]);
  let j = i + 1;
  while (j < steps.length && steps[j].branchOf && ids.has(steps[j].branchOf!.stepId)) {
    ids.add(steps[j].id);
    j++;
  }
  return j - 1;
}

/**
 * Flyttar ett steg upp/ned bland sina syskon i samma scope. Ett beslut flyttas
 * som ett block – dess grensteg följer med, annars skulle grenen se ut att
 * hoppa till ett annat beslut i listan.
 */
export function moveStep(draft: ProcessDraft, stepId: string, dir: -1 | 1): ProcessDraft {
  const ordered = normalizeOrder(draft);
  const steps = [...ordered.steps];
  const i = steps.findIndex((s) => s.id === stepId);
  if (i === -1) return draft;
  const key = scopeKey(steps[i]);
  const end = blockEnd(steps, i);

  if (dir === 1) {
    const k = end + 1; // nästa syskonblock börjar direkt efter detta
    if (k >= steps.length || scopeKey(steps[k]) !== key) return draft;
    const kEnd = blockEnd(steps, k);
    const a = steps.slice(i, end + 1);
    const b = steps.slice(k, kEnd + 1);
    steps.splice(i, kEnd - i + 1, ...b, ...a);
  } else {
    // Föregående syskon: närmaste tidigare steg i samma scope. Dess block
    // slutar per definition precis före detta block.
    let p = i - 1;
    while (p >= 0 && scopeKey(steps[p]) !== key) p--;
    if (p < 0) return draft;
    const a = steps.slice(i, end + 1);
    const b = steps.slice(p, i);
    steps.splice(p, end - p + 1, ...a, ...b);
  }

  return { ...ordered, steps, meta: { ...draft.meta, origin: "manual" } };
}

/**
 * Flyttar ett steg till en ny plats i listan – motsvarar dra-och-släpp.
 *
 * `targetIndex` är platsen i den trädordnade listan där steget ska hamna
 * (0 = först, steps.length = sist). Två saker avgörs av var man släpper:
 *
 *  1. ORDNINGEN – steget (och dess grensteg, om det är ett beslut) flyttas dit.
 *  2. TILLHÖRIGHETEN – steget ärver scope från grannen det landar före. Släpper
 *     man mitt i en Ja-gren blir steget en del av grenen; släpper man i
 *     huvudflödet lämnar det grenen. Det är hela poängen med att kunna dra:
 *     man ska kunna flytta ett steg IN i och UT ur en gren utan omvägar.
 *
 * Att släppa ett beslut inuti sitt eget block ignoreras – det skulle göra
 * beslutet till sin egen förälder och kapa grenen.
 */
export function moveStepTo(draft: ProcessDraft, stepId: string, targetIndex: number): ProcessDraft {
  const ordered = normalizeOrder(draft);
  const steps = ordered.steps;
  const from = steps.findIndex((s) => s.id === stepId);
  if (from === -1) return draft;

  const end = blockEnd(steps, from);
  // Släpp inuti det egna blocket (eller på samma plats) = ingen ändring.
  if (targetIndex > from && targetIndex <= end + 1) return draft;
  if (targetIndex === from) return draft;

  const block = steps.slice(from, end + 1);
  const rest = [...steps.slice(0, from), ...steps.slice(end + 1)];
  // Index i listan UTAN blocket.
  const insertAt = targetIndex > end ? targetIndex - block.length : targetIndex;

  // Scope ärvs från steget man landar EFTER – man släpper "under" något.
  // (Att i stället ärva från steget man landar före gör det omöjligt att
  // släppa sist i en gren: man skulle alltid hamna i det som följer efter
  // grenen.) Släpp överst i listan → huvudflödet.
  const newBranch = insertAt > 0 ? rest[insertAt - 1].branchOf : undefined;

  const moved: DraftStep[] = block.map((s, i) =>
    // Bara det dragna steget byter scope – grenstegen hänger kvar under det.
    i === 0 ? { ...s, branchOf: newBranch } : s,
  );

  rest.splice(insertAt, 0, ...moved);
  return { ...ordered, steps: rest, meta: { ...draft.meta, origin: "manual" } };
}

/** Uppdaterar ett steg. */
export function updateStep(
  draft: ProcessDraft,
  stepId: string,
  patch: Partial<DraftStep>,
): ProcessDraft {
  return {
    ...draft,
    steps: draft.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
    meta: { ...draft.meta, origin: "manual" },
  };
}

/**
 * Döper om en auto-nod (ett slut-event som notationen lade till). Noden är inget
 * steg i mellanlagret, så namnet sparas som ett åsidosättande på nod-id och läggs
 * på vid kompileringen. Tomt namn nollar åsidosättandet (tillbaka till "Klart").
 */
export function setAutoLabel(
  draft: ProcessDraft,
  nodeId: string,
  label: string,
): ProcessDraft {
  const autoLabels = { ...draft.autoLabels };
  const trimmed = label.trim();
  if (trimmed) autoLabels[nodeId] = trimmed;
  else delete autoLabels[nodeId];
  return { ...draft, autoLabels, meta: { ...draft.meta, origin: "manual" } };
}

/**
 * Textstorlek för ETT objekt (faktor, 1 = normal).
 *
 * Steg bär sin egen (`step.textSize`); allt annat på ytan – satelliter,
 * insprängda verksamhetsobjekt, auto-slut och fria objekt – nycklas på sitt
 * härledda id i `autoTextSizes`, precis som namn (`autoLabels`) och lägen
 * (`autoPositions`). Faktorn kläms till 0,5–2 så en felskrivning inte kan göra
 * texten osynlig eller större än diagrammet.
 */
export function setTextSize(draft: ProcessDraft, nodeId: string, faktor: number | null): ProcessDraft {
  const klämd = faktor === null ? null : Math.min(2, Math.max(0.5, faktor));
  const steg = draft.steps.find((s) => s.id === nodeId);
  if (steg) {
    return updateStep(draft, nodeId, { textSize: klämd ?? undefined });
  }
  const autoTextSizes = { ...draft.autoTextSizes };
  if (klämd === null || klämd === 1) delete autoTextSizes[nodeId];
  else autoTextSizes[nodeId] = klämd;
  return { ...draft, autoTextSizes, meta: { ...draft.meta, origin: "manual" } };
}

/** Nuvarande textstorlek för ett objekt (1 = normal). */
export function textSizeFor(draft: ProcessDraft, nodeId: string): number {
  const steg = draft.steps.find((s) => s.id === nodeId);
  return steg?.textSize ?? draft.autoTextSizes?.[nodeId] ?? 1;
}

/** Tar bort ett steg. Grensteg som hängde under det blir huvudflödessteg. */
export function removeStep(draft: ProcessDraft, stepId: string): ProcessDraft {
  const steps = draft.steps
    .filter((s) => s.id !== stepId)
    .map((s) => (s.branchOf?.stepId === stepId ? { ...s, branchOf: undefined } : s));
  return { ...draft, steps, meta: { ...draft.meta, origin: "manual" } };
}

/** Lägger till ett steg efter ett givet steg (eller sist om index saknas). */
export function addStepAfter(
  draft: ProcessDraft,
  afterId: string | null,
  step: Omit<DraftStep, "id" | "sourceIndex"> & Partial<Pick<DraftStep, "sourceIndex">>,
): ProcessDraft {
  const id = nextStepId(draft);
  const created: DraftStep = { id, sourceIndex: -1, ...step };
  const steps = [...draft.steps];
  const i = afterId ? steps.findIndex((s) => s.id === afterId) : -1;
  if (i === -1) steps.push(created);
  else steps.splice(i + 1, 0, created);
  return { ...draft, steps, meta: { ...draft.meta, origin: "manual" } };
}

/**
 * Lägger ett FRITT objekt på ytan – placerat ur verktygsraden.
 *
 * Objektet ritas men kedjas inte in: flödet ritas inte om, och ingenting ser ut
 * att försvinna. Det knyts in först när man drar en koppling till eller från det
 * (se `knytIn`). Samma princip som affärsprocesspalettens placering.
 */
export function läggTillFritt(
  draft: ProcessDraft,
  step: Omit<DraftStep, "id" | "sourceIndex">,
): { draft: ProcessDraft; id: string } {
  const id = nextStepId(draft);
  const created: DraftStep = { id, sourceIndex: -1, ...step };
  return {
    draft: {
      ...draft,
      steps: [...draft.steps, created],
      fria: [...(draft.fria ?? []), id],
      meta: { ...draft.meta, origin: "manual" },
    },
    id,
  };
}

/**
 * Knyter in ett fritt objekt – det slutar vara fritt.
 *
 * Anropas när en koppling dras till eller från objektet: DÅ har användaren sagt
 * var det hör hemma, och kedjan får räknas om. Objekt som inte är fria rörs inte.
 */
export function knytIn(
  draft: ProcessDraft,
  ids: string[],
  /**
   * Kopplingen användaren just ritade. Den automatiska kedjepilen IN till
   * objektet undertrycks – annars får man två pilar in: sin egen och den som
   * följer av att objektet ligger sist i ordningen. Är den ritade pilen just
   * kedjepilen behålls den förstås.
   */
  ritad?: { source: string; target: string },
): ProcessDraft {
  const fria = draft.fria ?? [];
  const kvar = fria.filter((id) => !ids.includes(id));
  if (kvar.length === fria.length) return draft;

  const borttagna = new Set(draft.removedEdges ?? []);
  for (const id of ids) {
    if (!fria.includes(id)) continue;
    // Föregående steg i ordningen som INTE också är fritt – det är därifrån
    // kedjepilen skulle komma.
    const i = draft.steps.findIndex((s) => s.id === id);
    for (let j = i - 1; j >= 0; j--) {
      const före = draft.steps[j];
      if (fria.includes(före.id)) continue;
      if (!(ritad && ritad.source === före.id && ritad.target === id)) {
        borttagna.add(edgeKey(före.id, id));
      }
      break;
    }
  }
  return {
    ...draft,
    fria: kvar.length ? kvar : undefined,
    removedEdges: borttagna.size ? [...borttagna] : draft.removedEdges,
  };
}

/** Nästa lediga steg-id (s1, s2, …). */
export function nextStepId(draft: ProcessDraft): string {
  let max = 0;
  for (const s of draft.steps) {
    const m = s.id.match(/^s(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `s${max + 1}`;
}

/** Sätter (eller nollar) ett stegs manuella position. */
export function setStepPosition(
  draft: ProcessDraft,
  stepId: string,
  position: { x: number; y: number } | null,
): ProcessDraft {
  return {
    ...draft,
    steps: draft.steps.map((s) => (s.id === stepId ? { ...s, position } : s)),
  };
}

/**
 * Sätter (eller nollar) en auto-nods manuella position. Auto-noder är inga steg,
 * så läget sparas som ett åsidosättande på nod-id (se setAutoLabel). null nollar.
 */
export function setAutoPosition(
  draft: ProcessDraft,
  nodeId: string,
  position: { x: number; y: number } | null,
): ProcessDraft {
  const autoPositions = { ...draft.autoPositions };
  if (position) autoPositions[nodeId] = position;
  else delete autoPositions[nodeId];
  return { ...draft, autoPositions };
}

/** Flyttar (eller återställer, null) en ruta i den avskalade presentationsbilden. */
export function setPresentationsLäge(
  draft: ProcessDraft,
  nodeId: string,
  läge: { x: number; y: number } | null,
): ProcessDraft {
  const lägen = { ...draft.presentation?.lägen };
  if (läge) lägen[nodeId] = { x: Math.round(läge.x), y: Math.round(läge.y) };
  else delete lägen[nodeId];
  return { ...draft, presentation: { ...draft.presentation, lägen } };
}

/**
 * Sätter (eller återställer, null) var en koppling lämnar eller går in i sin
 * ruta i den avskalade presentationsbilden. `nyckel` är kantnyckeln med
 * etiketten (invariant 3) – Ja och Nej mellan samma par är olika kopplingar.
 */
export function setPresentationsKoppling(
  draft: ProcessDraft,
  nyckel: string,
  ände: "source" | "target",
  val: { side: EdgeSide; pos: number } | null,
): ProcessDraft {
  const kopplingar = { ...draft.presentation?.kopplingar };
  const k = { ...kopplingar[nyckel] };
  if (ände === "source") {
    if (val) Object.assign(k, { sourceSide: val.side, sourcePos: val.pos });
    else {
      delete k.sourceSide;
      delete k.sourcePos;
    }
  } else if (val) Object.assign(k, { targetSide: val.side, targetPos: val.pos });
  else {
    delete k.targetSide;
    delete k.targetPos;
  }
  if (Object.keys(k).length) kopplingar[nyckel] = k;
  else delete kopplingar[nyckel];
  return { ...draft, presentation: { ...draft.presentation, kopplingar } };
}

/**
 * Flyttar en auto-nod till en annan simbana. Auto-noder är inga steg, så bytet
 * sparas som ett åsidosättande på nod-id (se setAutoLabel). Den gamla positionen
 * nollas – den låg i den förra banans koordinatram och hör inte hemma i den nya.
 */
export function setAutoLane(draft: ProcessDraft, nodeId: string, laneId: string): ProcessDraft {
  const autoLanes = { ...draft.autoLanes, [nodeId]: laneId };
  const autoPositions = { ...draft.autoPositions };
  delete autoPositions[nodeId];
  return { ...draft, autoLanes, autoPositions, meta: { ...draft.meta, origin: "manual" } };
}

/**
 * Sätter (eller nollar, med undefined) textstorlek/-placering för ett steg.
 * Gäller mellanlagrets steg – auto-noder har bara ordet "Klart" och behöver
 * ingen textstyrning.
 */
export function setTextStyle(
  draft: ProcessDraft,
  stepId: string,
  patch: { textSize?: number; textPlacement?: TextPlacement },
): ProcessDraft {
  return {
    ...draft,
    steps: draft.steps.map((s) =>
      s.id === stepId
        ? {
            ...s,
            textSize: "textSize" in patch ? patch.textSize : s.textSize,
            textPlacement: "textPlacement" in patch ? patch.textPlacement : s.textPlacement,
          }
        : s,
    ),
    meta: { ...draft.meta, origin: "manual" },
  };
}

/**
 * Pinnar en nod till en viss DEL i flersidigt läge (null tar bort pinnen).
 * Positionen nollas – den låg i den förra delens koordinatram. Hänvisningar
 * och kopplingar räknas om automatiskt vid nästa kompilering.
 */
export function setPagePin(draft: ProcessDraft, nodeId: string, page: number | null): ProcessDraft {
  const pagePins = { ...draft.pagePins };
  if (page === null) delete pagePins[nodeId];
  else pagePins[nodeId] = page;
  const steps = draft.steps.map((s) => (s.id === nodeId && s.position ? { ...s, position: null } : s));
  const autoPositions = { ...draft.autoPositions };
  delete autoPositions[nodeId];
  return { ...draft, steps, pagePins, autoPositions, meta: { ...draft.meta, origin: "manual" } };
}

/** Nollar alla manuella positioner – "återställ layout". */
export function clearPositions(draft: ProcessDraft): ProcessDraft {
  return {
    ...draft,
    steps: draft.steps.map((s) => ({ ...s, position: null })),
    autoPositions: {},
    pagePins: {},
  };
}

/**
 * Sätter kopplingspunkter för en kant. Tomma sidor tas bort helt så att
 * kanten faller tillbaka på geometriregeln i stället för att låsas fast.
 */
export function setEdgeSides(
  draft: ProcessDraft,
  source: string,
  target: string,
  sides: EdgeSides,
  /** Kantens etikett – skiljer två pilar mellan samma nodpar åt. */
  label?: string,
): ProcessDraft {
  const key = edgeKey(source, target, label);
  const next = { ...(draft.edgeStyles ?? {}) };
  const förra = next[key];
  const merged: EdgeSides = { ...förra, ...sides };
  /**
   * BYTER MAN SIDA SLÄPPS BRYTPUNKTEN.
   *
   * Brytpunkten sattes för den GAMLA vägen. Behölls den när man flyttade en
   * kopplingspunkt till en annan sida tvingades vägen fortfarande genom den
   * gamla punkten – och eftersom en manuell brytpunkt stänger av väjningen
   * skar linjen rakt genom målobjektet. Det såg ut som att sidobytet inte gick
   * att göra, fast valet sparades.
   *
   * Bara ett verkligt BYTE räknas: att sätta samma sida igen, eller att bara
   * flytta punkten längs sidan (`sourcePos`/`targetPos`), rör inte böjen.
   */
  const bytteSida =
    (sides.sourceSide !== undefined && sides.sourceSide !== förra?.sourceSide) ||
    (sides.targetSide !== undefined && sides.targetSide !== förra?.targetSide);
  if (bytteSida) {
    delete merged.waypoint;
    delete merged.waypoint2;
  }
  if (edgeStyleEmpty(merged)) delete next[key];
  else next[key] = merged;
  return { ...draft, edgeStyles: next };
}

/** Sant när en edge-stil inte längre bär något manuellt val och kan tas bort. */
function edgeStyleEmpty(s: EdgeSides): boolean {
  return (
    !s.sourceSide &&
    !s.targetSide &&
    s.sourcePos === undefined &&
    s.targetPos === undefined &&
    !s.label &&
    !s.waypoint &&
    !s.waypoint2 &&
    s.labelPos === undefined &&
    !s.hideRefIn &&
    !s.hideRefOut
  );
}

/**
 * Sätter (eller nollar) etikettens läge längs kanten, som andel 0–1.
 * `null` återställer till den automatiska placeringen (`labelAnchor`).
 */
export function setEdgeLabelPos(
  draft: ProcessDraft,
  source: string,
  target: string,
  andel: number | null,
  label?: string,
): ProcessDraft {
  const key = edgeKey(source, target, label);
  const next = { ...(draft.edgeStyles ?? {}) };
  const merged: EdgeSides = { ...next[key] };
  if (andel === null) delete merged.labelPos;
  else merged.labelPos = Math.min(1, Math.max(0, andel));
  if (edgeStyleEmpty(merged)) delete next[key];
  else next[key] = merged;
  return { ...draft, edgeStyles: next };
}

/**
 * Sätter (eller nollar) en kants manuella brytpunkt, i fri-layoutens koordinater.
 * null tar bort brytpunkten så att kanten routas automatiskt igen. Kopplings-
 * punkterna (sourceSide/targetSide) lämnas orörda.
 */
export function setEdgeWaypoint(
  draft: ProcessDraft,
  source: string,
  target: string,
  point: { x: number; y: number } | null,
  /** Kantens etikett – skiljer två pilar mellan samma nodpar åt. */
  label?: string,
): ProcessDraft {
  const key = edgeKey(source, target, label);
  const next = { ...(draft.edgeStyles ?? {}) };
  const merged: EdgeSides = { ...next[key] };
  if (point) merged.waypoint = point;
  else {
    // Utan första punkten betyder den andra ingenting – den försvinner med.
    delete merged.waypoint;
    delete merged.waypoint2;
  }
  if (edgeStyleEmpty(merged)) delete next[key];
  else next[key] = merged;
  return { ...draft, edgeStyles: next, meta: { ...draft.meta, origin: "manual" } };
}

/**
 * Sätter (eller nollar) kantens ANDRA brytpunkt – var sista sträckan in i
 * målet går. Kräver en första brytpunkt; utan den görs ingenting.
 */
export function setEdgeWaypoint2(
  draft: ProcessDraft,
  source: string,
  target: string,
  point: { x: number; y: number } | null,
  /** Kantens etikett – skiljer två pilar mellan samma nodpar åt. */
  label?: string,
): ProcessDraft {
  const key = edgeKey(source, target, label);
  const förra = draft.edgeStyles?.[key];
  if (!förra?.waypoint) return draft;
  const merged: EdgeSides = { ...förra };
  if (point) merged.waypoint2 = point;
  else delete merged.waypoint2;
  return {
    ...draft,
    edgeStyles: { ...draft.edgeStyles, [key]: merged },
    meta: { ...draft.meta, origin: "manual" },
  };
}

/** Tar bort manuella kopplingspunkter OCH brytpunkt för en kant (tillbaka till automatik). */
export function resetEdgeSides(
  draft: ProcessDraft,
  source: string,
  target: string,
  label?: string,
): ProcessDraft {
  const next = { ...(draft.edgeStyles ?? {}) };
  // Båda nyckelformerna städas – annars ligger en gammal par-nyckel kvar som reserv.
  delete next[edgeKey(source, target)];
  if (label) delete next[edgeKey(source, target, label)];
  return { ...draft, edgeStyles: next };
}

/** Tar bort en koppling ur diagrammet (undertrycks vid kompilering). */
/**
 * Lägger till en koppling som användaren dragit.
 *
 * Har samma par tagits bort tidigare räcker det att ta tillbaka det – annars
 * skulle borttagningen fortsätta undertrycka den nya kopplingen.
 */
/**
 * Varför två objekt INTE går att koppla ihop, eller null när de går.
 *
 * BPMN: ett slut-event har inget utgående flöde, och ett start-event inget
 * inkommande. Utan spärren ritades pilen ändå, och kompileringen degraderade då
 * slutet till en aktivitet för att modellen skulle gå ihop – man drog en
 * koppling och fick sitt "Klart" förvandlat, utan att något sade varför.
 */
export function kopplingHinder(
  draft: ProcessDraft,
  source: string,
  target: string,
): string | null {
  if (source === target) return "En koppling måste gå mellan två olika objekt.";
  const s = draft.steps.find((x) => x.id === source);
  const t = draft.steps.find((x) => x.id === target);
  if (s?.type === "end")
    return `"${s.text}" är ett slut – därifrån går inget flöde vidare. Ändra dess typ först om den ska ha en fortsättning.`;
  if (t?.type === "start")
    return `"${t.text}" är en startpunkt – dit går inget flöde in. Ändra dess typ först om den ska ta emot en koppling.`;
  return null;
}

export function addManualEdge(draft: ProcessDraft, source: string, target: string): ProcessDraft {
  if (kopplingHinder(draft, source, target)) return draft;
  const key = edgeKey(source, target);
  const utanBorttagen = draft.removedEdges?.includes(key)
    ? { ...draft, removedEdges: draft.removedEdges.filter((k) => k !== key) }
    : draft;
  const finns = (utanBorttagen.extraEdges ?? []).some((e) => e.source === source && e.target === target);
  const extra = finns
    ? (utanBorttagen.extraEdges ?? [])
    : [...(utanBorttagen.extraEdges ?? []), { source, target }];
  // Att dra en koppling till eller från ett FRITT objekt är just det val som
  // gjorde det fritt tills vidare – nu vet vi var det hör hemma, så det knyts in.
  const inknutet = knytIn({ ...utanBorttagen, extraEdges: extra }, [source, target], { source, target });
  return { ...inknutet, meta: { ...draft.meta, origin: "manual" } };
}

/**
 * Grenetiketterna ut ur ett beslut, i den ordning de förekommer.
 * UI:t behöver dem för att kunna vägra en omdöpning som krockar med en syskongren.
 */
export function grenEtiketter(draft: ProcessDraft, beslutsId: string): string[] {
  const ut: string[] = [];
  for (const s of draft.steps) {
    const l = s.branchOf?.label;
    if (s.branchOf?.stepId === beslutsId && l && !ut.includes(l)) ut.push(l);
  }
  return ut;
}

/**
 * Namnet på beslutets MOTSATTA väg – den som faller igenom när beslutet bara
 * har en uttalad gren – eller null när det inte finns någon sådan väg.
 * Samma regel som kompileringen använder (`motsattEtikett` före härledningen).
 */
export function motsattGren(draft: ProcessDraft, beslutsId: string): string | null {
  const beslut = draft.steps.find((s) => s.id === beslutsId);
  if (beslut?.type !== "decision") return null;
  const grenar = grenEtiketter(draft, beslutsId);
  if (grenar.length !== 1) return null;
  return beslut.motsattEtikett ?? complementLabel(grenar[0]);
}

/**
 * Varför en etikett INTE går att sätta, eller null när den går.
 * Samma regel som `setEdgeLabel` följer – UI:t frågar först och kan säga varför.
 */
export function etikettHinder(
  draft: ProcessDraft,
  /** Kantens KÄLLA – ett beslut här betyder att etiketten är en gren. */
  source: string,
  nuvarande: string | undefined,
  ny: string,
): string | null {
  const text = ny.trim();
  const motsatt = motsattGren(draft, source);
  const ärGren =
    draft.steps.some((s) => s.branchOf?.stepId === source && s.branchOf.label === nuvarande) ||
    (nuvarande !== undefined && motsatt === nuvarande);
  if (!ärGren) return null; // en handritad pil får vara omärkt
  if (!text) return "En gren måste ha ett svar. Skriv t.ex. Ja eller Nej.";
  const syskon = [...grenEtiketter(draft, source), ...(motsatt ? [motsatt] : [])];
  if (text !== nuvarande && syskon.includes(text))
    return `Beslutet har redan en gren som heter "${text}".`;
  return null;
}

/**
 * Sätter en kants etikett.
 *
 * TVÅ HELT OLIKA SAKER bakom samma gest:
 *
 *  - En GREN. Etiketten är inte en egenskap på pilen, den ÄR grenen: varje steg
 *    i grenen bär `branchOf: { stepId, label }`, och etiketten ingår i nycklarna
 *    för kopplingspunkter och borttagna pilar (`s4->s13#Nej`). En omdöpning måste
 *    därför flytta HELA grenen och migrera nycklarna – annars tappas de sparade
 *    valen tyst, och pilen hoppar tillbaka till automatiskt läge.
 *  - En HANDRITAD pil. Där är etiketten bara ett fält på posten i `extraEdges`,
 *    och tom text betyder ingen etikett.
 *
 * Ogiltig indata (tom grenetikett, krock med en syskongren) lämnar draften
 * orörd – `etikettHinder` säger varför, så UI:t kan visa det innan man skriver.
 */
export function setEdgeLabel(
  draft: ProcessDraft,
  source: string,
  target: string,
  /** Etiketten kanten bär NU – behövs för att hitta rätt gren/pil. */
  nuvarande: string | undefined,
  ny: string,
): ProcessDraft {
  const text = ny.trim();
  if (text === (nuvarande ?? "")) return draft;
  if (etikettHinder(draft, source, nuvarande, ny)) return draft;

  const grenSteg = draft.steps.filter(
    (s) => s.branchOf?.stepId === source && s.branchOf.label === nuvarande,
  );
  const motsatt = motsattGren(draft, source);
  // Den MOTSATTA vägen (regelns "Nej" när bara "Ja" har steg) har inga steg som
  // kan bära etiketten – den bor på beslutet. Nycklarna migreras precis som för
  // en gren med steg.
  const ärMotsatt = grenSteg.length === 0 && nuvarande !== undefined && motsatt === nuvarande;
  if (grenSteg.length > 0 || ärMotsatt) {
    const byt = new Set(grenSteg.map((s) => s.id));
    const steps = draft.steps.map((s) => {
      if (byt.has(s.id)) return { ...s, branchOf: { stepId: source, label: text } };
      if (s.id !== source) return s;
      if (ärMotsatt) return { ...s, motsattEtikett: text };
      // Byter den UTTALADE grenen namn låses den motsatta vid sitt nuvarande:
      // den härleds ur grenen, och "Ja" → "Godkänd" gjorde annars "Nej" till
      // "Annars" – med nycklarna kvar på "#Nej", som ingen läste längre.
      return motsatt && s.motsattEtikett === undefined ? { ...s, motsattEtikett: motsatt } : s;
    });
    /**
     * Migrera nycklar som bär den gamla etiketten. Bara kanter UT ur SAMMA
     * beslut kan bära den – en annan nods "#Nej" är en annan gren.
     *
     * Formatet är `källa->mål` eller `källa->mål#etikett` (se edgeKey), och
     * varken nod-id:n eller "->" innehåller "#", så en delning på sista "#"
     * räcker. En regex på samma sak blev oläslig och lätt att få fel.
     */
    const migrera = (nyckel: string): string => {
      const h = nyckel.lastIndexOf("#");
      if (h === -1) return nyckel;
      if (nyckel.slice(h + 1) !== nuvarande) return nyckel;
      const par = nyckel.slice(0, h);
      const p = par.indexOf("->");
      if (p === -1) return nyckel;
      const a = par.slice(0, p);
      return a === source ? edgeKey(a, par.slice(p + 2), text) : nyckel;
    };
    const edgeStyles = draft.edgeStyles
      ? Object.fromEntries(Object.entries(draft.edgeStyles).map(([k, v]) => [migrera(k), v]))
      : draft.edgeStyles;
    const removedEdges = draft.removedEdges?.map(migrera);
    return { ...draft, steps, edgeStyles, removedEdges, meta: { ...draft.meta, origin: "manual" } };
  }

  // Handritad pil: etiketten är ett fält, tom text = ingen etikett.
  const extra = draft.extraEdges ?? [];
  const i = extra.findIndex(
    (e) => e.source === source && e.target === target && (e.label ?? undefined) === nuvarande,
  );
  if (i === -1) {
    // HÄRLEDD kedjepil: etiketten bor bland kantens presentationsval.
    const key = edgeKey(source, target);
    const next = { ...(draft.edgeStyles ?? {}) };
    const merged: EdgeSides = { ...next[key] };
    if (text) merged.label = text;
    else delete merged.label;
    if (edgeStyleEmpty(merged)) delete next[key];
    else next[key] = merged;
    return { ...draft, edgeStyles: next, meta: { ...draft.meta, origin: "manual" } };
  }
  const post = { ...extra[i] };
  if (text) post.label = text;
  else delete post.label;
  const nya = [...extra];
  nya[i] = post;
  return { ...draft, extraEdges: nya, meta: { ...draft.meta, origin: "manual" } };
}

export function removeEdge(
  draft: ProcessDraft,
  source: string,
  target: string,
  /** Kantens etikett – då tas BARA den pilen bort, inte en parallell tvilling. */
  label?: string,
): ProcessDraft {
  const parKey = edgeKey(source, target);
  // En manuellt dragen koppling tas bort på riktigt; en härledd undertrycks.
  const extra = (draft.extraEdges ?? []).filter((e) => edgeKey(e.source, e.target) !== parKey);
  if (extra.length !== (draft.extraEdges ?? []).length) {
    return { ...draft, extraEdges: extra, meta: { ...draft.meta, origin: "manual" } };
  }
  const key = edgeKey(source, target, label);
  if (draft.removedEdges?.includes(key)) return draft;
  return {
    ...draft,
    removedEdges: [...(draft.removedEdges ?? []), key],
    meta: { ...draft.meta, origin: "manual" },
  };
}

/** Tar tillbaka en borttagen koppling (båda nyckelformerna). */
export function restoreEdge(
  draft: ProcessDraft,
  source: string,
  target: string,
  label?: string,
): ProcessDraft {
  const nycklar = new Set([edgeKey(source, target), edgeKey(source, target, label)]);
  if (!draft.removedEdges?.some((k) => nycklar.has(k))) return draft;
  return { ...draft, removedEdges: draft.removedEdges.filter((k) => !nycklar.has(k)) };
}

/** Är kopplingen bortvald? */
export function isEdgeRemoved(
  draft: ProcessDraft,
  source: string,
  target: string,
  label?: string,
): boolean {
  const lista = draft.removedEdges ?? [];
  return lista.includes(edgeKey(source, target)) || (label !== undefined && lista.includes(edgeKey(source, target, label)));
}

/* ------------------------------------------------------------------ */
/* Swimlanes                                                           */
/* ------------------------------------------------------------------ */

/**
 * Alla banor i visningsordning – både de som draften listar och de som bara
 * finns för att ett steg pekar på dem. Banor skapas löpande när man skriver in
 * ett nytt namn i mellanlagret, så listan måste kompletteras för att
 * omordningen ska kunna omfatta allt användaren ser.
 */
export function allLanes(draft: ProcessDraft): Swimlane[] {
  const map = new Map<string, Swimlane>();
  for (const l of draft.lanes) map.set(l.id, { ...l });
  for (const s of draft.steps) {
    if (!map.has(s.laneId)) map.set(s.laneId, makeLane(s.laneId, map.size));
  }
  return [...map.values()]
    .sort((a, b) => a.order - b.order)
    .map((l, i) => ({ ...l, order: i }));
}

/** Flyttar en bana upp eller ned bland de andra. */
export function moveLane(draft: ProcessDraft, laneId: string, dir: -1 | 1): ProcessDraft {
  const lanes = allLanes(draft);
  const i = lanes.findIndex((l) => l.id === laneId);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= lanes.length) return draft;
  [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  return {
    ...draft,
    lanes: lanes.map((l, k) => ({ ...l, order: k })),
    meta: { ...draft.meta, origin: "manual" },
  };
}

/** Byter namn på en bana och flyttar med alla steg som ligger i den. */
export function renameLane(draft: ProcessDraft, from: string, to: string): ProcessDraft {
  const namn = to.trim();
  if (!namn || namn === from) return draft;
  return {
    ...draft,
    lanes: allLanes(draft).map((l) => (l.id === from ? { ...l, id: namn, title: namn } : l)),
    steps: draft.steps.map((s) => (s.laneId === from ? { ...s, laneId: namn } : s)),
    meta: { ...draft.meta, origin: "manual" },
  };
}

/**
 * Gör ett automatiskt slut-event till ett riktigt steg.
 *
 * Auto-sluten skapas vid kompileringen och finns därför inte i steglistan –
 * de går varken att flytta till en annan bana eller döpa om. Den här funktionen
 * lägger in ett motsvarande slutsteg efter den nod det hängde på, i samma
 * gren. Kompileringen slutar då lägga till ett automatiskt slut där, eftersom
 * terminalen redan ÄR ett slut.
 */
export function materializeEnd(draft: ProcessDraft, afterStepId: string): ProcessDraft {
  const ankare = draft.steps.find((s) => s.id === afterStepId);
  if (!ankare) return draft;
  return addStepAfter(draft, afterStepId, {
    type: "end",
    text: "Klart",
    laneId: ankare.laneId,
    branchOf: ankare.branchOf,
  });
}

/**
 * Låter stegens typer stämma med det diagrammet faktiskt ritar.
 *
 * Kompileringen degraderar strukturellt felplacerade event – ett "slut" med
 * ett nästa steg blir en aktivitet, ett "start" med inflöde likaså. Den
 * korrigeringen skedde bara i modellen, så mellanlagret kunde visa "Slut" för
 * ett objekt som ritades som aktivitet. Nu speglas rättelsen tillbaka, så att
 * listan och diagrammet aldrig säger emot varandra.
 */
export function syncStepTypes(draft: ProcessDraft): ProcessDraft {
  const byId = new Map(compileDraft(draft).nodes.map((n) => [n.id, n.type]));
  let ändrat = false;
  const steps = draft.steps.map((s) => {
    const typ = byId.get(s.id);
    if (typ && typ !== s.type) {
      ändrat = true;
      return { ...s, type: typ };
    }
    return s;
  });
  return ändrat ? { ...draft, steps } : draft;
}

/**
 * Parar ihop ett utskick med sitt mottagningssteg – STRIKT BPMN.
 *
 * Ett meddelandeflöde får bara korsa en poolgräns. Går meddelandet till någon
 * som deltar i processen ska kopplingen vara ett sekvensflöde, och då måste
 * mottagningen ligga EFTER utskicket. Källtexten beskriver ofta samma mejl två
 * gånger – först ur mottagarens vy, sedan ur systemets – vilket ger en omöjlig
 * ordning: användaren tar emot bekräftelsen innan systemet skickat den.
 *
 * Funktionen flyttar därför mottagningssteget till direkt efter sitt utskick,
 * i utskickets gren. Ordningen blir kronologiskt korrekt och sekvensflödet
 * mellan banorna uppstår av sig självt vid kompileringen.
 */
export function pairMessageSteps(draft: ProcessDraft): ProcessDraft {
  const ordnad = normalizeOrder(draft);
  let steps = [...ordnad.steps];
  let ändrat = false;

  for (const utskick of ordnad.steps) {
    if (utskick.type !== "notification" || utskick.messageDirection === "receive") continue;
    const mottagare = utskick.recipient?.trim();
    if (!mottagare) continue;

    const iUtskick = steps.findIndex((s) => s.id === utskick.id);
    const iMottagning = steps.findIndex(
      (s) =>
        s.type === "notification" &&
        s.messageDirection === "receive" &&
        s.laneId === mottagare,
    );
    // Redan i rätt ordning, eller ingen mottagning att para med.
    if (iMottagning === -1 || iMottagning > iUtskick) continue;

    const [mottagning] = steps.splice(iMottagning, 1);
    const nyIndex = steps.findIndex((s) => s.id === utskick.id) + 1;
    // Mottagningen hör till samma gren som utskicket, annars hamnar den utanför.
    steps.splice(nyIndex, 0, { ...mottagning, branchOf: utskick.branchOf });
    ändrat = true;
  }

  return ändrat ? { ...ordnad, steps } : ordnad;
}

/**
 * Sätter `laneRow` på varje nod: 0 för huvudflödet, en egen rad per gren.
 *
 * Poängen är att en Ja/Nej-förgrening SKA synas – grenarna läggs på skilda
 * rader i samma swimlane i stället för att ritas linjärt efter varandra, och
 * banan växer på höjden för att rymma dem. Nästlade grenar staplas djupare.
 *
 * Raden bestäms av grenens plats bland beslutets grenar (Ja = 1, Nej = 2 …)
 * plus den rad beslutet självt ligger på, så nästling adderas.
 */
function assignLaneRows(
  nodes: ProcessNode[],
  draft: ProcessDraft,
  branchLabels: Map<string, string[]>,
): void {
  const stegById = new Map(draft.steps.map((s) => [s.id, s]));

  const radFör = (stepId: string): number => {
    const steg = stegById.get(stepId);
    if (!steg?.branchOf) return 0;
    const labels = branchLabels.get(steg.branchOf.stepId) ?? [];
    const idx = Math.max(0, labels.indexOf(steg.branchOf.label));
    // Beslutets egen rad (nästling) + grenens ordningsnummer.
    return radFör(steg.branchOf.stepId) + idx + 1;
  };

  for (const n of nodes) {
    n.laneRow = radFör(n.id);
    const steg = stegById.get(n.id);
    n.branchKey = steg?.branchOf ? branchScope(steg.branchOf.stepId, steg.branchOf.label) : "";
  }
}

/**
 * Döljer eller visar en sidhänvisning. `sida` = "in" (märket vid målet) eller
 * "ut" (märket vid källan).
 */
export function setPageRefHidden(
  draft: ProcessDraft,
  source: string,
  target: string,
  sida: "in" | "ut",
  dold: boolean,
): ProcessDraft {
  const nyckel = edgeKey(source, target);
  const next = { ...(draft.edgeStyles ?? {}) };
  const fält = sida === "in" ? "hideRefIn" : "hideRefOut";
  next[nyckel] = { ...next[nyckel], [fält]: dold || undefined };
  return { ...draft, edgeStyles: next, meta: { ...draft.meta, origin: "manual" } };
}

/** Visar alla dolda sidhänvisningar igen. */
export function showAllPageRefs(draft: ProcessDraft): ProcessDraft {
  const next: Record<string, EdgeSides> = {};
  for (const [k, v] of Object.entries(draft.edgeStyles ?? {})) {
    next[k] = { sourceSide: v.sourceSide, targetSide: v.targetSide };
  }
  return { ...draft, edgeStyles: next, meta: { ...draft.meta, origin: "manual" } };
}

/** Antal dolda sidhänvisningar – för att kunna erbjuda "visa alla igen". */
export function hiddenPageRefCount(draft: ProcessDraft): number {
  return Object.values(draft.edgeStyles ?? {}).reduce(
    (n, v) => n + (v.hideRefIn ? 1 : 0) + (v.hideRefOut ? 1 : 0),
    0,
  );
}

/** Sätter (eller nollar) en swimlanes manuella höjd. */
export function setLaneHeight(
  draft: ProcessDraft,
  laneId: string,
  height: number | null,
  /**
   * Delindex (0-baserat) i flersidigt läge: höjden gäller då BARA den delen.
   * Utan del sätts den globala höjden (alla delar / fri form).
   * null-höjd med del tar bort delens åsidosättande; fanns inget nollas den
   * globala höjden i stället – så läser dubbelklicket naturligt.
   */
  page?: number,
): ProcessDraft {
  const lanes = allLanes(draft).map((l) => {
    if (l.id !== laneId) return l;
    if (page === undefined) return { ...l, height: height ?? undefined };
    const pageHeights = { ...l.pageHeights };
    if (height === null) {
      const fanns = pageHeights[page] !== undefined;
      delete pageHeights[page];
      return {
        ...l,
        pageHeights: Object.keys(pageHeights).length ? pageHeights : undefined,
        height: fanns ? l.height : undefined,
      };
    }
    pageHeights[page] = height;
    return { ...l, pageHeights };
  });
  return { ...draft, lanes, meta: { ...draft.meta, origin: "manual" } };
}
