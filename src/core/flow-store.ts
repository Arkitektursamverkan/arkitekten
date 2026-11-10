/**
 * Flödesbiblioteket – spara ett arbete och återvända till det senare.
 *
 * Två lagringar bakom samma gränssnitt:
 *   1. Disk (via ark-bryggan) när dev-servern kör. Flödena hamnar som vanliga
 *      JSON-filer i `flows/` – de överlever webbläsarrensning, kan backas upp
 *      och versionshanteras, och kan läsas av Claude Code.
 *   2. localStorage som reserv. Fungerar alltid, även i en statisk build.
 *
 * Vad som sparas är AVSIKTLIGT hela kedjan: råtexten, AI-beskrivningen och
 * mellanlagret. Diagrammet sparas inte – det kompileras alltid fram på nytt
 * ur mellanlagret, så ett sparat flöde kan aldrig bli osynkat med sin modell.
 */

import type { ProcessDraft } from "./draft";
import type { Perspective } from "./model";
import { normaliseraStatus, sammanfattaStatus, type FlowStatus } from "./status";
import { skapadTid } from "./nyhet";
import type { Publicering } from "./publicering";
import { DEMO_KATEGORI, type Yta, type Ägare } from "./behorighet";

/** Vyinställningar som hör till arbetet, inte till processen. */
export interface FlowView {
  perspective: Perspective;
  pageFormat: string;
  scale: number;
  /** "type" = typfärger, "bpmn" = strikt/färglöst. */
  colorMode?: string;
  /** Täthet 0.5–1: avstånden mellan objekt. Saknas = 1. */
  spacing?: number;
  /** Global textstorlek 0.6–1 (faktor på all text). Saknas = 1. */
  textScale?: number;
}

/**
 * En sparad version. Historiken ligger i själva flödesfilen i stället för i
 * separata filer: då beter sig disk och localStorage exakt likadant, och ett
 * flöde är fortfarande *en* fil man kan skicka vidare eller backa upp.
 */
export interface FlowVersion {
  /** Löpande: v1, v2, v3 … */
  id: string;
  savedAt: string;
  /** Frivillig kommentar, t.ex. "efter genomgången med förvaltningen". */
  label?: string;
  /**
   * Vem som justerade. Appen har ingen inloggning – namnet skrivs vid
   * sparningen och minns lokalt. Följer med i exporten, för en figur i ett
   * dokument läses av någon annan långt senare.
   */
  savedBy?: string;
  /**
   * "utkast" eller "fastslagen". SAKNAS = utkast (se status.ts) – gamla filer
   * behöver därför ingen migrering, och en version kan aldrig av misstag ärva
   * någon annans fastslagenhet.
   *
   * Beteckningen (1.0, 1.1 …) lagras INTE här: den härleds ur historikens
   * statusar, så numreringen kan inte glida ifrån statusen den beskriver.
   */
  status?: FlowStatus;
  rawText: string;
  aiText?: string;
  draft: ProcessDraft;
}

