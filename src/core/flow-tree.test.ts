import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  byggFlödesträd,
  byggKategoriträd,
  filtreraKategorier,
  filtreraTräd,
  kategoriFör,
  kategoriTitlar,
  kortnamn,
  underkategoriTitlar,
} from "./flow-tree";
import { flowActor, flowFamily, type FlowSummary } from "./flow-store";
import { användTestärendetyper, återställÄrendetyper } from "./test-arendetyper";

/**
 * Testerna använder PÅHITTADE ärendetyper (`test-arendetyper.ts`), inte
 * standardlistan – den är en viss installations portal.
 */
beforeEach(användTestärendetyper);
afterEach(återställÄrendetyper);

/**
 * Några tester läser installationens flöden, som inte ligger i git. Utan dem,
 * som i en ren klon, hoppas de över. De prövar bara egenskaper som gäller
 * vilka flöden som helst – installationens egna namn prövas i dess `.lokalt/`.
 */
const FLÖDESKATALOG = path.resolve(__dirname, "../../flows");
const HAR_FLÖDEN =
  fs.existsSync(FLÖDESKATALOG) && fs.readdirSync(FLÖDESKATALOG).some((f) => f.endsWith(".json"));

/** Menyn ska stämma med de VERKLIGA flödena, inte bara med påhittade exempel. */
function riktigaFlöden(): FlowSummary[] {
  const dir = path.resolve(__dirname, "../../flows");
  if (!HAR_FLÖDEN) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const flow = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      return {
        id: flow.id,
        name: flow.name,
        savedAt: flow.savedAt,
        stepCount: flow.draft?.steps?.length ?? 0,
        versionCount: Math.max(1, flow.versions?.length ?? 0),
        actor: flowActor(flow.draft),
      };
    })
    .filter((f) => flowFamily(f.id) === "flode");
}

/** Samma läsning, men UTAN familjefiltret – kategorin skiljer familjerna åt. */
function allaFlöden(): FlowSummary[] {
  const dir = path.resolve(__dirname, "../../flows");
  if (!HAR_FLÖDEN) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const flow = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      return {
        id: flow.id,
        name: flow.name,
        savedAt: flow.savedAt,
        stepCount: flow.draft?.steps?.length ?? 0,
        versionCount: Math.max(1, flow.versions?.length ?? 0),
        actor: flowActor(flow.draft),
      };
    });
}

describe("kortnamn", () => {
  it("tar bort ärendetypen och rollen – de står redan som rubriker", () => {
    expect(kortnamn("Verksamhetsförslag - kommentera ärendet (godkännare)", "Verksamhetsförslag")).toBe(
      "Kommentera ärendet",
    );
    expect(kortnamn("Driftfråga - påminn mig (handläggare)", "Driftfråga")).toBe("Påminn mig");
    // Utan bindestreck fungerar det också ("Driftfråga ny").
    expect(kortnamn("Driftfråga ny", "Driftfråga")).toBe("Ny");
  });

  it("REGRESSION: prefixet kapas bara vid en ordgräns", () => {
    // "Arkiv" som rubrik fick inte göra "Arkivering av ritningar" till
    // "Ering av ritningar" – felet syntes när grenarna blev egna, men gällde
    // lika mycket de inbyggda ärendetyperna.
    expect(kortnamn("Arkivering av ritningar", "Arkiv")).toBe("Arkivering av ritningar");
    expect(kortnamn("Inköpsorderrad väljs", "Inköpsorder")).toBe("Inköpsorderrad väljs");
    // Med ordgräns kapas det som förut.
    expect(kortnamn("Arkiv – gallring", "Arkiv")).toBe("Gallring");
    expect(kortnamn("Arkiv gallring", "Arkiv")).toBe("Gallring");
  });

  it("behåller namnet när det inte börjar med ärendetypen", () => {
    expect(kortnamn("Vilande - skicka påminnelse", "Gemensamt")).toBe("Vilande - skicka påminnelse");
  });

  it("kapar den sammansatta ärendetypen 'Reklamation och skador'", () => {
    expect(
      kortnamn("Reklamation och skador - lås upp formulär (godkännare)", "Reklamation och skador"),
    ).toBe("Lås upp formulär");
  });

  /**
   * REGRESSION: grenens egen titel provades FÖRST, före de sammansatta. Ett
   * delat flöde visat under "Driftfråga" fick då "Driftfråga" bortkapat och
   * blev raden "Och inköpsorder - ny kommentar". Längst prefix ska vinna.
   */
  it("kapar hela det sammansatta prefixet, inte bara grenens egen titel", () => {
    expect(kortnamn("Driftfråga och inköpsorder - ny kommentar (användare)", "Driftfråga")).toBe(
      "Ny kommentar",
    );
    expect(kortnamn("Driftfråga och inköpsorder - ny kommentar (handläggare)", "Inköpsorder")).toBe(
      "Ny kommentar",
    );
  });

  it("prefixen kommer ur den ärendetypslista som är satt", () => {
    // Standardlistan gäller igen efter återställningen – en titel som bara
    // finns i testlistan kapas då inte längre.
    återställÄrendetyper();
    expect(kortnamn("Driftfråga - påminn mig", "Gemensamt")).toBe("Driftfråga - påminn mig");
    användTestärendetyper();
    expect(kortnamn("Driftfråga - påminn mig", "Gemensamt")).toBe("Påminn mig");
  });
});

