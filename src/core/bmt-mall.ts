/**
 * MALLEN för BMT-exporten, läst: det exporten behöver veta om mål-repositoryt
 * (`tools/affarsprocess/bmt.ts` bygger filen). Ligger i core, utan beroenden,
 * för att SERVERN ska pröva en uppladdad mall med samma läsare som exporten
 * sedan använder (`server/bmt-mall.ts`) – en regel, en plats.
 */

export interface BmtInställningar {
  /** XML-namnrymden (`targetNamespace` i mallens scheman). */
  namnrymd: string;
  /** Språkets id i mål-repositoryt (languages/<uuid>.xml). */
  språk: string;
  /** Språkets namn, t.ex. "Svenska". */
  språkNamn?: string;
  /** Beskrivningstypen texterna skrivs i ("Beskrivning"). Saknas = inga beskrivningar. */
  beskrivningstyp?: string;
  /**
   * Användaren som står som skapare av allt som exporteras. Verktyget sätter
   * alltid skapare på sina objekt, och användaren ska då finnas i users/.
   */
  användare?: { id: string; förnamn: string; efternamn?: string };
  /** Typsnittet på rutor och kopplingar. Saknas = verktygets eget val. */
  typsnitt?: string;
  /**
   * Filer ur en vanlig export från MÅL-repositoryt (sökväg → innehåll).
   * Repositoryts profil (config.xml), scheman, språk, användare och
   * beskrivningstyp följer med ordagrant – en fil utan dem gick inte att läsa in.
   */
  mall?: Record<string, string | Uint8Array>;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Läser exportens inställningar ur MALLEN (en export ur mål-repositoryt,
 * uppackad). Allt som hör till repositoryt hämtas här och ingen annanstans:
 * namnrymden ur modellschemats `targetNamespace`, språket ur languages/,
 * skaparen (den första användaren, eller `användareId`), beskrivningstypen
 * som heter "Beskrivning" och typsnittet mallens modeller använder.
 */
export function inställningarUrMall(
  mall: Record<string, Uint8Array>,
  val: { användareId?: string; beskrivningstyp?: string } = {},
): BmtInställningar {
  const avkod = new TextDecoder();
  const text = (n: string) => avkod.decode(mall[n]);
  const filer = Object.keys(mall);
  const schema = mall["models/schema.xsd"] ? text("models/schema.xsd") : "";
  const namnrymd = schema.match(/targetNamespace="([^"]+)"/)?.[1];
  if (!namnrymd) throw new Error("Mallen saknar modellschemat (models/schema.xsd) – är det en modellexport?");
  const språkFil = filer.find((n) => new RegExp(`^languages/${UUID}\\.xml$`).test(n));
  if (!språkFil) throw new Error("Mallen har inget språk (languages/).");
  const språk = språkFil.slice("languages/".length, -".xml".length);
  const användarFiler = filer.filter((n) => new RegExp(`^users/${UUID}\\.xml$`).test(n));
  const användareId = val.användareId ?? användarFiler[0]?.slice("users/".length, -".xml".length);
  const typFil = filer.find(
    (n) => new RegExp(`^description-types/${UUID}\\.xml$`).test(n) && /<title[^>]*>Beskrivning</.test(text(n)),
  );
  const beskrivningstyp = val.beskrivningstyp ?? typFil?.slice("description-types/".length, -".xml".length);
  const typsnitt = filer
    .filter((n) => n.startsWith("models/") && n.endsWith(".xml"))
    .map((n) => text(n).match(/<font-name>([^<]+)</)?.[1])
    .find(Boolean);
  const språkNamn = text(språkFil).match(/<title>([^<]+)</)?.[1];
  return {
    namnrymd,
    språk,
    språkNamn,
    beskrivningstyp,
    typsnitt,
    användare: användareId ? { id: användareId, förnamn: "Arkitekten" } : undefined,
    mall,
  };
}
