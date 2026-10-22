/**
 * Statusar och versionsnumrering – REGELN BOR HÄR, inte hos den som frågar.
 *
 * Varför modulen finns: ett diagram som klistras in i ett styrdokument måste
 * kunna säga om det är ett arbetsmaterial eller det som gäller. Trappan är
 * avsiktligt kort – två lägen:
 *
 *   utkast      arbetsmaterial, gäller inte
 *   fastslagen  det som gäller → ger en HUVUDVERSION (1.0, 2.0, 3.0 …)
 *
 * Numreringen är HÄRLEDD ur historiken, aldrig lagrad. En sparad fil bär bara
 * `status` per version; beteckningen räknas fram vid läsning. Därför kan en
 * beteckning aldrig glida ifrån statusen den beskriver, och gamla filer (utan
 * statusfält alls) får en giltig numrering utan migrering.
 *
 * Räkneregeln, i ordning genom historiken:
 *   fastslagen → nästa hela tal, minor noll   (1.0, 2.0 …)
 *   utkast     → minor + 1 på gällande huvudtal (0.1, 0.2, 1.1, 2.3 …)
 *
 * Före första fastslagna versionen är huvudtalet 0 – "det finns inget som
 * gäller än" syns då direkt i beteckningen.
 */

export type FlowStatus = "utkast" | "fastslagen";

/**
 * Status för en version som sparades innan statusar fanns, eller som saknar
 * fältet. Utkast är det ärliga svaret: ingen har fastslagit den.
 */
export const STANDARDSTATUS: FlowStatus = "utkast";

export interface StatusDef {
  id: FlowStatus;
  /** Etiketten i UI och i exportens revisionsruta. */
  etikett: string;
  /** Kort förklaring – knapptitel i sparraden. */
  beskrivning: string;
  /** true = statusen räknar upp huvudversionen. */
  huvudversion: boolean;
}

/** Statusarna i trappans ordning. */
export const STATUSAR: readonly StatusDef[] = [
  {
    id: "utkast",
    etikett: "Utkast",
    beskrivning: "Arbetsmaterial. Räknas upp som 1.1, 1.2 … under gällande huvudversion.",
    huvudversion: false,
  },
  {
    id: "fastslagen",
    etikett: "Fastslagen",
    beskrivning: "Det som gäller. Skapar en ny huvudversion (1.0, 2.0 …) och kan exporteras för sig.",
    huvudversion: true,
  },
];

/** Okänt eller saknat värde blir utkast – aldrig ett kast, aldrig fastslagen. */
export function normaliseraStatus(värde: unknown): FlowStatus {
  return STATUSAR.some((s) => s.id === värde) ? (värde as FlowStatus) : STANDARDSTATUS;
}

export function statusDef(värde: unknown): StatusDef {
  const id = normaliseraStatus(värde);
  return STATUSAR.find((s) => s.id === id)!;
}

/** "Utkast" / "Fastslagen". */
export function statusEtikett(värde: unknown): string {
  return statusDef(värde).etikett;
}

/** Det numreringen behöver av en version – inget mer, så testerna blir små. */
export interface HarStatus {
  status?: FlowStatus | string;
}

/**
 * Beteckning per version, samma ordning och längd som historiken.
 * En enda genomgång; alla andra frågor svaras ur den här listan.
 */
export function versionsBeteckningar(versioner: readonly HarStatus[]): string[] {
  let huvud = 0;
  let minor = 0;
  return versioner.map((v) => {
    if (statusDef(v.status).huvudversion) {
      huvud += 1;
      minor = 0;
      return `${huvud}.0`;
    }
    minor += 1;
    return `${huvud}.${minor}`;
  });
}

/** Beteckningen för EN version i historiken. Utanför listan = tom sträng. */
export function versionsBeteckning(versioner: readonly HarStatus[], index: number): string {
  if (index < 0 || index >= versioner.length) return "";
  return versionsBeteckningar(versioner)[index];
}

/** Beteckningen för den SENASTE versionen – det som flödet står på just nu. */
export function nuvarandeBeteckning(versioner: readonly HarStatus[]): string {
  return versionsBeteckning(versioner, versioner.length - 1);
}

/** Statusen flödet står på just nu = senaste versionens. Tom historik = utkast. */
export function nuvarandeStatus(versioner: readonly HarStatus[]): FlowStatus {
  return normaliseraStatus(versioner[versioner.length - 1]?.status);
}

/**
 * Index på den senaste fastslagna versionen, -1 om ingen finns.
 * Index och inte objektet: den som frågar behöver oftast BÅDE versionen och
 * dess beteckning, och beteckningen kräver positionen.
 */
export function senasteFastslagnaIndex(versioner: readonly HarStatus[]): number {
  for (let i = versioner.length - 1; i >= 0; i--) {
    if (statusDef(versioner[i].status).huvudversion) return i;
  }
  return -1;
}

/**
 * Det listningarna behöver veta om ett flödes status – i EN genomgång.
 *
 * Både biblioteket i webbläsaren och bryggans filläsning (server/brygga.ts)
 * använder den här funktionen, så att en rad i menyn och en rad i en JSON-fil
 * aldrig kan svara olika på "vilken version står flödet på?".
 */
export function sammanfattaStatus(versioner: readonly HarStatus[]): {
  status: FlowStatus;
  beteckning: string;
  fastslagenBeteckning?: string;
} {
  const beteckningar = versionsBeteckningar(versioner);
  const fast = senasteFastslagnaIndex(versioner);
  return {
    status: nuvarandeStatus(versioner),
    beteckning: beteckningar[beteckningar.length - 1] ?? "",
    fastslagenBeteckning: fast === -1 ? undefined : beteckningar[fast],
  };
}

/**
 * Den senaste fastslagna versionen med sin beteckning, eller null.
 * Generisk så att anroparen får tillbaka sin egen versionstyp (med draft osv.)
 * och inte en avskalad kopia.
 */
export function senasteFastslagna<T extends HarStatus>(
  versioner: readonly T[],
): { version: T; beteckning: string; index: number } | null {
  const i = senasteFastslagnaIndex(versioner);
  if (i === -1) return null;
  return { version: versioner[i], beteckning: versionsBeteckningar(versioner)[i], index: i };
}
