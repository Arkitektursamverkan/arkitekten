/**
 * ProcessModel – Arkitektens mellanmodell.
 *
 * Bärande designprincip:
 *   "AI ritar inte diagram. AI (eller regelparsern) skapar en strukturerad
 *    processmodell. Diagrammet genereras sedan DETERMINISTISKT från modellen."
 *
 * Allt – layout, editor, draw.io/Mermaid/SVG-export – läser denna modell.
 * Modellen är medvetet fristående från ritbibliotek (React Flow etc.) så att
 * den kan serialiseras, valideras och versionshanteras oberoende av UI.
 */

/** Typ av nod. Styr form, färg och swimlane-klassning. */
export type NodeType =
  | "start" // startpunkt ("Fel uppkommer", "Behov uppstår")
  | "activity" // vanlig aktivitet -> rundad box
  | "decision" // beslutspunkt -> romb
  | "system" // system/plattform (SharePoint, Power Automate) -> box
  | "integration" // integrationspunkt (Azure Function, API) -> box
  | "notification" // notifiering (mejl, Teams-chatt) -> box med kuvert-accent
  | "datastore" // datalagring (SP-lista Incident/Service Request) -> cylinder
  | "end"; // slutpunkt ("Tack för ditt ärende")

/** Perspektiv-filter enligt KRAV 4. */
export type Perspective = "business" | "system";

/** BPMN-gateway-typ för beslutsnoder. exclusive = XOR (en väg), parallel = AND. */
export type GatewayKind = "exclusive" | "parallel";

export interface ProcessNode {
  id: string;
  type: NodeType;
  /** Kort etikett som visas i noden. */
  label: string;
  /** Vilken swimlane noden hör till (matchar Swimlane.id). */
  laneId: string;
  /** För decision-noder: BPMN-gateway-typ. Default 'exclusive'. */
  gateway?: GatewayKind;
  /**
   * Spårbarhet (KRAV / Regel 2): index i källtexten som noden härstammar från.
   * Gör att vi kan bevisa "antal aktiviteter i text = antal i diagram".
   */
  sourceIndex: number;
  /** Ursprunglig textfras noden skapades ur (för spårbarhets-inspektören). */
  sourceText?: string;
  /** Vilka perspektiv noden syns i. Tekniska noder göms i business-vyn. */
  perspectives: Perspective[];
  /** Manuellt låst position (från editorn). null = auto-layout bestämmer. */
  position?: { x: number; y: number } | null;
  /**
   * Rad inom sin swimlane. 0 = huvudflödet. Grensteg (Ja/Nej) får en egen rad
   * så att förgreningen syns och banan växer på höjden i stället för att
   * grenarna ritas linjärt efter varandra.
   */
  laneRow?: number;
  /**
   * Grenens identitet (scope-nyckel). "" = huvudflödet. Layouten packar rader
   * per gren utifrån VERKLIG kolumnkrock i stället för nästlingsdjup, så en
   * bana bara blir så hög som grenarna faktiskt kräver.
   */
  branchKey?: string;
  /**
   * För notifieringar: BPMN skiljer på Send Task (skickar) och Receive Task
   * (tar emot). Avgör både ikon och vem steget hör till.
   */
  messageDirection?: "send" | "receive";
  /**
   * Mottagaren tolkningen angav för ett utskick. Följer med till modellen så
   * att kontrollen kan skilja "ingen mottagare angiven" från "mottagaren är
   * angiven men deltar i processen" – i det senare fallet ritas ett
   * sekvensflöde till mottagningssteget i stället för ett meddelandeflöde.
   */
  recipient?: string;
  /**
   * Manuell textstorlek för JUST den här noden, som faktor (1 = normal,
   * 0.85/0.7/0.55 = mindre). Respekteras av både canvas och SVG-export.
   */
  textSize?: number;
  /** Var texten placeras i noden. Saknas = centrerat. */
  textPlacement?: TextPlacement;
  /**
   * Manuellt vald DEL i ett flersidigt utlägg (0-baserad). Sätts när
   * användaren drar objektet till en annan del; hänvisningar och kopplingar
   * räknas om automatiskt eftersom de härleds ur deltillhörigheten.
   */
  pagePin?: number;
}

