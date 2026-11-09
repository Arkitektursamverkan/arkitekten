/**
 * Behörigheter – VEM som får göra VAD med en process eller en ramserie.
 *
 * EN REGEL, EN PLATS (invariant 1). Bryggan (server/brygga.ts) verkställer
 * reglerna – den är den enda som faktiskt kan säga nej – och appen frågar SAMMA
 * funktioner för att veta vilka knappar den ska visa. Med två kopior hade en
 * knapp kunnat lova något som servern sedan vägrar, eller tvärtom gömma något
 * man har rätt till. Modulen är beroendefri (ren TS, inget DOM) av samma skäl
 * som core/status.ts: både bryggan och webbläsaren laddar den.
 *
 * YTAN ÄR HÄRLEDD, INTE LAGRAD. Ett flöde ligger i
 *   - "egen"     – om det har en `ägare` (en användares egen katalog),
 *   - "demo"     – annars om kategorin är Demo (offentlig för alla),
 *   - "gemensam" – annars. Det är den gemensamma katalogen (affärsprocesserna,
 *                  portalen …), och alla flöden som fanns före
 *                  inloggningen hamnar här utan att en enda fil skrivs om.
 * Ägaren skrivs bara av bryggan: vid skapandet och när ytan byts
 * (`/__ark/flows/:id/yta`). En vanlig sparning kan aldrig ändra den.
 */

/** Rollerna, i stigande makt. Entra-appens approller mappas hit (server/auth.ts). */
export type Roll = "admin" | "user";

export interface Användare {
  /** Stabilt id – Entra-kontots `oid`. Aldrig e-postadressen, den kan bytas. */
  id: string;
  namn: string;
  epost?: string;
  roller: Roll[];
}

/** Ägaren som står på en egen process. Namnet följer med för att kunna visas. */
export interface Ägare {
  id: string;
  namn: string;
}

export type Yta = "gemensam" | "demo" | "egen";

/** Kategorin som gör en process offentlig. Samma titel som katalogen visar. */
export const DEMO_KATEGORI = "Demo";

/** Ytornas namn i gränssnittet – samma ord i menyn, katalogen och rubriken. */
export const YTOR: ReadonlyArray<{ id: Yta; titel: string; beskrivning: string }> = [
  {
    id: "gemensam",
    titel: "Gemensam katalog",
    beskrivning: "Organisationens processer. Alla kan läsa, administratörer ändrar och fastslår.",
  },
  {
    id: "demo",
    titel: "Demo",
    beskrivning: "Offentlig yta – alla inloggade kan läsa och ändra.",
  },
  {
    id: "egen",
    titel: "Mina processer",
    beskrivning: "Bara du ser dem. Flytta en process till den gemensamma katalogen när den är klar.",
  },
];

export function ytaTitel(yta: Yta): string {
  return YTOR.find((y) => y.id === yta)?.titel ?? yta;
}

/** Det reglerna behöver veta om ett flöde – passar både SavedFlow och FlowSummary. */
export interface HarYta {
  ägare?: Ägare;
  category?: string;
}

export function ytaFör(flow: HarYta): Yta {
  if (flow.ägare?.id) return "egen";
  if (flow.category?.trim().toLowerCase() === DEMO_KATEGORI.toLowerCase()) return "demo";
  return "gemensam";
}

export function ärAdmin(u: Användare | null | undefined): boolean {
  return Boolean(u?.roller.includes("admin"));
}

function ärÄgare(u: Användare | null | undefined, flow: HarYta): boolean {
  return Boolean(u && flow.ägare?.id === u.id);
}

/**
 * Läsa. Gemensamt och demo läser alla inloggade; en egen process bara ägaren –
 * och administratören, som annars inte kan ta hand om processerna efter någon
 * som slutat.
 */
export function kanLäsa(u: Användare | null | undefined, flow: HarYta): boolean {
  if (!u) return false;
  return ytaFör(flow) !== "egen" || ärÄgare(u, flow) || ärAdmin(u);
}

