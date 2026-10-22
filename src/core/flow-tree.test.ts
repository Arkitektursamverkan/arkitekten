import { describe, expect, it } from "vitest";
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

/** Innehållet (flows/) ligger inte i git – i en ren klon hoppas testerna över. */
const HAR_FLÖDEN = fs.existsSync(path.resolve(__dirname, "../../flows"));

/** Menyn ska stämma med de VERKLIGA flödena, inte med påhittade exempel. */
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
    expect(kortnamn("Utvecklingsförslag - kommentera ärendet (godkännare)", "Utvecklingsförslag")).toBe(
      "Kommentera ärendet",
    );
    expect(kortnamn("Felanmälan - påminn mig (handläggare)", "Felanmälan")).toBe("Påminn mig");
    // Utan bindestreck fungerar det också ("Felanmälan ny").
    expect(kortnamn("Felanmälan ny", "Felanmälan")).toBe("Ny");
  });

  it("REGRESSION: prefixet kapas bara vid en ordgräns", () => {
    // "Arkiv" som rubrik fick inte göra "Arkivering av ritningar" till
    // "Ering av ritningar" – felet syntes när grenarna blev egna, men gällde
    // lika mycket de inbyggda ärendetyperna.
    expect(kortnamn("Arkivering av ritningar", "Arkiv")).toBe("Arkivering av ritningar");
    expect(kortnamn("Beställningsvara väljs", "Beställning")).toBe("Beställningsvara väljs");
    // Med ordgräns kapas det som förut.
    expect(kortnamn("Arkiv – gallring", "Arkiv")).toBe("Gallring");
    expect(kortnamn("Arkiv gallring", "Arkiv")).toBe("Gallring");
  });

  it("behåller namnet när det inte börjar med ärendetypen", () => {
    expect(kortnamn("Snooze - skicka påminnelse", "Gemensamt")).toBe("Snooze - skicka påminnelse");
  });

  it("kapar den sammansatta ärendetypen 'Avvikelse och incident'", () => {
    expect(
      kortnamn("Avvikelse och incident - lås upp formulär (godkännare)", "Avvikelse och incident"),
    ).toBe("Lås upp formulär");
  });

  /**
   * REGRESSION: grenens egen titel provades FÖRST, före de sammansatta. Ett
   * delat flöde visat under "Felanmälan" fick då "Felanmälan" bortkapat och
   * blev raden "Och beställning - ny kommentar". Längst prefix ska vinna.
   */
  it("kapar hela det sammansatta prefixet, inte bara grenens egen titel", () => {
    expect(kortnamn("Felanmälan och beställning - ny kommentar (användare)", "Felanmälan")).toBe(
      "Ny kommentar",
    );
    expect(kortnamn("Felanmälan och beställning - ny kommentar (handläggare)", "Beställning")).toBe(
      "Ny kommentar",
    );
  });
});

describe.skipIf(!HAR_FLÖDEN)("avvikelse och incident som egen ärendetyp", () => {
  /**
   * REGRESSION: avvikelseflödena föll ner i "Gemensamt" – grenen fanns inte –
   * och sjutton nya rader hamnade i en hög med de schemalagda flödena.
   */
  it("har en egen gren, och flödena ligger under sin målgrupp", () => {
    const träd = byggFlödesträd(riktigaFlöden());
    const gren = träd.find((g) => g.id === "avvikelse");
    expect(gren?.titel).toBe("Avvikelse och incident");
    expect(gren!.antal).toBeGreaterThanOrEqual(17);
    // Översikten först – den visar allas processer och hör till ingen målgrupp.
    expect(gren!.målgrupper.map((m) => m.id)).toEqual([
      "oversikt",
      "anvandare",
      "handlaggare",
      "godkannare",
    ]);
    // Ingen avvikelse ska ha ramlat ner i "Gemensamt".
    const gemensamt = träd.find((g) => g.id === "gemensamt");
    const felplacerade = (gemensamt?.målgrupper ?? []).flatMap((m) =>
      m.flöden.filter((f) => f.flow.id.startsWith("avvikelse")).map((f) => f.flow.name),
    );
    expect(felplacerade).toEqual([]);
  });
});

