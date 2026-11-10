/**
 * Flödesbibliotekets NAVIGERINGSTRÄD: kategori → ärendetyp → målgrupp → flöde.
 *
 * Menyn var en platt lista med trettio rader som alla började med samma ord
 * (ärendetypens namn), avhuggna i en smal spalt. Det gick inte att se
 * vilket flöde som var vilket. Trädet gör det som beställdes: portalen
 * överst, sedan ärendetyp, sedan målgruppen som utför processen.
 *
 * TVÅ KÄLLOR, MEDVETET OLIKA:
 *  - Ärendetypen kommer ur flödets ID – det är stabilt och sätts när flödet
 *    skapas, till skillnad från namnet som kan skrivas om.
 *  - Målgruppen kommer ur FLÖDET SJÄLV: banan där startpunkten ligger, alltså
 *    den som faktiskt utför processen (`FlowSummary.actor`). Att gissa rollen
 *    ur namnet hade fungerat för "… (handläggare)" men inte för "Genomförs"
 *    eller "Lås upp formulär", som inte nämner någon roll alls.
 *
 * Kortnamnet är namnet MINUS det som redan står i rubrikerna ovanför, så att
 * raden bär det som skiljer flödena åt.
 */

import { organisation } from "./organisation";
import { flowFamily, flowId, type FlowSummary } from "./flow-store";

export interface FlödesPost {
  flow: FlowSummary;
  /** Namnet utan ärendetyp och roll – de står redan som rubriker. */
  kortnamn: string;
}

export interface MålgruppsGren {
  id: string;
  titel: string;
  flöden: FlödesPost[];
}

export interface ÄrendeGren {
  id: string;
  titel: string;
  målgrupper: MålgruppsGren[];
  antal: number;
  /** true = användarens egen underkategori, inte en härledd ärendetyp. */
  egen?: boolean;
}

/**
 * KATEGORIN är trädets översta nivå: vilken samling processerna hör till.
 *
 * Ärendetypen säger vad ärendet ÄR, kategorin säger var det hör hemma.
 *
 * TVÅ KÄLLOR, i den här ordningen:
 *
 *  1. Flödets EGEN kategori (`FlowSummary.category`), satt av användaren när
 *     processen skapades. Den vinner alltid.
 *  2. De inbyggda REGLERNA nedan, för allt som saknar egen kategori. De finns
 *     kvar så att de trettio befintliga portalflödena hamnar där de alltid
 *     legat, utan att en enda fil behöver skrivas om.
 *
 * Att kategorin blev data och inte bara en regel är hela poängen: en
 * affärsprocess som ska ligga under "Systemförvaltning" går inte att uttrycka
 * som ett mönster i ett id, och en ny samling ska inte kräva en kodändring.
 *
 * NYCKELN ÄR TITELNS SLUG, inte regelns id. En process med den egna kategorin
 * "Systemprocesser" och en som får den ur regeln måste hamna i SAMMA gren –
 * annars skulle katalogen visa två rubriker med identisk text.
 *
 * Matchar varken kategori eller regel får flödet ingen egen nivå
 * (`kategoriFör` svarar null) och grenen namnges efter verktyget. Det är
 * affärsprocessernas fall så länge de inte fått en kategori.
 */
export interface Kategori {
  id: string;
  titel: string;
}

/** En inbyggd regel: kategorin flöden UTAN egen kategori hamnar i. */
interface Kategoriregel extends Kategori {
  test: (id: string) => boolean;
}

/**
 * FÖRSTA TRÄFFEN VINNER, precis som för ärendetyperna: en ny och mer specifik
 * regel läggs alltså FÖRE Systemprocesser, som är flödesschemanas uppsamling.
 */
export const KATEGORIER: Kategoriregel[] = [
  {
    id: "systemprocesser",
    // Installationens namn på samlingen (core/organisation.ts) – läst vid
    // varje användning, så att valet hinner fram innan katalogen ritas.
    get titel() {
      return organisation().systemprocesskategori;
    },
    test: (id) => flowFamily(id) === "flode",
  },
];

/** Kategorin av en titel. Slugen är grenens nyckel – se resonemanget ovan. */
export function kategoriAvTitel(titel: string): Kategori {
  return { id: flowId(titel), titel: titel.trim() };
}