describe("flödesträdet – påhittade flöden", () => {
  const post = (id: string, name: string, actor: string): FlowSummary => ({
    id,
    name,
    savedAt: "2026-09-01T10:00:00.000Z",
    stepCount: 5,
    versionCount: 1,
    actor,
  });

  it("delar in i ärendetyper i listans ordning, med det gemensamma sist", () => {
    const träd = byggFlödesträd([
      post("vilande-skicka-paminnelse", "Vilande - skicka påminnelse", "Power Automate"),
      post("reklamation-nytt", "Reklamation och skador - nytt", "Användare"),
      post("inkopsorder-ny", "Inköpsorder - ny", "Användare"),
      post("driftfraga-ny", "Driftfråga - ny", "Användare"),
      post("driftfraga-och-inkopsorder-ny-kommentar", "Driftfråga och inköpsorder - ny kommentar", "Användare"),
    ]);
    expect(träd.map((g) => g.id)).toEqual(["driftfraga", "inkopsorder", "reklamation", "gemensamt"]);
    // Det delade flödet hör inte till "driftfraga" trots prefixet.
    const gemensamt = träd.find((g) => g.id === "gemensamt")!;
    expect(gemensamt.målgrupper.flatMap((m) => m.flöden.map((f) => f.flow.id))).toContain(
      "driftfraga-och-inkopsorder-ny-kommentar",
    );
  });

  it("målgruppen kommer ur flödet, inte ur namnet", () => {
    // "Genomförs" nämner ingen roll men startar i godkännarens bana.
    const [gren] = byggFlödesträd([post("verksamhetsforslag-genomfors", "Verksamhetsförslag - genomförs", "Godkännare")]);
    expect(gren.målgrupper.map((m) => m.id)).toEqual(["godkannare"]);
    expect(gren.målgrupper[0].flöden[0].kortnamn).toBe("Genomförs");
  });

  it("översikten får en egen rubrik, först, inte en målgrupp", () => {
    const [gren] = byggFlödesträd([
      post("verksamhetsforslag-ny", "Verksamhetsförslag - ny", "Användare"),
      post("verksamhetsforslag-oversikt", "Verksamhetsförslag – vem triggar vad", "Användare"),
    ]);
    expect(gren.målgrupper.map((m) => m.id)).toEqual(["oversikt", "anvandare"]);
  });

  it("REGRESSION: två flöden med samma kortnamn skiljs åt av sin rubrik", () => {
    // "Kommentera ärendet" finns för både handläggare och godkännare. I den
    // gamla platta menyn stod de som två identiska, avhuggna rader.
    const [gren] = byggFlödesträd([
      post("verksamhetsforslag-kommentera-handlaggare", "Verksamhetsförslag - kommentera ärendet (handläggare)", "Handläggare"),
      post("verksamhetsforslag-kommentera-godkannare", "Verksamhetsförslag - kommentera ärendet (godkännare)", "Godkännare"),
    ]);
    const grupp = (id: string) => gren.målgrupper.find((m) => m.id === id)?.flöden.map((f) => f.kortnamn);
    expect(grupp("handlaggare")).toEqual(["Kommentera ärendet"]);
    expect(grupp("godkannare")).toEqual(["Kommentera ärendet"]);
  });

  it("schemalagda flöden hamnar under Automatiskt", () => {
    const träd = byggFlödesträd([post("vilande-skicka-paminnelse", "Vilande - skicka påminnelse", "Power Automate")]);
    expect(träd[0].målgrupper.map((m) => m.id)).toEqual(["automatiskt"]);
  });

  it("filtret hittar på både kortnamn och rubrik", () => {
    const träd = byggFlödesträd([
      post("driftfraga-ny", "Driftfråga - ny", "Användare"),
      post("driftfraga-godkann", "Driftfråga - godkänn", "Godkännare"),
      post("vilande-skicka-paminnelse", "Vilande - skicka påminnelse", "Power Automate"),
    ]);
    expect(filtreraTräd(träd, "vilande").flatMap((g) => g.målgrupper.flatMap((m) => m.flöden))).toHaveLength(1);
    const påRoll = filtreraTräd(träd, "godkännaren");
    expect(påRoll.every((g) => g.målgrupper.every((m) => m.titel === "Godkännaren"))).toBe(true);
    expect(påRoll.flatMap((g) => g.målgrupper)).toHaveLength(1);
    expect(filtreraTräd(träd, "finns-inte")).toEqual([]);
  });
});