export interface SavedFlow {
  id: string;
  name: string;
  /**
   * Kategorin i katalogen – trädets översta nivå, satt av användaren.
   *
   * Kategorin var förut en hårdkodad REGEL (`KATEGORIER` i flow-tree.ts:
   * "allt som är ett flödesschema hör till portalen"). Det höll så länge
   * biblioteket bara innehöll portalens processer, men en affärsprocess som ska
   * ligga under "Systemförvaltning" går inte att uttrycka som en regel om
   * id:t – och att koda in varje ny samling i källkoden är inte något
   * användaren ska behöva be om.
   *
   * Egenskapen sitter på FLÖDET, inte på versionen: det är samma sorts uppgift
   * som namnet. Att flytta en process mellan kategorier är alltså inte en ny
   * version av processen, och historiken rörs inte (invariant 11).
   *
   * SAKNAS = de gamla reglerna gäller, så inga befintliga filer behöver
   * migreras.
   */
  category?: string;
  /**
   * Underkategorin – nivån UNDER kategorin i katalogen och menyn.
   *
   * Samma resonemang som `category`: strukturen är något man väljer, inte
   * något koden räknar ut. Saknas den gäller de härledda nivåerna
   * (ärendetyp → målgrupp), så portalens flöden ligger kvar där de alltid
   * legat utan att en enda fil behöver skrivas om.
   */
  subcategory?: string;
  /**
   * Var i EA-portalen processen är publicerad, med ägare och beskrivning
   * (core/publicering.ts). Sitter på FLÖDET, inte på versionen – samma sorts
   * uppgift som placeringen, och skrivs bara av `sättPublicering`.
   */
  publicering?: Publicering;
  /**
   * Användaren vars EGNA katalog processen ligger i. Saknas = den gemensamma
   * katalogen (eller Demo) – ytan härleds i core/behorighet.ts. Skrivs BARA av
   * bryggan: vid skapandet och när ytan byts (`flyttaTillYta`). Samma sorts
   * uppgift som placeringen, så ett byte är ingen ny version (invariant 11).
   */
  ägare?: Ägare;
  /**
   * Användaren som SKAPADE processen. Till skillnad från `ägare` byts den
   * aldrig – inte heller när processen flyttas till någon annans katalog.
   * Skrivs bara av bryggan, vid skapandet. Saknas på flöden från före fältet.
   */
  skapadAv?: Ägare;
  /** ISO-tidpunkt för senaste sparning. */
  savedAt: string;
  rawText: string;
  aiText?: string;
  draft: ProcessDraft;
  view?: FlowView;
  /** Alla sparade versioner, äldst först. Sista posten = nuvarande innehåll. */
  versions: FlowVersion[];
}

/** Det som listan visar – utan den tunga draften. */
export interface FlowSummary {
  id: string;
  name: string;
  savedAt: string;
  /**
   * När processen lades upp = första versionens tidpunkt. Härledd ur
   * historiken (core/nyhet.ts), aldrig lagrad – menyn märker de nya med den.
   */
  skapad?: string;
  stepCount: number;
  versionCount: number;
  /**
   * Statusen flödet står på nu = senaste versionens. Menyn märker de flöden som
   * INTE är fastslagna, så man ser vad som är arbetsmaterial utan att öppna det.
   */
  status?: FlowStatus;
  /** Nuvarande beteckning ("2.1"). Härledd – se status.ts. */
  beteckning?: string;
  /** Kategorin användaren valt. Saknas = reglerna i flow-tree.ts gäller. */
  category?: string;
  /** Underkategorin användaren valt. Saknas = de härledda nivåerna gäller. */
  subcategory?: string;
  /** Ägaren när processen ligger i någons egen katalog (se SavedFlow.ägare). */
  ägare?: Ägare;
  /** Den som skapade processen (se SavedFlow.skapadAv). */
  skapadAv?: Ägare;
  /** Beteckningen på senaste FASTSLAGNA versionen, om någon finns. */
  fastslagenBeteckning?: string;
  /**
   * Banan där flödet BÖRJAR – alltså den som utför processen. Menyn grupperar
   * på den (se flow-tree.ts). Härledd ur flödet, inte ur namnet: "Genomförs"
   * och "Lås upp formulär" nämner ingen roll men utförs av godkännaren.
   */
  actor?: string;
}

/** Banan där flödet startar: startpunktens bana, annars första stegets. */
export function flowActor(draft: { steps?: Array<{ type?: string; laneId?: string }> } | undefined):
  | string
  | undefined {
  const steps = draft?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return undefined;
  return (steps.find((s) => s.type === "start") ?? steps[0]).laneId;
}

/**
 * Hur många versioner som sparas per flöde. Äldsta gallras bort när taket
 * nås – hellre en tyst gräns än en fil som växer i oändlighet.
 */
export const MAX_VERSIONS = 50;

export interface FlowStore {
  /** "disk" eller "webbläsare" – visas i UI så användaren vet var det hamnar. */
  readonly kind: "disk" | "local";
  list(): Promise<FlowSummary[]>;
  load(id: string): Promise<SavedFlow>;
  save(flow: SavedFlow): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * Gör ett filnamnssäkert id av ett namn. Samma namn ger samma id, så att
 * spara om ett flöde skriver över det i stället för att skapa dubbletter.
 */
export function flowId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return base || "flode";
}