/**
 * Ändra innehållet (spara en ny version), och flytta processen INOM sin yta.
 * Den gemensamma katalogen ändras bara av administratörer – det är den som
 * gäller, och statusen där ska betyda något.
 */
export function kanRedigera(u: Användare | null | undefined, flow: HarYta): boolean {
  if (!u) return false;
  switch (ytaFör(flow)) {
    case "gemensam":
      return ärAdmin(u);
    case "demo":
      return true;
    case "egen":
      return ärÄgare(u, flow) || ärAdmin(u);
  }
}

/** Ta bort processen MED HELA HISTORIKEN. Demo är offentlig men inte fri att tömma. */
export function kanTaBort(u: Användare | null | undefined, flow: HarYta): boolean {
  if (!u) return false;
  if (ytaFör(flow) === "egen") return ärÄgare(u, flow) || ärAdmin(u);
  return ärAdmin(u);
}

/**
 * Byta yta. Den vanliga vägen är ägarens: egen → gemensam (eller demo) när
 * processen är klar. Att ta en process UR den gemensamma katalogen eller ur
 * demo – eller att flytta någon annans – är administratörens sak. Till "egen"
 * flyttar man bara till sig själv.
 */
export function kanByttaYta(u: Användare | null | undefined, flow: HarYta, till: Yta): boolean {
  if (!u) return false;
  const från = ytaFör(flow);
  if (från === till) return false;
  if (ärAdmin(u)) return true;
  return från === "egen" && ärÄgare(u, flow);
}

/** Publicera i EA-portalen: bara det som ligger i den gemensamma katalogen. */
export function kanPublicera(u: Användare | null | undefined, flow: HarYta): boolean {
  return ytaFör(flow) === "gemensam" && ärAdmin(u);
}

/**
 * Var en NY process hamnar. Med inloggning börjar allt i ens egen katalog (eller
 * i Demo, om man valt den kategorin) och delas med en uttrycklig flytt. Utan
 * inloggning ("öppen" drift, som före Entra) finns bara en användare och allt
 * hamnar i den gemensamma katalogen, precis som förut.
 */
export function ägareVidSkapande(
  u: Användare,
  läge: Inloggningsläge,
  flow: { category?: string },
): Ägare | undefined {
  if (läge === "öppen") return undefined;
  if (ytaFör(flow) === "demo") return undefined;
  return { id: u.id, namn: u.namn };
}

/** Skapa en ny process i en viss yta (det som `ägareVidSkapande` gav). */
export function kanSkapa(u: Användare | null | undefined, flow: HarYta): boolean {
  if (!u) return false;
  return ytaFör(flow) === "gemensam" ? ärAdmin(u) : ytaFör(flow) === "demo" || ärÄgare(u, flow);
}

/* ------------------------------------------------------------------ */
/* Visualisering (ramserier) – alla läser, skaparen ändrar             */
/* ------------------------------------------------------------------ */

export interface HarSkapare {
  skapadAv?: Ägare;
}

/**
 * Alla inloggade läser ramserier och skapar nya; bara den som skapade en serie
 * (eller admin) ändrar och tar bort den. En serie utan skapare (från före
 * fältet) är administratörens.
 *
 * REGRESSION: vem som helst kunde spara över någon annans serie – utan
 * historik var det en tyst förlust av den andras arbete.
 */
export function kanÄndraRamserie(u: Användare | null | undefined, serie: HarSkapare): boolean {
  if (!u) return false;
  return ärAdmin(u) || serie.skapadAv?.id === u.id;
}

/** Samma regel som att ändra – den som får skriva över serien får också ta bort den. */
export function kanTaBortRamserie(u: Användare | null | undefined, serie: HarSkapare): boolean {
  return kanÄndraRamserie(u, serie);
}