/**
 * Kategorin ett flöde hör till, eller null när varken egen kategori eller
 * regel matchar.
 */
export function kategoriFör(flow: Pick<FlowSummary, "id" | "category">): Kategori | null {
  const egen = flow.category?.trim();
  if (egen) return kategoriAvTitel(egen);
  const regel = KATEGORIER.find((k) => k.test(flow.id));
  return regel ? { id: regel.id, titel: regel.titel } : null;
}

/**
 * UNDERKATEGORIN är nivån under kategorin: den gren användaren själv skapat
 * inuti sin samling ("DEMO → Utbildning"). Saknas den gäller de HÄRLEDDA
 * nivåerna (ärendetyp → målgrupp) precis som förut – det är så portalens
 * trettio flöden behåller sin indelning utan att någon fil skrivs om.
 */
export function underkategoriFör(flow: Pick<FlowSummary, "subcategory">): string | null {
  return flow.subcategory?.trim() || null;
}

/** Grenens id för en underkategori. Prefixet skiljer den från ärendetypernas. */
export function underkategoriId(titel: string): string {
  return `under-${flowId(titel)}`;
}

/**
 * Underkategorititlarna som finns – valfritt begränsat till EN kategori, så att
 * väljaren erbjuder grenarna i den samling processen faktiskt hamnar i.
 */
export function underkategoriTitlar(
  flöden: Array<Pick<FlowSummary, "id" | "category" | "subcategory">>,
  kategori?: string,
): string[] {
  const iKategorin = kategori?.trim() ? kategoriAvTitel(kategori).id : null;
  const sedda = new Map<string, string>();
  for (const f of flöden) {
    if (iKategorin && kategoriFör(f)?.id !== iKategorin) continue;
    const under = underkategoriFör(f);
    if (under && !sedda.has(underkategoriId(under))) sedda.set(underkategoriId(under), under);
  }
  return [...sedda.values()].sort(ordning);
}

/**
 * Kategorititlarna som FINNS i biblioteket, i visningsordning. Vyn "Ny process"
 * erbjuder dem så att man kan lägga en process i en befintlig samling utan att
 * stava om dess namn – en felstavning hade tyst skapat en andra gren.
 */
export function kategoriTitlar(flöden: Array<Pick<FlowSummary, "id" | "category">>): string[] {
  const sedda = new Map<string, string>();
  for (const f of flöden) {
    const kat = kategoriFör(f);
    if (kat && !sedda.has(kat.id)) sedda.set(kat.id, kat.titel);
  }
  return [...sedda.values()].sort(ordning);
}

export interface KategoriGren {
  /** null = flöden utan kategori. Menyn ritar dem direkt under verktyget. */
  kategori: Kategori | null;
  ärendetyper: ÄrendeGren[];
  antal: number;
}

/** Ärendetyperna i den ordning de ska visas. Sist: det som gäller flera typer. */
export interface Ärendetyp {
  id: string;
  titel: string;
  test: (id: string) => boolean;
}

/**
 * STANDARDLISTAN – en installations portal, inbyggd sedan menyn byggdes.
 * Den är organisationsspecifik och ska lyftas ut i installationens
 * inställningar (eller dess innehållspaket); tills dess är den standard så att
 * menyn inte ändrar beteende. Läs den ALDRIG direkt – gå via `ärendetyper()`,
 * så att en installation (och testerna) kan sätta en egen lista med
 * `sättÄrendetyper`.
 */
const ÄRENDETYPER: Ärendetyp[] = [
  {
    id: "felanmalan",
    titel: "Felanmälan",
    test: (id) => id.startsWith("felanmalan") && !id.startsWith("felanmalan-och-"),
  },
  { id: "bestallning", titel: "Beställning", test: (id) => id.startsWith("bestallning") },
  {
    id: "utvecklingsforslag",
    titel: "Utvecklingsförslag",
    test: (id) => id.startsWith("utvecklingsforslag"),
  },
  // Avvikelse och incident är EN ärendetyp i portalen med en typväxel inuti
  // ("Byt ärendetyp") – därför en gren, inte två.
  { id: "avvikelse", titel: "Avvikelse och incident", test: (id) => id.startsWith("avvikelse") },
  // Reduktion/rabatt har ingen godkännare – handläggaren beslutsattesterar –
  // och tre flöden som Power Automate startar själv (målgruppen "Automatiskt").
  { id: "reduktion", titel: "Reduktion/rabatt", test: (id) => id.startsWith("reduktion") },
  // Allt som inte hör till EN ärendetyp: delade kommentarsflöden och de
  // schemalagda flödena som går över alla ärenden.
  { id: "gemensamt", titel: "Gemensamt", test: () => true },
];