/* ------------------------------------------------------------------ */
/* Disk via ark-bryggan                                                */
/* ------------------------------------------------------------------ */

/** Bryggan svarar alltid JSON – HTML betyder att plugin:et inte är aktivt. */
export function isJson(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").includes("application/json");
}

/** Ett fel från bryggan, med HTTP-statusen – 403 och 409 betyder olika saker för den som sparar. */
export class BryggFel extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Bryggans maskinläsbara orsak, t.ex. "upptaget" (id:t används av en process man inte ser). */
    readonly kod?: string,
  ) {
    super(message);
  }
}

export async function bridgeJson(url: string, init?: RequestInit): Promise<any> {
  // Bryggan tar bara emot JSON i det som ändrar något (CSRF-skyddet i
  // server/brygga.ts) – också när kroppen är tom.
  const metod = (init?.method ?? "GET").toUpperCase();
  const behöverTyp = ["POST", "PUT", "PATCH"].includes(metod) && !new Headers(init?.headers).has("content-type");
  const res = await fetch(url, behöverTyp ? { ...init, headers: { ...(init?.headers as Record<string, string>), "content-type": "application/json" } } : init);
  if (!isJson(res)) throw new Error("Bryggan svarar inte (kör appen via npm run dev).");
  const body = await res.json();
  if (!res.ok || body.ok === false)
    throw new BryggFel(
      body.error ?? `Fel från bryggan (${res.status}).`,
      res.status,
      typeof body.kod === "string" ? body.kod : undefined,
    );
  return body;
}