/* ------------------------------------------------------------------ */
/* Inloggningen                                                         */
/* ------------------------------------------------------------------ */

/**
 * "entra" = inloggning med Entra ID. "lokal" = installationens egna konton
 * (användarnamn och lösenord, server/konton.ts). "dev" = provinloggning (namn + roll),
 * påslagen uttryckligen med ARK_AUTH=dev. "öppen" = ingen inloggning, som före
 * Entra: alla är samma lokala administratör.
 */
export type Inloggningsläge = "entra" | "lokal" | "dev" | "öppen";

/** Användaren i öppen drift. Id:t är fast, så att en ägare satt i den kan följas. */
export const LOKAL_ANVÄNDARE: Användare = {
  id: "lokal",
  namn: "Lokal användare",
  roller: ["admin"],
};

export function rollEtikett(u: Användare): string {
  return ärAdmin(u) ? "Administratör" : "Användare";
}

/* ------------------------------------------------------------------ */
/* Indelningen i menyn och katalogen                                    */
/* ------------------------------------------------------------------ */

/**
 * Ytan SOM DEN SER UT FÖR MIG: en egen process är "Mina processer" för ägaren
 * och "Andra användares" för administratören som ser den.
 */
export type Ytgrupp = Yta | "andras";

export function ytgruppFör(u: Användare | null | undefined, flow: HarYta): Ytgrupp {
  const yta = ytaFör(flow);
  return yta === "egen" && !ärÄgare(u, flow) ? "andras" : yta;
}

const GRUPPORDNING: Ytgrupp[] = ["gemensam", "demo", "egen", "andras"];

export function ytgruppTitel(g: Ytgrupp): string {
  return g === "andras" ? "Andra användares processer" : ytaTitel(g);
}

/**
 * Vems processen är, i klartext: "Anna", eller "Anna · skapad av Bo" när den
 * flyttats till någon annans katalog. `undefined` för en process utan ägare.
 */
export function vemsProcess(flow: HarYta & { skapadAv?: Ägare }): string | undefined {
  const ägare = flow.ägare?.namn?.trim();
  if (!ägare) return undefined;
  const skapare = flow.skapadAv?.namn?.trim();
  return skapare && flow.skapadAv?.id !== flow.ägare?.id ? `${ägare} · skapad av ${skapare}` : ägare;
}

/** Ägarna i en uppsättning processer, var och en en gång, i bokstavsordning. */
export function ägarnamn(flöden: HarYta[]): string[] {
  const namn = new Set(flöden.map((f) => f.ägare?.namn?.trim()).filter((n): n is string => Boolean(n)));
  return [...namn].sort((a, b) => a.localeCompare(b, "sv"));
}

export function ytgruppBeskrivning(g: Ytgrupp): string {
  return g === "andras"
    ? "Egna kataloger som bara du som administratör ser. Flytta en process härifrån om ägaren slutat."
    : (YTOR.find((y) => y.id === g)?.beskrivning ?? "");
}

export interface Ytdel<T> {
  id: Ytgrupp;
  titel: string;
  beskrivning: string;
  flöden: T[];
  /** Hur många som står fastslagna respektive som utkast – svaret på "vad gäller?". */
  fastslagna: number;
  utkast: number;
}

/** Delar biblioteket i ytor, i fast ordning. Tomma ytor utelämnas. */
export function delaIYtor<T extends HarYta & { status?: string }>(
  flöden: T[],
  u: Användare | null | undefined,
): Ytdel<T>[] {
  return GRUPPORDNING.map((id) => {
    const urval = flöden.filter((f) => ytgruppFör(u, f) === id);
    const fastslagna = urval.filter((f) => f.status === "fastslagen").length;
    return {
      id,
      titel: ytgruppTitel(id),
      beskrivning: ytgruppBeskrivning(id),
      flöden: urval,
      fastslagna,
      utkast: urval.length - fastslagna,
    };
  }).filter((d) => d.flöden.length > 0);
}