describe.skipIf(!HAR_FLÖDEN)("flödesträdet – installationens flöden", () => {
  it("varje flöde hamnar i EXAKT en gren", () => {
    const alla = riktigaFlöden();
    const träd = byggFlödesträd(alla);
    const iTrädet = träd.flatMap((g) => g.målgrupper.flatMap((m) => m.flöden.map((f) => f.flow.id)));
    expect(new Set(iTrädet).size).toBe(iTrädet.length); // inga dubbletter
    expect(iTrädet.sort()).toEqual(alla.map((f) => f.id).sort());
  });

  it("filtret på något som inte finns ger ett tomt träd", () => {
    expect(filtreraTräd(byggFlödesträd(riktigaFlöden()), "finns-inte-någonstans")).toEqual([]);
  });
});

describe.skipIf(!HAR_FLÖDEN)("kategorin – trädets översta nivå", () => {
  it("samlar ALLA flödesschemats flöden under Systemprocesser", () => {
    const flöden = riktigaFlöden();
    const träd = byggKategoriträd(flöden);
    expect(träd).toHaveLength(1);
    expect(träd[0].kategori?.id).toBe("systemprocesser");
    expect(träd[0].kategori?.titel).toBe("Systemprocesser");
    expect(träd[0].antal).toBe(flöden.length);
  });

  it("behåller ärendetypsträdet oförändrat under kategorin", () => {
    const flöden = riktigaFlöden();
    // Skalet får inte ändra hur grenarna byggs – bara var de hänger.
    expect(byggKategoriträd(flöden)[0].ärendetyper).toEqual(byggFlödesträd(flöden));
  });

  it("varje flöde ligger i exakt en kategori, och inget tappas", () => {
    const flöden = riktigaFlöden();
    const iTrädet = byggKategoriträd(flöden).flatMap((k) =>
      k.ärendetyper.flatMap((g) => g.målgrupper.flatMap((m) => m.flöden.map((f) => f.flow.id))),
    );
    expect(new Set(iTrädet).size).toBe(iTrädet.length);
    expect(iTrädet.sort()).toEqual(flöden.map((f) => f.id).sort());
  });

  /**
   * Affärsprocessverktygets processer kommer inte ur portalen. De ska
   * ritas direkt under sitt verktyg – tvingas de in under en kategori de inte
   * hör till blir rubriken en lögn, och menyn får en nivå utan innehåll.
   */
  it.skipIf(!allaFlöden().some((f) => f.id.startsWith("ap-")))("affärsprocesserna får ingen kategori och ritas som förut", () => {
    const ap = allaFlöden().filter((f) => f.id.startsWith("ap-"));
    expect(kategoriFör(ap[0])).toBeNull();
    const träd = byggKategoriträd(ap);
    expect(träd).toHaveLength(1);
    expect(träd[0].kategori).toBeNull();
    expect(träd[0].antal).toBe(ap.length);
  });

  it("kategorilösa flöden hamnar sist", () => {
    const träd = byggKategoriträd(allaFlöden());
    const ids = träd.map((k) => k.kategori?.id ?? null);
    if (ids.includes(null)) expect(ids[ids.length - 1]).toBeNull();
    expect(filtreraKategorier(träd, "finns-inte-någonstans")).toEqual([]);
  });

  it("rubriken räknas som träff – en samlings namn ger samlingens processer", () => {
    const träd = byggKategoriträd(riktigaFlöden());
    const rubrik = träd[0].kategori?.titel ?? "";
    const träffar = filtreraKategorier(träd, rubrik.toLowerCase());
    expect(träffar.length).toBeGreaterThanOrEqual(1);
    expect(träffar[0].antal).toBe(träd[0].antal);
  });
});