/** Den lista som gäller just nu: satt med `sättÄrendetyper`, annars standardlistan. */
let satta: Ärendetyp[] | null = null;

/**
 * Ärendetyperna i visningsordning. Den SISTA är reservgrenen (allt som inte
 * hör till en ärendetyp) och ska därför matcha allt.
 */
export function ärendetyper(): Ärendetyp[] {
  return satta ?? ÄRENDETYPER;
}

/** Sätter installationens ärendetyper; `null` återställer standardlistan. */
export function sättÄrendetyper(lista: Ärendetyp[] | null): void {
  satta = lista;
}

/** Målgrupperna i visningsordning. Nyckeln är banan där startpunkten ligger. */
const MÅLGRUPPER: Array<{ id: string; titel: string; banor: string[] }> = [
  { id: "anvandare", titel: "Användaren", banor: ["Användare"] },
  { id: "handlaggare", titel: "Handläggaren", banor: ["Handläggare"] },
  { id: "godkannare", titel: "Godkännaren", banor: ["Godkännare"] },
  {
    id: "handl-godk",
    titel: "Handläggare eller godkännare",
    banor: ["Handläggare/Godkännare"],
  },
  {
    id: "automatiskt",
    titel: "Automatiskt (schemalagt)",
    banor: ["Power Automate", "Integrationer"],
  },
];

const ÖVERSIKT = { id: "oversikt", titel: "Översikt" };
/**
 * Målgruppen i en EGEN underkategori: ingen alls. Flödena listas direkt under
 * grenen, utan en mellanrubrik som användaren varken valt eller kan ändra.
 * Tom titel = renderarna hoppar över rubriken.
 */
const EGEN_GRUPP = { id: "alla", titel: "" };
const OKÄND = { id: "ovrigt", titel: "Övrigt" };

/** En översiktsbild hör inte till någon målgrupp – den visar allas processer. */
function ärÖversikt(flow: FlowSummary): boolean {
  return flow.id.includes("oversikt") || /översikt/i.test(flow.name);
}

/**
 * Ärendetypen ett flödes-id hör till. Exporterad så att översiktsbilderna
 * (`scripts/bygg-oversikter.mts`) delar indelning med menyn – annars kan en ny
 * ärendetyp dyka upp i menyn utan att få en översikt, eller tvärtom.
 */
export function ärendetypFör(id: string): Ärendetyp {
  const typer = ärendetyper();
  return typer.find((t) => t.test(id)) ?? typer[typer.length - 1];
}

function målgruppFör(flow: FlowSummary) {
  if (ärÖversikt(flow)) return ÖVERSIKT;
  const bana = flow.actor?.trim();
  if (!bana) return OKÄND;
  return MÅLGRUPPER.find((m) => m.banor.includes(bana)) ?? { id: `bana-${bana}`, titel: bana };
}

/**
 * Namnet utan ärendetypens prefix och rollens parentes.
 * "Driftfråga - kommentera ärendet (godkännare)" → "Kommentera ärendet"
 * Blir det tomt (namnet ÄR bara ärendetypen) behålls hela namnet.
 */