/** Textplacering i en nod. */
export type TextPlacement = "center" | "top" | "bottom" | "left" | "right";

/**
 * BPMN-flödestyp. sequence = normalt sekvensflöde (heldragen, fylld pil).
 * message = meddelandeflöde mellan deltagare (streckad, öppen pil), t.ex. mejl.
 */
export type EdgeKind = "sequence" | "message";

/** Sida på en nod som en kant kan koppla till. */
export type EdgeSide = "top" | "right" | "bottom" | "left";

export interface ProcessEdge {
  id: string;
  source: string;
  target: string;
  /** Kantetikett, t.ex. "Ja"/"Nej" från ett beslut. */
  label?: string;
  /** BPMN-flödestyp. Default 'sequence'. */
  kind?: EdgeKind;
  /**
   * Manuellt vald kopplingspunkt. Saknas = geometrin avgör (ISO 5807-regeln).
   * Sätts när användaren drar en kantände till en annan sida i editorn, och
   * respekteras av BÅDE canvas och exportörerna så att export matchar skärmen.
   */
  sourceSide?: EdgeSide;
  targetSide?: EdgeSide;
  /**
   * Manuell brytpunkt i FRI-layoutens koordinater. Är den satt går kanten med
   * räta vinklar rakt genom punkten (ingen automatisk väjning) – så tvingar man
   * en koppling till andra sidan om ett objekt. Respekteras av både canvas och
   * exportörerna. Fri-koordinater (som nodpositioner) så den överlever formatbyte.
   */
  waypoint?: { x: number; y: number } | null;
  /**
   * Var på vägen etiketten sitter, som ANDEL av vägens längd (0–1). Saknas =
   * regeln i `labelAnchor` bestämmer. Andel och inte koordinat, så att en
   * flyttad etikett följer med när objekten flyttas eller formatet byts.
   */
  labelPos?: number;
  /**
   * Dolda sidhänvisningar när kanten korsar ett snitt i ett flersidigt utlägg.
   * "in" = märket vid målet ("från del N"), "ut" = märket vid källan.
   */
  hideRefIn?: boolean;
  hideRefOut?: boolean;
  /** Perspektiv kanten syns i (härleds från noderna den kopplar). */
  perspectives: Perspective[];
}

/**
 * BPMN-pool = en DELTAGARE. Sekvensflöden får aldrig korsa en poolgräns;
 * kommunikation mellan pooler sker med meddelandeflöden. En "black box" är en
 * deltagare vars inre vi inte modellerar – t.ex. mottagaren av ett mejl.
 */
export interface Pool {
  id: string;
  title: string;
  order: number;
  /** true = svart låda: ritas som tom ram, har inga lanes och inget flöde. */
  blackBox?: boolean;
}

/**
 * BPMN data store – en ARTEFAKT, inte ett flödesobjekt. Den får aldrig ingå i
 * sekvensflödet; den kopplas till aktiviteter med dataassociationer. Detta var
 * ett formellt fel i tidigare version, där datalager låg mitt i flödet.
 */
export interface DataStore {
  id: string;
  label: string;
  /** Vilken lane artefakten ritas i (samma som aktiviteten den hör till). */
  laneId: string;
  /**
   * Spårbarhet – samma kontrakt som ProcessNode. Artefakter kommer också ur
   * källtexten och måste kunna bevisas mot den (Regel 2). Utan detta fält
   * tvingas valideringen gissa via etikettmatchning, vilket kan matcha fel
   * lager när två liknar varandra.
   */
  sourceIndex: number;
  sourceText?: string;
  /**
   * Noden artefakten låg direkt efter i flödet. Används BARA av layouten för
   * att placera lagret på rätt plats i kronologin. Skrivaren duger inte: den
   * kan vara en aktivitet långt tidigare i flödet, och då hamnade loggposten
   * i början av diagrammet trots att den skrivs sist.
   */
  afterNodeId?: string;
  /** Manuellt satt position, precis som för noder. */
  position?: { x: number; y: number } | null;
  perspectives: Perspective[];
  /** Manuell textstorlek (faktor), precis som för noder. */
  textSize?: number;
}