const diskStore: FlowStore = {
  kind: "disk",
  async list() {
    return (await bridgeJson("/__ark/flows")).flows as FlowSummary[];
  },
  async load(id) {
    return normalizeFlow((await bridgeJson(`/__ark/flows/${encodeURIComponent(id)}`)).flow);
  },
  async save(flow) {
    await bridgeJson(`/__ark/flows/${encodeURIComponent(flow.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(flow),
    });
  },
  async remove(id) {
    await bridgeJson(`/__ark/flows/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

/* ------------------------------------------------------------------ */
/* localStorage                                                        */
/* ------------------------------------------------------------------ */

const LS_PREFIX = "ark.flow.";

/** Skapar en localStorage-baserad lagring. `storage` injiceras för test. */
export function createLocalStore(storage: Storage): FlowStore {
  const keys = () =>
    Object.keys(storage).filter((k) => k.startsWith(LS_PREFIX));

  const read = (key: string): SavedFlow | null => {
    try {
      return JSON.parse(storage.getItem(key) ?? "");
    } catch {
      return null; // trasig post – hoppa över i stället för att krascha listan
    }
  };

  return {
    kind: "local",
    async list() {
      return keys()
        .map(read)
        .filter((f): f is SavedFlow => f !== null)
        .map((f) => ({
          id: f.id,
          name: f.name,
          savedAt: f.savedAt,
          skapad: skapadTid(f),
          stepCount: f.draft?.steps?.length ?? 0,
          versionCount: Math.max(1, f.versions?.length ?? 0),
          actor: flowActor(f.draft),
          category: f.category,
          subcategory: f.subcategory,
          ägare: f.ägare,
          skapadAv: f.skapadAv,
          ...sammanfattaStatus(f.versions ?? []),
        }))
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    async load(id) {
      const flow = read(LS_PREFIX + id);
      if (!flow) throw new Error("Flödet finns inte.");
      return normalizeFlow(flow);
    },
    async save(flow) {
      storage.setItem(LS_PREFIX + flow.id, JSON.stringify(flow));
    },
    async remove(id) {
      storage.removeItem(LS_PREFIX + id);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Val av lagring                                                      */
/* ------------------------------------------------------------------ */

let cached: FlowStore | null = null;

/**
 * Väljer lagring en gång per session: disk om bryggan svarar, annars
 * webbläsaren. Tyst fallback är avsiktligt – användaren ska aldrig förlora ett
 * flöde bara för att dev-servern råkade vara nere.
 */
export async function getFlowStore(): Promise<FlowStore> {
  if (cached) return cached;
  try {
    const res = await fetch("/__ark/flows");
    // Ett JSON-svar betyder att bryggan finns – också 401 (sessionen har gått
    // ut). Att då falla tillbaka på webbläsaren hade sparat arbetet där ingen
    // annan ser det, i tron att det låg i biblioteket.
    if (isJson(res)) {
      cached = diskStore;
      return cached;
    }
  } catch {
    // ingen brygga – faller igenom till localStorage
  }
  cached = createLocalStore(window.localStorage);
  return cached;
}

/**
 * Kompletterar ett flöde som sparats innan versionshistoriken fanns.
 * Utan detta skulle gamla filer se ut att sakna historik helt.
 */
export function normalizeFlow(flow: SavedFlow): SavedFlow {
  if (Array.isArray(flow.versions) && flow.versions.length > 0) return flow;
  return {
    ...flow,
    versions: [
      {
        id: "v1",
        savedAt: flow.savedAt,
        label: "Före versionshistoriken",
        rawText: flow.rawText,
        aiText: flow.aiText,
        draft: flow.draft,
      },
    ],
  };
}

/** Innehållet som versioneras – vyinställningar räknas inte som en ändring. */
function contentKey(v: { rawText: string; aiText?: string; draft: ProcessDraft }): string {
  return JSON.stringify({ rawText: v.rawText, aiText: v.aiText ?? "", draft: v.draft });
}

/** Det som avgör om en sparning är värd en egen version. */
export interface VersionsKandidat {
  rawText: string;
  aiText?: string;
  draft: ProcessDraft;
  label?: string;
  status?: FlowStatus;
}

/**
 * Skapar den här sparningen en NY version, eller är den en no-op?
 *
 * REGELN BOR HÄR. Både `saveFlowVersion` (som utför sparningen) och sparraden i
 * FlowLibrary (som lovar vad den ska bli, INNAN man klickar) frågar den här
 * funktionen. Med två kopior kunde panelen säga "inget nytt att spara" medan
 * lagringen skrev en version – t.ex. efter att man återgått till en äldre
 * version, där innehållet skiljer sig från historikens sista post trots att
 * inget är "osparat".
 *
 * Tre saker räknas som en ändring:
 *   1. innehållet (råtext, AI-text, mellanlager)
 *   2. en kommentar på versionen – den är hela poängen med sparningen
 *   3. statusen – att fastslå ändrar ingen text men allt om vad flödet ÄR
 */
export function skaparNyVersion(
  versioner: readonly FlowVersion[] | undefined,
  nästa: VersionsKandidat,
): boolean {
  const last = versioner?.[versioner.length - 1];
  if (!last) return true; // första sparningen av ett flöde
  return (
    contentKey(last) !== contentKey(nästa) ||
    Boolean(nästa.label?.trim()) ||
    normaliseraStatus(last.status) !== normaliseraStatus(nästa.status)
  );
}

/**
 * Id-prefix för flöden som hör till verktyget "Affärsprocess".
 * Verktygen delar lagring (flows/-mappen respektive localStorage) men har
 * egna bibliotek – prefixet är det som skiljer familjerna åt i listningen.
 */
export const AP_FLOW_PREFIX = "ap-";

/** Verktygsfamiljerna som delar lagring. */
export type FlowFamily = "flode" | "affarsprocess";

/**
 * Vilken familj ett flöde tillhör – REGELN BOR HÄR, inte hos den som frågar.
 * Både biblioteket i panelen och menyn i skalet delar in listan efter den, och
 * två kopior av "börjar id:t med ap-?" hade glidit isär vid nästa verktyg.
 */
export function flowFamily(id: string): FlowFamily {
  return id.startsWith(AP_FLOW_PREFIX) ? "affarsprocess" : "flode";
}

/** Id-prefixet en familj sparar med. */
export function familyPrefix(family: FlowFamily): string | undefined {
  return family === "affarsprocess" ? AP_FLOW_PREFIX : undefined;
}

/**
 * Sänds när biblioteket ändrats (sparat, raderat). Skalets meny lyssnar och
 * uppdaterar sin lista – annars visar den gamla namn tills sidan laddas om.
 */
export const FLOWS_CHANGED = "ark:flows-changed";

/** Talar om för lyssnare att listan behöver läsas om. */
export function meddelaFlödenÄndrade(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(FLOWS_CHANGED));
}

/**
 * Sänds när ett verktyg börjat redigera ett annat flöde (öppnat, sparat, nytt).
 * Skalets meny markerar det flödet – annars visste menyn bara om de flöden den
 * själv öppnat, och man kunde sitta i ett diagram utan att se vilket det var.
 * Samma väg som FLOWS_CHANGED: ett fönsterevent i stället för prop-kedjor
 * genom verktygsregistret.
 */
export const ACTIVE_FLOW_CHANGED = "ark:aktivt-flode";

/** Talar om vilket flöde som redigeras (null = osparat/nytt). */
export function meddelaAktivtFlöde(id: string | null): void {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(ACTIVE_FLOW_CHANGED, { detail: id }));
}

/** Var i katalogen ett flöde ligger. Tom sträng = ingen egen nivå. */
export interface Placering {
  category?: string;
  subcategory?: string;
}

/**
 * Flyttar ett flöde i katalogen – utan att röra innehållet.
 *
 * EGEN VÄG, inte `saveFlowVersion`: en flytt är ingen sparning. Historiken ska
 * inte få en ny post, `savedAt` ska inte ändras (då hade "senast ändrade"
 * fyllts av processer ingen rört), och versionsbeteckningen ska stå still.
 * Invariant 4 gäller som alltid: posten SPRIDS, den byggs aldrig om fält för
 * fält – annars tappas det som lagts till sedan den skrevs.
 */
export async function sättPlacering(
  store: FlowStore,
  id: string,
  placering: Placering,
): Promise<SavedFlow> {
  const flow = await store.load(id);
  const nästa: SavedFlow = {
    ...flow,
    category: placering.category?.trim() || undefined,
    subcategory: placering.subcategory?.trim() || undefined,
  };
  await store.save(nästa);
  return nästa;
}

/**
 * Publicerar ett flöde i EA-portalen – eller ändrar en publicering.
 *
 * Samma väg som en flytt och av samma skäl: publiceringen säger VAR processen
 * visas och VEM som äger den, inte vad den innehåller. Ingen ny version, ingen
 * ny `savedAt`, och posten SPRIDS (invariant 4). Vilken version portalen visar
 * avgörs av historiken (senaste fastslagna), aldrig av publiceringen.
 */
export async function sättPublicering(
  store: FlowStore,
  id: string,
  publicering: Publicering,
): Promise<SavedFlow> {
  // Mot disk skriver BRYGGAN fältet (admin + gemensam katalog, server/atkomst.ts) –
  // en vanlig sparning bär det aldrig.
  if (store.kind === "disk") {
    return normalizeFlow(
      (
        await bridgeJson(`/__ark/ea/publicering/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ publicering }),
        })
      ).flow,
    );
  }
  const flow = await store.load(id);
  const nästa: SavedFlow = { ...flow, publicering };
  await store.save(nästa);
  return nästa;
}

/**
 * Avpublicerar: tar bort publiceringen ur flödet.
 *
 * Samma regler som `sättPublicering` – ingen ny version, ingen ny `savedAt`,
 * posten SPRIDS och bara fältet tas bort. Flödesschemat försvinner ur
 * portalen när plattformen hämtar nästa gång, för den speglar bara
 * publicerade flöden och gallrar resten.
 */
export async function taBortPublicering(store: FlowStore, id: string): Promise<SavedFlow> {
  if (store.kind === "disk") {
    return normalizeFlow(
      (await bridgeJson(`/__ark/ea/publicering/${encodeURIComponent(id)}`, { method: "DELETE" })).flow,
    );
  }
  const { publicering: _borttagen, ...resten } = await store.load(id);
  await store.save(resten);
  return resten;
}

/**
 * Flyttar en process till en annan YTA – den vanliga vägen är från Mina
 * processer till den gemensamma katalogen, när processen är klar.
 *
 * Som en flytt i katalogen: ingen ny version, `savedAt` står still. Mot disk
 * gör BRYGGAN bytet (`/__ark/flows/:id/yta`), för det är den som vet vem som
 * frågar och som ensam får skriva ägaren. I webbläsarlagringen finns bara en
 * användare, och där sätts fälten direkt.
 */
export async function flyttaTillYta(
  store: FlowStore,
  id: string,
  till: Yta,
  placering: Placering,
  jag?: Ägare,
): Promise<SavedFlow> {
  if (store.kind === "disk") {
    return (
      await bridgeJson(`/__ark/flows/${encodeURIComponent(id)}/yta`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ till, ...placering }),
      })
    ).flow as SavedFlow;
  }
  const { ägare: _gammal, ...flow } = await store.load(id);
  const kategori =
    till === "demo" ? DEMO_KATEGORI : placering.category?.trim() || undefined;
  const nästa: SavedFlow = {
    ...flow,
    ...(till === "egen" && jag ? { ägare: jag } : {}),
    category: kategori,
    subcategory: placering.subcategory?.trim() || undefined,
  };
  await store.save(nästa);
  return nästa;
}

/**
 * Byter namn på en gren: samma flytt, för alla flöden som ligger i den.
 *
 * Att döpa om en gren är inte en egen sorts data – grenen FINNS bara som ett
 * fält på sina flöden, så namnbytet är att skriva det nya namnet på var och en.
 * Går en skrivning fel avbryts inte de andra: hellre en gren som är halvt
 * flyttad (och syns som två) än en som tyst blev inkonsekvent.
 */
export async function döpOmGren(
  store: FlowStore,
  ids: string[],
  ändring: Placering,
): Promise<SavedFlow[]> {
  const ut: SavedFlow[] = [];
  for (const id of ids) {
    const flow = await store.load(id);
    ut.push(
      await sättPlacering(store, id, {
        category: ändring.category ?? flow.category,
        subcategory: ändring.subcategory ?? flow.subcategory,
      }),
    );
  }
  return ut;
}

export interface SaveInput {
  name: string;
  /** Kategorin i katalogen. Tom sträng = ingen egen, reglerna gäller. */
  category?: string;
  /** Underkategorin i katalogen. Tom sträng = de härledda nivåerna gäller. */
  subcategory?: string;
  rawText: string;
  aiText?: string;
  draft: ProcessDraft;
  view?: FlowView;
  /** Frivillig kommentar på versionen. */
  label?: string;
  /** Vem som justerade (se FlowVersion.savedBy). */
  savedBy?: string;
  /**
   * Statusen sparningen ska få. Saknas = utkast. "fastslagen" räknar upp
   * huvudversionen – det är alltid ett aktivt val, aldrig något som ärvs från
   * föregående sparning.
   */
  status?: FlowStatus;
  /** Id-prefix (verktygsfamilj), t.ex. AP_FLOW_PREFIX. Saknas = flödesschema. */
  idPrefix?: string;
  /**
   * Det ÖPPNADE flödets id. Finns det ska sparningen uppdatera just det flödet
   * – även om namnet ändrats (då är det en omdöpning, inte ett nytt flöde).
   *
   * Utan detta härleddes id:t ur namnet vid varje sparning. Ett flöde vars id
   * inte råkade vara exakt namnets slug (t.ex. skapat av ett skript) klonades
   * då till ett NYTT flöde med samma namn, och biblioteket fylldes av par som
   * inte gick att skilja åt.
   */
  id?: string;
}

/**
 * "Id:t finns, men det är inte ditt." Bryggan svarar 404 på en GET av en
 * process i någon annans egen katalog (den ska inte gå att se), och säger det
 * först när man försöker SPARA på id:t: 403 med `kod: "upptaget"`.
 */
const ärUpptaget = (e: unknown) => e instanceof BryggFel && e.status === 403 && e.kod === "upptaget";

/**
 * Sparar och lägger till en version.
 *
 * Läser först befintlig historik och lägger den nya versionen sist. Är
 * innehållet identiskt med senaste versionen skapas INGEN ny version – annars
 * skulle listan fyllas av dubbletter varje gång man klickar Spara av vana.
 * Att återgå till en gammal version och spara skapar däremot en ny version;
 * historiken skrivs aldrig om, bara på.
 *
 * STATUSBYTE RÄKNAS ALLTID SOM EN ÄNDRING. Att fastslå ett flöde man just
 * sparat ändrar ingen text – men det är hela poängen med handlingen, och utan
 * undantaget hade dubblettskyddet ätit upp den och huvudversionen aldrig
 * skapats. Statusen sätts därför bara på den NYA posten; äldre versioner
 * behåller sin för alltid.
 */
export async function saveFlowVersion(store: FlowStore, input: SaveInput): Promise<SavedFlow> {
  const bas = input.id ?? (input.idPrefix ?? "") + flowId(input.name);
  /**
   * Ett NYTT flöde vars id redan används av en process i någon annans egen
   * katalog: den syns inte, men filen finns. Nästa lediga id tas i stället
   * (`…-2`, `…-3`) – annars hade två personer aldrig kunnat ha var sin
   * "Ny dator" i sina egna kataloger. Ett ÖPPNAT flöde byter aldrig id.
   */
  for (let n = 1; ; n++) {
    const id = n === 1 ? bas : `${bas.slice(0, 60)}-${n}`;
    try {
      return await sparaVersion(store, input, id);
    } catch (e) {
      if (!ärUpptaget(e)) throw e;
      if (input.id || n >= 99) throw new Error("Processen ligger i en annan användares katalog.");
    }
  }
}

async function sparaVersion(store: FlowStore, input: SaveInput, id: string): Promise<SavedFlow> {
  const existing = await store
    .load(id)
    .then(normalizeFlow)
    // Saknas (404) eller går inte att läsa: en ny process. Bryggan prövar
    // ändå sparningen mot filen – en sparning som skulle skriva över något
    // den inte sett avvisas där (server/atkomst.ts).
    .catch(() => null);
  const versions = existing?.versions ?? [];

  const next: FlowVersion = {
    id: `v${versions.length + 1}`,
    savedAt: new Date().toISOString(),
    label: input.label?.trim() || undefined,
    savedBy: input.savedBy?.trim() || undefined,
    status: normaliseraStatus(input.status),
    rawText: input.rawText,
    aiText: input.aiText?.trim() ? input.aiText : undefined,
    draft: input.draft,
  };

  const history = skaparNyVersion(versions, next)
    ? [...versions, next].slice(-MAX_VERSIONS)
    : versions;

  const flow: SavedFlow = {
    // Posten SPRIDS (invariant 4): det sparningen inte känner till – t.ex.
    // publiceringen – följer med orört. Byggd fält för fält tappade den varje
    // uppgift som lagts på flödet utanför sparningen.
    ...existing,
    id,
    name: input.name.trim(),
    // PLACERINGEN ÄGS AV KATALOGEN (invariant 11). `undefined` betyder "rörde
    // den inte" och behåller det som står i filen; en tom STRÄNG är ett aktivt
    // val och betyder "ingen egen kategori", så att reglerna i flow-tree.ts
    // gäller precis som för de gamla filerna.
    //
    // Skillnaden är inte akademisk: verktyget läser kategorin när flödet
    // ÖPPNAS och håller den i sitt eget tillstånd. Flyttade man processen i
    // katalogen medan den låg öppen skrev nästa sparning tillbaka det gamla
    // värdet, och flytten "återuppstod på sin gamla plats" (beslut 2026-09-07).
    category:
      input.category === undefined ? existing?.category : input.category.trim() || undefined,
    subcategory:
      input.subcategory === undefined
        ? existing?.subcategory
        : input.subcategory.trim() || undefined,
    savedAt: next.savedAt,
    rawText: next.rawText,
    aiText: next.aiText,
    draft: next.draft,
    view: input.view,
    versions: history,
  };
  await store.save(flow);
  return flow;
}