export function kortnamn(namn: string, ärendetypTitel: string): string {
  let t = namn.trim();
  /**
   * LÄNGST PREFIX VINNER. De sammansatta ("Driftfråga och inköpsorder") måste
   * provas före de enkla, annars kapar "Driftfråga" halva prefixet och lämnar
   * "Och inköpsorder - ny kommentar".
   *
   * REGRESSION: grenens egen titel stod först i listan och slog ut just den
   * ordningen – ett delat flöde visat under "Driftfråga" fick "Och inköpsorder
   * – ny kommentar" som rad. Längdsorteringen kan inte hamna i den fällan:
   * det mest specifika prefixet är alltid det längsta.
   */
  const typer = ärendetyper();
  const prefix = [
    ärendetypTitel,
    ...typer.flatMap((a) =>
      typer.filter((b) => b.id !== a.id).map((b) => `${a.titel} och ${b.titel.toLowerCase()}`),
    ),
    ...typer.map((a) => a.titel),
  ].sort((a, b) => b.length - a.length);
  for (const p of prefix) {
    if (!t.toLowerCase().startsWith(p.toLowerCase())) continue;
    const rest = t.slice(p.length);
    /**
     * Prefixet måste sluta vid en ORDGRÄNS. Utan det kapade rubriken "Arkiv"
     * mitt i ordet och "Arkivering av ritningar" blev "Ering av ritningar" –
     * synligt så fort man fick namnge grenarna själv, men lika trasigt för de
     * inbyggda ("Inköpsorderrad …" hade blivit "Rad …").
     */
    if (rest && !/^[\s\-–—:]/.test(rest)) continue;
    t = rest.replace(/^\s*[-–—:]\s*/, "").trim();
    break;
  }
  t = t.replace(/\s*\((användare|handläggare|godkännare)\)\s*$/i, "").trim();
  if (!t) return namn;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Bokstavsordning på svenska – används av kategorilistan. */
function ordning(a: string, b: string): number {
  return a.localeCompare(b, "sv");
}

/**
 * Bygger trädet. Tomma grenar utelämnas, så menyn visar bara det som finns.
 * Sorteringen är alfabetisk på kortnamnet – menyn ska gå att läsa som en
 * innehållsförteckning, inte som en historik.
 */
export function byggFlödesträd(flöden: FlowSummary[]): ÄrendeGren[] {
  const grenar: ÄrendeGren[] = ärendetyper().map((t) => ({
    id: t.id,
    titel: t.titel,
    målgrupper: [],
    antal: 0,
  }));

  for (const flow of flöden) {
    /**
     * Har flödet en EGEN underkategori ersätter den både ärendetypen och
     * målgruppen: strukturen är då användarens, och en påhängd rubrik
     * ("Gemensamt", "Användaren") hade bara varit brus i hennes egen samling.
     * Saknas den gäller reglerna precis som förut.
     */
    const under = underkategoriFör(flow);
    const typ = ärendetypFör(flow.id);
    const grenId = under ? underkategoriId(under) : typ.id;
    const grenTitel = under ?? typ.titel;
    let gren = grenar.find((g) => g.id === grenId);
    if (!gren) {
      gren = { id: grenId, titel: grenTitel, målgrupper: [], antal: 0, egen: true };
      grenar.push(gren);
    }
    const mål = under ? EGEN_GRUPP : målgruppFör(flow);
    let grupp = gren.målgrupper.find((m) => m.id === mål.id);
    if (!grupp) {
      grupp = { id: mål.id, titel: mål.titel, flöden: [] };
      gren.målgrupper.push(grupp);
    }
    grupp.flöden.push({ flow, kortnamn: kortnamn(flow.name, grenTitel) });
    gren.antal++;
  }

  const ordning = [ÖVERSIKT.id, ...MÅLGRUPPER.map((m) => m.id), OKÄND.id];
  for (const gren of grenar) {
    gren.målgrupper.sort((a, b) => {
      const ia = ordning.indexOf(a.id);
      const ib = ordning.indexOf(b.id);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.titel.localeCompare(b.titel, "sv");
    });
    for (const m of gren.målgrupper) {
      m.flöden.sort((a, b) => a.kortnamn.localeCompare(b.kortnamn, "sv"));
    }
  }

  /**
   * Reglernas grenar behåller sin ordning (ärendetypernas egen); egna
   * underkategorier läggs sist i bokstavsordning. Sorterades allt alfabetiskt
   * kunde en ny gren hamna ovanför de ärendetyper man arbetar i dagligen.
   */
  const kvar = grenar.filter((g) => g.antal > 0);
  return [
    ...kvar.filter((g) => !g.egen),
    // (`ordning` är upptaget här inne av målgruppslistan – jämför direkt.)
    ...kvar.filter((g) => g.egen).sort((a, b) => a.titel.localeCompare(b.titel, "sv")),
  ];
}

/** Filtrerar trädet på en fritext (namn eller kortnamn). Tomma grenar faller bort. */
export function filtreraTräd(grenar: ÄrendeGren[], fråga: string): ÄrendeGren[] {
  const q = fråga.trim().toLowerCase();
  if (!q) return grenar;
  return grenar
    .map((g) => {
      const målgrupper = g.målgrupper
        .map((m) => ({
          ...m,
          flöden: m.flöden.filter(
            (f) =>
              f.kortnamn.toLowerCase().includes(q) ||
              f.flow.name.toLowerCase().includes(q) ||
              // Rubrikerna räknas också: "handläggare" ska hitta hela gruppen.
              m.titel.toLowerCase().includes(q) ||
              g.titel.toLowerCase().includes(q),
          ),
        }))
        .filter((m) => m.flöden.length > 0);
      return { ...g, målgrupper, antal: målgrupper.reduce((n, m) => n + m.flöden.length, 0) };
    })
    .filter((g) => g.antal > 0);
}

/**
 * Bygger hela trädet: kategori → ärendetyp → målgrupp → flöde.
 *
 * Kategorin läggs som ett SKAL runt `byggFlödesträd`, inte som en fjärde
 * dimension inuti den. Ärendetypsträdet är redan prövat mot de riktiga
 * flödena, och en gruppering som bara sorterar färdiga grenar kan inte råka
 * ändra hur de byggs.
 *
 * Flöden utan kategori hamnar i en egen gren med `kategori: null`, sist –
 * annars hade affärsprocessverktygets processer försvunnit ur menyn helt.
 */
export function byggKategoriträd(flöden: FlowSummary[]): KategoriGren[] {
  const UTAN = "";
  const per = new Map<string, { kategori: Kategori | null; flöden: FlowSummary[] }>();

  for (const flow of flöden) {
    const kat = kategoriFör(flow);
    const nyckel = kat?.id ?? UTAN;
    let post = per.get(nyckel);
    if (!post) per.set(nyckel, (post = { kategori: kat, flöden: [] }));
    post.flöden.push(flow);
  }

  /**
   * De inbyggda kategorierna först, i sin egen ordning; därefter användarens
   * egna i bokstavsordning; sist grenen utan kategori. Sorterades allt
   * alfabetiskt skulle en ny samling kunna hamna ovanför portalens processer,
   * som är de man arbetar med dagligen.
   */
  const inbyggda = KATEGORIER.map((k) => k.id);
  const plats = (nyckel: string) => {
    if (nyckel === UTAN) return Number.MAX_SAFE_INTEGER;
    const i = inbyggda.indexOf(nyckel);
    return i === -1 ? inbyggda.length : i;
  };

  return [...per.entries()]
    .sort(
      ([a, pa], [b, pb]) =>
        plats(a) - plats(b) || (pa.kategori?.titel ?? "").localeCompare(pb.kategori?.titel ?? "", "sv"),
    )
    .map(([, post]) => ({
      kategori: post.kategori,
      ärendetyper: byggFlödesträd(post.flöden),
      antal: post.flöden.length,
    }))
    .filter((g) => g.antal > 0);
}

/**
 * Samma filter som `filtreraTräd`, en nivå upp. Tomma kategorier faller bort.
 *
 * Kategorins rubrik räknas som träff, precis som ärendetypens och målgruppens:
 * söker man "portalen" vill man se portalens processer, inte ingenting.
 */
export function filtreraKategorier(grenar: KategoriGren[], fråga: string): KategoriGren[] {
  const q = fråga.trim().toLowerCase();
  return grenar
    .map((g) => {
      if (q && g.kategori?.titel.toLowerCase().includes(q)) return g;
      const ärendetyper = filtreraTräd(g.ärendetyper, fråga);
      return { ...g, ärendetyper, antal: ärendetyper.reduce((n, t) => n + t.antal, 0) };
    })
    .filter((g) => g.antal > 0);
}