/**
 * Kategorin är DATA, inte bara en regel. En affärsprocess som ska ligga under
 * "Systemförvaltning" går inte att uttrycka som ett mönster i ett id, och en ny
 * samling ska inte kräva en kodändring.
 */
describe("egen kategori", () => {
  const med = (id: string, category?: string): FlowSummary => ({
    id,
    name: "Rekrytera medarbetare",
    savedAt: "2026-09-01T10:00:00.000Z",
    stepCount: 5,
    versionCount: 1,
    actor: "Användare",
    category,
  });

  it("flödets egen kategori vinner över reglerna", () => {
    // Id:t säger "flödesschema", alltså Systemprocesser enligt regeln …
    expect(kategoriFör(med("inkopsorder-ny"))?.titel).toBe("Systemprocesser");
    // … men en egen kategori går före.
    expect(kategoriFör(med("inkopsorder-ny", "Systemförvaltning"))?.titel).toBe(
      "Systemförvaltning",
    );
  });

  it("en affärsprocess kan få en kategori trots att ingen regel matchar", () => {
    expect(kategoriFör(med("ap-rekrytera"))).toBeNull();
    expect(kategoriFör(med("ap-rekrytera", "Systemförvaltning"))?.titel).toBe("Systemförvaltning");
  });

  /**
   * REGRESSION: nyckeln måste komma ur TITELN, inte ur regelns id. Gjorde den
   * inte det hamnade en process med den egna kategorin "Systemprocesser" i en
   * annan gren än en som fick samma kategori ur regeln – och katalogen visade
   * två rubriker med identisk text.
   */
  it("REGRESSION: egen och regelhärledd kategori med samma titel blir EN gren", () => {
    const träd = byggKategoriträd([med("inkopsorder-ny"), med("ap-nagot", "Systemprocesser")]);
    expect(träd).toHaveLength(1);
    expect(träd[0].kategori?.titel).toBe("Systemprocesser");
    expect(träd[0].antal).toBe(2);
  });

  it("de inbyggda kategorierna står först, egna i bokstavsordning, kategorilösa sist", () => {
    const träd = byggKategoriträd([
      med("ap-utan"),
      med("ap-system", "Systemförvaltning"),
      med("ap-avtal", "Avtal"),
      med("inkopsorder-ny"),
    ]);
    expect(träd.map((k) => k.kategori?.titel ?? null)).toEqual([
      "Systemprocesser",
      "Avtal",
      "Systemförvaltning",
      null,
    ]);
  });

  it("kategorilistan visar det som finns, utan dubbletter", () => {
    expect(
      kategoriTitlar([
        med("inkopsorder-ny"),
        med("ap-system", "Systemförvaltning"),
        med("ap-system2", "Systemförvaltning"),
        med("ap-utan"),
      ]),
    ).toEqual(["Systemförvaltning", "Systemprocesser"]);
  });
});