/** Streckad koppling aktivitet ↔ datalager. Aldrig en pil i sekvensflödet. */
export interface DataAssociation {
  id: string;
  /** Aktivitetens nod-id. */
  nodeId: string;
  dataStoreId: string;
  /** write = aktiviteten skriver till lagret, read = läser från det. */
  direction: "read" | "write";
  /** Dolda sidhänvisningar när associationen korsar ett snitt. Se ProcessEdge. */
  hideRefIn?: boolean;
  hideRefOut?: boolean;
  /**
   * Manuellt valda kopplingspunkter, i associationens RIKTNING (write:
   * källa = aktiviteten; read: källa = lagret). Saknas = skrivning botten→topp,
   * läsning topp→botten. Respekteras av både canvas och export.
   */
  sourceSide?: EdgeSide;
  targetSide?: EdgeSide;
  /**
   * Manuell brytpunkt i FRIA layoutens koordinater – samma kontrakt som
   * `ProcessEdge.waypoint` (se koordinatramarna i README). En streckad koppling
   * är lika mycket i vägen som en heldragen, så böjen måste gå att flytta.
   */
  waypoint?: { x: number; y: number };
  /**
   * Etikett på associationen. Den härleds inte ur texten – den skrivs för hand
   * (dubbelklick på kopplingen) och bor bland kantens presentationsval
   * (`EdgeSides.label`), precis som på en härledd kedjepil.
   */
  label?: string;
  perspectives: Perspective[];
}

/**
 * Meddelandeflöde: aktivitet → annan DELTAGARE (pool). Egen lista, skild från
 * `edges`, just för att göra det formella felet omöjligt: ett meddelandeflöde
 * kan aldrig råka bli en pil i sekvensflödet, och ett sekvensflöde kan aldrig
 * korsa en poolgräns.
 */
export interface MessageFlow {
  id: string;
  /** Avsändande nod (Send Task eller motsvarande). */
  nodeId: string;
  /**
   * Mottagande deltagare (svart låda).
   *
   * STRIKT BPMN: ett meddelandeflöde får ENBART gå mellan pooler. Kommunikation
   * mellan banor inom samma pool är sekvensflöde. Därför finns ingen väg att
   * peka på en nod här – mottagaren är alltid en annan deltagare.
   */
  poolId: string;
  label?: string;
  /** Manuellt vald utgångssida på avsändaren. Saknas = botten. */
  sourceSide?: EdgeSide;
  /**
   * VAR på mottagarbandets ovankant pilen landar, som andel 0–1 av bandets bredd.
   *
   * Saknas = RAKT NEDANFÖR AVSÄNDAREN, vilket är förvalet och nästan alltid det
   * man vill: en lodrät pil läses som "det här meddelandet kommer härifrån".
   * Bandet är brett som hela sidan, så det finns ingen naturlig "mitt" att falla
   * tillbaka på – därför följer landningen avsändaren om inget annat sagts.
   */
  targetPos?: number;
  /**
   * Manuell brytpunkt i FRIA layoutens koordinater (se DataAssociation.waypoint).
   * Finns en sådan gäller den FRAMFÖR den raka vägen ner till mottagarbandet:
   * automatiken är ett förval, inte ett förbud.
   */
  waypoint?: { x: number; y: number };
  perspectives: Perspective[];
}

export interface Swimlane {
  /** Tom bana som ändå ritas: man har just dragit ut sista objektet i redigeringen. Sparas inte. */
  ritasTom?: boolean;
  id: string;
  /** Visningsnamn, t.ex. "Användare", "Automatisering", "Ärendelagring". */
  title: string;
  /** Ordning uppifrån och ned (vid horisontellt flöde) eller vänster→höger. */
  order: number;
  /** Vilka perspektiv lanen syns i. */
  perspectives: Perspective[];
  /** Vilken pool (deltagare) lanen tillhör. Saknas = processens huvudpool. */
  poolId?: string;
  /** Manuellt satt höjd (px) – användaren har dragit ut banan. Gäller ALLA delar. */
  height?: number;
  /**
   * Manuellt satt höjd PER DEL i flersidigt läge (nyckel = delindex, 0-baserad).
   * Vinner över `height` på sin del. Obs: delindelningen kan ändras när flödet
   * redigeras – höjden gäller delen med samma NUMMER, inte "samma innehåll".
   */
  pageHeights?: Record<number, number>;
}