describe.skipIf(!HAR_FLÖDEN)("flödesträdet", () => {
  const träd = byggFlödesträd(riktigaFlöden());
  const gren = (id: string) => träd.find((g) => g.id === id);
  const grupp = (ärende: string, mål: string) =>
    gren(ärende)?.målgrupper.find((m) => m.id === mål);

  it("delar in i ärendetyper i läsordning, med det gemensamma sist", () => {
    expect(träd.map((g) => g.id)).toEqual([
      "felanmalan",
      "bestallning",
      "utvecklingsforslag",
      "avvikelse",
      "reduktion",
      "gemensamt",
    ]);
  });

  it("varje flöde hamnar i EXAKT en gren", () => {
    const alla = riktigaFlöden();
    const iTrädet = träd.flatMap((g) => g.målgrupper.flatMap((m) => m.flöden.map((f) => f.flow.id)));
    expect(new Set(iTrädet).size).toBe(iTrädet.length); // inga dubbletter
    expect(iTrädet.sort()).toEqual(alla.map((f) => f.id).sort());
  });

  it("målgruppen kommer ur flödet, inte ur namnet", () => {
    // "Genomförs" nämner ingen roll men startar i godkännarens bana.
    const godk = grupp("utvecklingsforslag", "godkannare");
    expect(godk?.flöden.map((f) => f.kortnamn)).toContain("Genomförs");
    // "Lås upp formulär" likaså.
    expect(godk?.flöden.map((f) => f.kortnamn)).toContain("Lås upp formulär");
    // Handläggarens processer i felanmälan.
    expect(grupp("felanmalan", "handlaggare")?.flöden.map((f) => f.kortnamn)).toEqual(
      expect.arrayContaining(["Chatt med användaren", "Påminn mig", "Sammankalla ITIS"]),
    );
  });

  it("schemalagda flöden hamnar under Automatiskt", () => {
    const auto = grupp("gemensamt", "automatiskt");
    expect(auto?.flöden.map((f) => f.kortnamn)).toEqual(
      expect.arrayContaining(["Snooze - skicka påminnelse", "Kommentarer - skicka påminnelser"]),
    );
    // Utvecklingsförslagens notisflöde ligger under sin egen ärendetyp.
    expect(grupp("utvecklingsforslag", "automatiskt")?.flöden.length).toBeGreaterThan(0);
  });

  it("översikten får en egen rubrik, inte en målgrupp", () => {
    const öv = grupp("utvecklingsforslag", "oversikt");
    expect(öv?.flöden).toHaveLength(1);
    expect(öv?.flöden[0].flow.id).toBe("utvecklingsforslag-oversikt");
  });

  it("REGRESSION: två flöden med samma kortnamn skiljs åt av sin rubrik", () => {
    // "Kommentera ärendet" finns för både handläggare och godkännare. I den
    // gamla platta menyn stod de som två identiska, avhuggna rader.
    const h = grupp("utvecklingsforslag", "handlaggare")?.flöden.map((f) => f.kortnamn) ?? [];
    const g = grupp("utvecklingsforslag", "godkannare")?.flöden.map((f) => f.kortnamn) ?? [];
    expect(h).toContain("Kommentera ärendet");
    expect(g).toContain("Kommentera ärendet");
  });

  it("filtret hittar på både kortnamn och rubrik", () => {
    expect(filtreraTräd(träd, "snooze").flatMap((g) => g.målgrupper.flatMap((m) => m.flöden))).toHaveLength(
      1,
    );
    const påRoll = filtreraTräd(träd, "godkännaren");
    expect(påRoll.every((g) => g.målgrupper.every((m) => m.titel === "Godkännaren"))).toBe(true);
    expect(filtreraTräd(träd, "finns-inte")).toEqual([]);
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
  it("affärsprocesserna får ingen kategori och ritas som förut", () => {
    const ap = allaFlöden().filter((f) => f.id.startsWith("ap-"));
    expect(ap.length).toBeGreaterThan(0);
    expect(kategoriFör(ap[0])).toBeNull();
    const träd = byggKategoriträd(ap);
    expect(träd).toHaveLength(1);
    expect(träd[0].kategori).toBeNull();
    expect(träd[0].antal).toBe(ap.length);
  });

  it("kategorilösa flöden hamnar sist", () => {
    const träd = byggKategoriträd(allaFlöden());
    expect(träd.map((k) => k.kategori?.id ?? null)).toEqual(["systemprocesser", null]);
  });

  it("filtret smalnar av genom kategorin, och tomma kategorier faller bort", () => {
    const träd = byggKategoriträd(riktigaFlöden());
    const träffar = filtreraKategorier(träd, "snooze");
    expect(träffar).toHaveLength(1);
    expect(
      träffar[0].ärendetyper.flatMap((g) => g.målgrupper.flatMap((m) => m.flöden)),
    ).toHaveLength(1);
    expect(filtreraKategorier(träd, "finns-inte")).toEqual([]);
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
    expect(kategoriFör(med("bestallning-ny"))?.titel).toBe("Systemprocesser");
    // … men en egen kategori går före.
    expect(kategoriFör(med("bestallning-ny", "Systemförvaltning"))?.titel).toBe(
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
    const träd = byggKategoriträd([med("bestallning-ny"), med("ap-nagot", "Systemprocesser")]);
    expect(träd).toHaveLength(1);
    expect(träd[0].kategori?.titel).toBe("Systemprocesser");
    expect(träd[0].antal).toBe(2);
  });

  it("de inbyggda kategorierna står först, egna i bokstavsordning, kategorilösa sist", () => {
    const träd = byggKategoriträd([
      med("ap-utan"),
      med("ap-system", "Systemförvaltning"),
      med("ap-avtal", "Avtal"),
      med("bestallning-ny"),
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
        med("bestallning-ny"),
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
    const [gren] = byggFlödesträd([flöde("felanmalan-ny")]);
    expect(gren.titel).toBe("Felanmälan");
    expect(gren.egen).toBeUndefined();
    expect(gren.målgrupper[0].titel).toBe("Användaren");
  });

  it("reglernas grenar står först, egna underkategorier sist i bokstavsordning", () => {
    const träd = byggFlödesträd([
      flöde("felanmalan-ny"),
      flöde("bestallning-ny", undefined, "Utbildning"),
      flöde("avvikelse-ny", undefined, "Arkiv"),
    ]);
    expect(träd.map((g) => g.titel)).toEqual(["Felanmälan", "Arkiv", "Utbildning"]);
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
      flöde("felanmalan-ny"),
    ]);
    const demo = träd.find((k) => k.kategori?.titel === "Demo")!;
    expect(demo.ärendetyper.map((g) => g.titel)).toEqual(["Arkiv", "Utbildning"]);
    // Portalens flöden rörs inte.
    const portalen = träd.find((k) => k.kategori?.titel === "Systemprocesser")!;
    expect(portalen.ärendetyper.map((g) => g.titel)).toEqual(["Felanmälan"]);
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
    const [gren] = byggFlödesträd([flöde("felanmalan-ny", "Demo", "   ")]);
    expect(gren.titel).toBe("Felanmälan");
  });
});