/**
 * Underkategorin – nivån under kategorin, vald av användaren.
 *
 * Kravet är att kunna påverka strukturen själv: "kunna lägga till underkatalog
 * till DEMO". De härledda nivåerna (ärendetyp → målgrupp) är rätt för
 * portalens trettio flöden, men i en egen samling är "Gemensamt" och
 * "Användaren" bara rubriker man varken valt eller kan ändra.
 */
describe("underkategorin – nivån under kategorin", () => {
  const flöde = (id: string, category?: string, subcategory?: string): FlowSummary => ({
    id,
    name: "Rekrytera medarbetare",
    savedAt: "2026-09-01T10:00:00.000Z",
    stepCount: 5,
    versionCount: 1,
    actor: "Användare",
    category,
    subcategory,
  });

  it("ersätter både ärendetypen och målgruppen", () => {
    const [gren] = byggFlödesträd([flöde("ap-kurs", "Demo", "Utbildning")]);
    expect(gren.titel).toBe("Utbildning");
    expect(gren.egen).toBe(true);
    // Ingen målgruppsrubrik: flödet listas direkt under grenen.
    expect(gren.målgrupper).toHaveLength(1);
    expect(gren.målgrupper[0].titel).toBe("");
    expect(gren.målgrupper[0].flöden).toHaveLength(1);
  });

  it("flöden UTAN underkategori delas in som förut", () => {
    const [gren] = byggFlödesträd([flöde("driftfraga-ny")]);
    expect(gren.titel).toBe("Driftfråga");
    expect(gren.egen).toBeUndefined();
    expect(gren.målgrupper[0].titel).toBe("Användaren");
  });

  it("reglernas grenar står först, egna underkategorier sist i bokstavsordning", () => {
    const träd = byggFlödesträd([
      flöde("driftfraga-ny"),
      flöde("inkopsorder-ny", undefined, "Utbildning"),
      flöde("reklamation-ny", undefined, "Arkiv"),
    ]);
    expect(träd.map((g) => g.titel)).toEqual(["Driftfråga", "Arkiv", "Utbildning"]);
  });

  it("två flöden i samma underkategori hamnar i SAMMA gren", () => {
    const träd = byggFlödesträd([
      flöde("ap-a", "Demo", "Utbildning"),
      flöde("ap-b", "Demo", "Utbildning"),
    ]);
    expect(träd).toHaveLength(1);
    expect(träd[0].antal).toBe(2);
  });

  it("kategoriträdet bär underkategorierna under rätt kategori", () => {
    const träd = byggKategoriträd([
      flöde("ap-a", "Demo", "Utbildning"),
      flöde("ap-b", "Demo", "Arkiv"),
      flöde("driftfraga-ny"),
    ]);
    const demo = träd.find((k) => k.kategori?.titel === "Demo")!;
    expect(demo.ärendetyper.map((g) => g.titel)).toEqual(["Arkiv", "Utbildning"]);
    // Portalens flöden rörs inte.
    const portalen = träd.find((k) => k.kategori?.titel === "Systemprocesser")!;
    expect(portalen.ärendetyper.map((g) => g.titel)).toEqual(["Driftfråga"]);
  });

  it("väljaren erbjuder bara grenarna i den kategori man valt", () => {
    const flöden = [
      flöde("ap-a", "Demo", "Utbildning"),
      flöde("ap-b", "Demo", "Arkiv"),
      flöde("ap-c", "Systemförvaltning", "Integrationer"),
    ];
    expect(underkategoriTitlar(flöden, "Demo")).toEqual(["Arkiv", "Utbildning"]);
    expect(underkategoriTitlar(flöden, "Systemförvaltning")).toEqual(["Integrationer"]);
    // Utan kategori: allt som finns, utan dubbletter.
    expect(underkategoriTitlar(flöden)).toEqual(["Arkiv", "Integrationer", "Utbildning"]);
  });

  it("blanktecken räknas inte som en underkategori", () => {
    const [gren] = byggFlödesträd([flöde("driftfraga-ny", "Demo", "   ")]);
    expect(gren.titel).toBe("Driftfråga");
  });
});