export interface ProcessModel {
  /** Diagrammets titel, t.ex. "Felanmälan ny". */
  title: string;
  /** Fri undertext / beskrivning som visas i titelrutan. */
  subtitle?: string;
  /** Deltagare. Första posten är processens egen pool. */
  pools: Pool[];
  swimlanes: Swimlane[];
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  /** Datalager som artefakter (utanför sekvensflödet). */
  dataStores: DataStore[];
  /** Streckade kopplingar mellan aktiviteter och datalager. */
  dataAssociations: DataAssociation[];
  /** Meddelandeflöden ut till andra deltagare. */
  messageFlows: MessageFlow[];
  /** Flödesriktning. "LR" = vänster→höger (standard enligt KRAV 6). */
  direction: "LR" | "TB";
  /** Metadata för spårbarhet och validering. */
  meta: {
    /** Källtexten modellen genererades ur. */
    sourceText: string;
    /** Alla textfragment parsern identifierade (för validering). */
    sourceFragments: string[];
    /** Ev. varningar från parser/validator. */
    warnings: string[];
  };
}

/** Skapar en tom modell. */
export function emptyModel(): ProcessModel {
  return {
    title: "",
    pools: [],
    swimlanes: [],
    dataStores: [],
    dataAssociations: [],
    messageFlows: [],
    nodes: [],
    edges: [],
    direction: "LR",
    meta: { sourceText: "", sourceFragments: [], warnings: [] },
  };
}

/** Formbeskrivning per nodtyp – används av renderer och exportörer. */
export const NODE_SHAPE: Record<NodeType, "rounded" | "rhombus" | "cylinder" | "stadium"> = {
  start: "stadium",
  end: "stadium",
  activity: "rounded",
  decision: "rhombus",
  system: "rounded",
  integration: "rounded",
  notification: "rounded",
  datastore: "cylinder",
};

/* ---- BPMN 2.0-mappning (delad av renderer + exportörer) ---- */

/** BPMN-grundform per nodtyp. */
export type BpmnShape = "event" | "task" | "gateway" | "dataStore";
/** BPMN task-typ-ikon (visas uppe i vänstra hörnet av en task). */
export type BpmnTaskIcon = "user" | "service" | "send" | "receive" | "none";

/**
 * Ikon för en notifiering beror på RIKTNINGEN, inte bara på nodtypen:
 * Send Task = fyllt kuvert (skickar), Receive Task = ofyllt (tar emot).
 */
export function taskIcon(n: Pick<ProcessNode, "type" | "messageDirection">): BpmnTaskIcon {
  if (n.type === "notification") return n.messageDirection === "receive" ? "receive" : "send";
  return BPMN_TASK_ICON[n.type];
}

export const BPMN_SHAPE: Record<NodeType, BpmnShape> = {
  start: "event",
  end: "event",
  activity: "task",
  system: "task",
  integration: "task",
  notification: "task",
  decision: "gateway",
  datastore: "dataStore",
};

export const BPMN_TASK_ICON: Record<NodeType, BpmnTaskIcon> = {
  start: "none",
  end: "none",
  decision: "none",
  datastore: "none",
  activity: "user", // en person utför aktiviteten → User Task
  system: "service", // systemet utför → Service Task (kugghjul)
  integration: "service",
  notification: "send", // skickar meddelande → Send Task (kuvert)
};

/** Är noden ett start- respektive slut-event? (styr tunn/tjock eventring) */
export function eventKind(type: NodeType): "start" | "end" | null {
  return type === "start" ? "start" : type === "end" ? "end" : null;
}
