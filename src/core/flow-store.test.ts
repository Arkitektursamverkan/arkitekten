import { beforeEach, describe, expect, it } from "vitest";
import {
  createLocalStore,
  flowId,
  MAX_VERSIONS,
  saveFlowVersion,
  sättPlacering,
  sättPublicering,
  taBortPublicering,
  döpOmGren,
  BryggFel,
  flyttaTillYta,
  type FlowStore,
  type SavedFlow,
  type SaveInput,
} from "./flow-store";
import { compileDraft, updateStep } from "./draft";
import { textToDraft } from "@/tools/flowchart/parser/toDraft";

/** Minimal Storage-implementation så testet inte behöver en webbläsare. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  const s: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
  // Object.keys(storage) måste fungera – lagringen listar sina nycklar så.
  return new Proxy(s, {
    ownKeys: () => [...map.keys()],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });
}

const TEXT = `Felanmälan ny
Fel uppkommer → Startar portalen → Fyller i formulär → Mejl skickas till handläggaren`;

describe("flowId", () => {
  it("gör filnamnssäkra id:n av svenska namn", () => {
    expect(flowId("Felanmälan ny")).toBe("felanmalan-ny");
    expect(flowId("Beställning – ny vara")).toBe("bestallning-ny-vara");
  });

  it("ger samma id för samma namn, så omsparning skriver över", () => {
    expect(flowId("Felanmälan ny")).toBe(flowId("felanmälan NY"));
  });

  it("faller tillbaka på ett giltigt id för nonsensnamn", () => {
    expect(flowId("???")).toBe("flode");
  });
});

describe("flödesbibliotek i localStorage", () => {
  let store: FlowStore;

  beforeEach(() => {
    store = createLocalStore(fakeStorage());
  });

  it("sparar, listar och laddar ett flöde", async () => {
    const draft = textToDraft(TEXT);
    await saveFlowVersion(store, ({ name: "Felanmälan ny", rawText: TEXT, draft }));

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Felanmälan ny");
    expect(list[0].stepCount).toBe(draft.steps.length);

    const loaded = await store.load("felanmalan-ny");
    expect(loaded.rawText).toBe(TEXT);
    expect(loaded.draft.steps).toHaveLength(draft.steps.length);
  });

  it("bevarar redigeringar i mellanlagret över spara/öppna", async () => {
    const edited = updateStep(textToDraft(TEXT), "s2", { text: "Ändrad text", type: "datastore" });
    await saveFlowVersion(store, ({ name: "Test", rawText: TEXT, draft: edited }));

    const loaded = await store.load("test");
    const step = loaded.draft.steps.find((s) => s.id === "s2")!;
    expect(step.text).toBe("Ändrad text");
    expect(step.type).toBe("datastore");
  });

  it("ger identiskt diagram efter en runda spara/öppna", async () => {
    const draft = textToDraft(TEXT);
    const före = compileDraft(draft);
    await saveFlowVersion(store, ({ name: "Rundtur", rawText: TEXT, draft }));

    const efter = compileDraft((await store.load("rundtur")).draft);
    expect(efter.nodes).toEqual(före.nodes);
    expect(efter.edges).toEqual(före.edges);
    expect(efter.swimlanes).toEqual(före.swimlanes);
  });

  it("skriver över i stället för att skapa dubbletter vid samma namn", async () => {
    const draft = textToDraft(TEXT);
    await saveFlowVersion(store, ({ name: "Samma", rawText: TEXT, draft }));
    await saveFlowVersion(store, ({ name: "Samma", rawText: "Ändrad\nA → B", draft }));

    expect(await store.list()).toHaveLength(1);
    expect((await store.load("samma")).rawText).toBe("Ändrad\nA → B");
  });

  it("tar bort ett flöde", async () => {
    await saveFlowVersion(store, ({ name: "Bort", rawText: TEXT, draft: textToDraft(TEXT) }));
    await store.remove("bort");
    expect(await store.list()).toHaveLength(0);
    await expect(store.load("bort")).rejects.toThrow(/finns inte/);
  });

  it("sparar AI-beskrivning och vyinställningar", async () => {
    await saveFlowVersion(store, ({
        name: "Med vy",
        rawText: TEXT,
        aiText: "Städad text",
        draft: textToDraft(TEXT),
        view: { perspective: "business", pageFormat: "a4l", scale: 0.8 },
      }),
    );
    const loaded = await store.load("med-vy");
    expect(loaded.aiText).toBe("Städad text");
    expect(loaded.view).toEqual({ perspective: "business", pageFormat: "a4l", scale: 0.8 });
  });

  it("lägger till en version per sparning", async () => {
    const draft = textToDraft(TEXT);
    await saveFlowVersion(store, { name: "Hist", rawText: TEXT, draft });
    await saveFlowVersion(store, { name: "Hist", rawText: TEXT + "\n→ Loggpost skapas", draft });

    const flow = await store.load("hist");
    expect(flow.versions.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(flow.versions[0].rawText).toBe(TEXT);
    expect(flow.rawText).toBe(flow.versions[1].rawText); // nuvarande = senaste
    expect((await store.list())[0].versionCount).toBe(2);
  });

  it("skapar ingen ny version när ingenting ändrats", async () => {
    const draft = textToDraft(TEXT);
    await saveFlowVersion(store, { name: "Lugn", rawText: TEXT, draft });
    await saveFlowVersion(store, { name: "Lugn", rawText: TEXT, draft });
    await saveFlowVersion(store, { name: "Lugn", rawText: TEXT, draft });

    expect((await store.load("lugn")).versions).toHaveLength(1);
  });

  it("skapar en version även vid oförändrat innehåll om man satt en kommentar", async () => {
    const draft = textToDraft(TEXT);
    await saveFlowVersion(store, { name: "Märkt", rawText: TEXT, draft });
    await saveFlowVersion(store, { name: "Märkt", rawText: TEXT, draft, label: "Godkänd av Test Testsson" });

    const flow = await store.load("markt");
    expect(flow.versions).toHaveLength(2);
    expect(flow.versions[1].label).toBe("Godkänd av Test Testsson");
  });

  it("bevarar historiken när man återgår och sparar igen", async () => {
    const v1Draft = textToDraft(TEXT);
    await saveFlowVersion(store, { name: "Åter", rawText: TEXT, draft: v1Draft });
    const v2Draft = updateStep(v1Draft, "s1", { text: "Ändrat i v2" });
    await saveFlowVersion(store, { name: "Åter", rawText: TEXT, draft: v2Draft });

    // Återgå till v1 och spara – historiken ska växa, inte skrivas om.
    const flow = await store.load("ater");
    const v1 = flow.versions[0];
    await saveFlowVersion(store, { name: "Åter", rawText: v1.rawText, draft: v1.draft });

    const efter = await store.load("ater");
    expect(efter.versions.map((v) => v.id)).toEqual(["v1", "v2", "v3"]);
    expect(efter.draft.steps[0].text).toBe(v1.draft.steps[0].text);
    // v2:s innehåll finns kvar och går att gå tillbaka till.
    expect(efter.versions[1].draft.steps[0].text).toBe("Ändrat i v2");
  });

  it("ger identiskt diagram när man återgår till en gammal version", async () => {
    const draft = textToDraft(TEXT);
    const original = compileDraft(draft);
    await saveFlowVersion(store, { name: "Diagram", rawText: TEXT, draft });
    await saveFlowVersion(store, {
      name: "Diagram",
      rawText: TEXT,
      draft: updateStep(draft, "s1", { type: "datastore", text: "Något annat" }),
    });

    const v1 = (await store.load("diagram")).versions[0];
    expect(compileDraft(v1.draft).nodes).toEqual(original.nodes);
    expect(compileDraft(v1.draft).edges).toEqual(original.edges);
  });

  it("gallrar äldsta versionerna vid taket", async () => {
    let draft = textToDraft(TEXT);
    for (let i = 0; i < MAX_VERSIONS + 5; i++) {
      draft = updateStep(draft, "s1", { text: `Version ${i}` });
      await saveFlowVersion(store, { name: "Många", rawText: TEXT, draft });
    }
    const flow = await store.load("manga");
    expect(flow.versions).toHaveLength(MAX_VERSIONS);
    // Senaste sparningen finns kvar, den allra första är bortgallrad.
    expect(flow.versions[flow.versions.length - 1].draft.steps[0].text).toBe(
      `Version ${MAX_VERSIONS + 4}`,
    );
    expect(flow.versions.some((v) => v.draft.steps[0].text === "Version 0")).toBe(false);
  });

  it("ger gamla flöden utan historik en v1 vid inläsning", async () => {
    const storage = fakeStorage();
    const gammalt = {
      id: "gammalt",
      name: "Gammalt",
      savedAt: "2026-07-18T10:00:00.000Z",
      rawText: TEXT,
      draft: textToDraft(TEXT),
    };
    storage.setItem("ark.flow.gammalt", JSON.stringify(gammalt));

    const flow = await createLocalStore(storage).load("gammalt");
    expect(flow.versions).toHaveLength(1);
    expect(flow.versions[0].id).toBe("v1");
    expect(flow.versions[0].rawText).toBe(TEXT);
  });

  it("hoppar över trasiga poster i stället för att krascha listan", async () => {
    const storage = fakeStorage();
    storage.setItem("ark.flow.trasig", "{inte json");
    const s = createLocalStore(storage);
    await saveFlowVersion(s, ({ name: "Hel", rawText: TEXT, draft: textToDraft(TEXT) }));
    const list = await s.list();
    expect(list.map((f) => f.name)).toEqual(["Hel"]);
  });
});

describe("versionens signatur", () => {
  it("vem som sparade följer med versionen – exporten stämplar bilden med det", async () => {
    const store = createLocalStore(fakeStorage());
    const draft = textToDraft(TEXT);
    await saveFlowVersion(store, { name: "Flöde", rawText: "T", draft, savedBy: "  Test Testsson  " });
    const efter = await saveFlowVersion(store, {
      name: "Flöde",
      rawText: "T2",
      draft: { ...draft, title: "T2" },
      savedBy: "",
    });
    expect(efter.versions[0].savedBy).toBe("Test Testsson"); // trimmat
    expect(efter.versions[1].savedBy).toBeUndefined(); // tomt fält = ingen uppgift
  });

  it("REGRESSION: sparning av ett ÖPPNAT flöde kopierar det inte", async () => {
    // Felbeteendet: id:t härleddes ur namnet vid varje sparning. Ett flöde vars
    // id inte råkade vara exakt namnets slug (skapat av ett skript, eller
    // omdöpt) klonades då till ett NYTT flöde med SAMMA namn, och biblioteket
    // fylldes av par som inte gick att skilja åt.
    const store = createLocalStore(fakeStorage());
    const draft = textToDraft(TEXT);
    await store.save({
      id: "kommentera-godkannare", // ≠ slug("Kommentera ärendet")
      name: "Kommentera ärendet",
      savedAt: new Date().toISOString(),
      rawText: TEXT,
      draft,
      versions: [],
    });

    const sparad = await saveFlowVersion(store, {
      id: "kommentera-godkannare",
      name: "Kommentera ärendet",
      rawText: TEXT,
      draft,
    });
    expect(sparad.id).toBe("kommentera-godkannare");
    expect(await store.list()).toHaveLength(1); // ingen klon

    // Omdöpning: samma post, nytt namn – historiken följer med.
    const omdöpt = await saveFlowVersion(store, {
      id: "kommentera-godkannare",
      name: "Kommentera ärendet (godkännare)",
      rawText: TEXT,
      draft: updateStep(draft, draft.steps[1].id, { text: "Ändrat" }),
    });
    expect(omdöpt.id).toBe("kommentera-godkannare");
    expect(omdöpt.name).toBe("Kommentera ärendet (godkännare)");
    expect(await store.list()).toHaveLength(1);
    expect(omdöpt.versions.length).toBeGreaterThan(1);

    // Utan id (ett NYTT flöde) gäller namnet som förut.
    const nytt = await saveFlowVersion(store, { name: "Något annat", rawText: TEXT, draft });
    expect(nytt.id).toBe(flowId("Något annat"));
  });
});

describe("statusar på versionerna", () => {
  let store: FlowStore;
  const draft = textToDraft(TEXT);
  beforeEach(() => {
    store = createLocalStore(fakeStorage());
  });

  const spara = (extra: Partial<SaveInput> = {}) =>
    saveFlowVersion(store, { name: "Felanmälan ny", rawText: TEXT, draft, ...extra });

  it("en sparning utan angiven status blir utkast – aldrig fastslagen av misstag", async () => {
    const sparad = await spara();
    expect(sparad.versions[0].status).toBe("utkast");
  });

  it("REGRESSION: att fastslå utan att ändra innehållet skapar ändå en version", async () => {
    // Dubbletskyddet (identiskt innehåll → ingen ny version) åt tidigare upp
    // just den handling statusen finns för, och huvudversionen skapades aldrig.
    await spara();
    const fastslagen = await spara({ status: "fastslagen" });
    expect(fastslagen.versions).toHaveLength(2);
    expect(fastslagen.versions[1].status).toBe("fastslagen");
  });

  it("men två identiska sparningar med SAMMA status ger fortfarande en version", async () => {
    await spara({ status: "fastslagen" });
    const igen = await spara({ status: "fastslagen" });
    expect(igen.versions).toHaveLength(1);
  });

  it("äldre versioner behåller sin status när en ny fastslås – historiken skrivs på, inte om", async () => {
    await spara();
    const efter = await spara({ status: "fastslagen" });
    expect(efter.versions.map((v) => v.status)).toEqual(["utkast", "fastslagen"]);
  });

  it("listningen visar status, beteckning och senaste huvudversion", async () => {
    await spara();
    await spara({ status: "fastslagen" });
    await spara({ label: "vidare arbete" });
    const [post] = await store.list();
    expect(post.status).toBe("utkast");
    expect(post.beteckning).toBe("1.1");
    expect(post.fastslagenBeteckning).toBe("1.0");
  });

  it("ett flöde sparat innan statusar fanns listas som utkast, inte som fastslaget", async () => {
    await store.save({
      id: "gammalt",
      name: "Gammalt flöde",
      savedAt: "2026-01-01T00:00:00.000Z",
      rawText: TEXT,
      draft,
      versions: [
        // Ingen status alls – så ser de sparade filerna i flows/ ut idag.
        { id: "v1", savedAt: "2026-01-01T00:00:00.000Z", rawText: TEXT, draft },
      ],
    });
    const [post] = await store.list();
    expect(post.status).toBe("utkast");
    expect(post.beteckning).toBe("0.1");
    expect(post.fastslagenBeteckning).toBeUndefined();
  });
});

/**
 * Att flytta ett flöde i katalogen är INGEN sparning: strukturen är var
 * processen ligger, inte vad den innehåller. Det beställda var att kunna ändra
 * strukturen – och en flytt som lade till en version hade fyllt historiken
 * med poster där ingenting hänt.
 */
describe("placering i katalogen", () => {
  let store: FlowStore;

  beforeEach(() => {
    store = createLocalStore(fakeStorage());
  });

  async function skapa(namn: string, placering?: { category?: string; subcategory?: string }) {
    const draft = textToDraft(TEXT);
    return saveFlowVersion(store, { name: namn, rawText: TEXT, draft, ...placering });
  }

  it("flyttar utan att lägga till en version eller ändra savedAt", async () => {
    const före = await skapa("Felanmälan ny", { category: "Demo" });

    const efter = await sättPlacering(store, före.id, {
      category: "Demo",
      subcategory: "Utbildning",
    });

    expect(efter.subcategory).toBe("Utbildning");
    expect(efter.versions).toHaveLength(före.versions.length);
    expect(efter.savedAt).toBe(före.savedAt);
    // …och innehållet är orört.
    expect(efter.draft.steps).toHaveLength(före.draft.steps.length);
  });

  it("tom sträng tar bort nivån i stället för att spara den", async () => {
    const flow = await skapa("Test", { category: "Demo", subcategory: "Arkiv" });
    const efter = await sättPlacering(store, flow.id, { category: "Demo", subcategory: "  " });
    expect(efter.subcategory).toBeUndefined();
    expect(efter.category).toBe("Demo");
  });

  /**
   * REGRESSION: en flytt i katalogen "återuppstod på sin gamla plats".
   *
   * Verktyget läser kategorin när flödet ÖPPNAS och håller den i sitt eget
   * tillstånd. Flyttade man processen i katalogen medan den låg öppen skrev
   * nästa sparning tillbaka det gamla värdet – flytten var borta, utan att
   * någon rört placeringen (beslut 2026-09-07). En sparning som inte säger
   * något om placeringen ska inte heller ändra den.
   */
  it("REGRESSION: en sparning utan placering behåller den som står i filen", async () => {
    const flow = await skapa("Felanmälan ny", { category: "Demo" });
    await sättPlacering(store, flow.id, { category: "Portalen", subcategory: "Felanmälan" });

    const draft = textToDraft(TEXT);
    const efter = await saveFlowVersion(store, {
      id: flow.id,
      name: "Felanmälan ny",
      rawText: TEXT + "\nB gör något mer",
      draft,
    });

    expect(efter.category).toBe("Portalen");
    expect(efter.subcategory).toBe("Felanmälan");
  });

  it("men en TOM sträng är ett aktivt val och tar bort kategorin", async () => {
    const flow = await skapa("Felanmälan ny", { category: "Demo", subcategory: "Utbildning" });
    const draft = textToDraft(TEXT);
    const efter = await saveFlowVersion(store, {
      id: flow.id,
      name: "Felanmälan ny",
      rawText: TEXT,
      draft,
      category: "",
      subcategory: "",
    });

    expect(efter.category).toBeUndefined();
    expect(efter.subcategory).toBeUndefined();
  });

  it("okända fält på posten överlever en flytt (invariant 4)", async () => {
    const flow = await skapa("Test", { category: "Demo" });
    // Något som en senare version av appen lagt till.
    await store.save({ ...flow, framtidaFält: 42 } as never);

    await sättPlacering(store, flow.id, { category: "Annan" });
    const efter = (await store.load(flow.id)) as never as { framtidaFält?: number };
    expect(efter.framtidaFält).toBe(42);
  });

  it("döpOmGren skriver det nya namnet på alla flöden i grenen", async () => {
    const a = await skapa("Ett", { category: "Demo", subcategory: "Utbildning" });
    const b = await skapa("Två", { category: "Demo", subcategory: "Utbildning" });
    const c = await skapa("Tre", { category: "Demo", subcategory: "Arkiv" });

    await döpOmGren(store, [a.id, b.id], { subcategory: "Kurser" });

    expect((await store.load(a.id)).subcategory).toBe("Kurser");
    expect((await store.load(b.id)).subcategory).toBe("Kurser");
    // Grenen bredvid rörs inte …
    expect((await store.load(c.id)).subcategory).toBe("Arkiv");
    // … och kategorin följer med oförändrad.
    expect((await store.load(a.id)).category).toBe("Demo");
  });
});

/**
 * Publiceringen i EA-portalen sitter på FLÖDET, som placeringen: den säger var
 * processen visas och vem som äger den, inte vad den innehåller.
 */
describe("publicering i EA-portalen", () => {
  let store: FlowStore;
  const PUB = {
    eaNodId: "62911b03-0000-0000-0000-000000000000",
    eaNodNamn: "4.4.3  Allvarlig IT-säkerhets/GDPR-incident",
    eaPrefix: "4.4.3",
    ägare: "IT-chef",
    beskrivning: "Hur en allvarlig incident hanteras.",
    publiceradAt: "2026-10-08T10:00:00.000Z",
  };

  beforeEach(() => {
    store = createLocalStore(fakeStorage());
  });

  it("publicerar utan att lägga till en version eller ändra savedAt", async () => {
    const före = await saveFlowVersion(store, { name: "ap test", rawText: TEXT, draft: textToDraft(TEXT) });
    const efter = await sättPublicering(store, före.id, PUB);
    expect(efter.publicering).toEqual(PUB);
    expect(efter.versions).toHaveLength(före.versions.length);
    expect(efter.savedAt).toBe(före.savedAt);
    expect((await store.load(före.id)).publicering).toEqual(PUB);
  });

  /**
   * REGRESSION: `saveFlowVersion` byggde om posten fält för fält. Allt som
   * lagts på flödet utanför sparningen – här publiceringen – försvann vid
   * nästa sparning, och processen föll tyst ur EA-portalen.
   */
  it("REGRESSION: en sparning behåller publiceringen", async () => {
    const flow = await saveFlowVersion(store, { name: "ap test", rawText: TEXT, draft: textToDraft(TEXT) });
    await sättPublicering(store, flow.id, PUB);
    const efter = await saveFlowVersion(store, {
      id: flow.id,
      name: "ap test",
      rawText: TEXT + "\nB gör något mer",
      draft: textToDraft(TEXT + "\nB gör något mer"),
      status: "fastslagen",
    });
    expect(efter.publicering).toEqual(PUB);
    expect(efter.versions).toHaveLength(2);
  });

  it("avpublicerar utan att lägga till en version, ändra savedAt eller tappa något annat", async () => {
    const flow = await saveFlowVersion(store, {
      name: "ap test",
      rawText: TEXT,
      draft: textToDraft(TEXT),
      category: "Demo",
    });
    await sättPublicering(store, flow.id, PUB);
    const efter = await taBortPublicering(store, flow.id);
    expect(efter.publicering).toBeUndefined();
    expect("publicering" in (await store.load(flow.id))).toBe(false);
    expect(efter.versions).toHaveLength(flow.versions.length);
    expect(efter.savedAt).toBe(flow.savedAt);
    expect(efter.category).toBe("Demo");
  });
});

describe("egna kataloger", () => {
  /** En lagring där "ny-dator" redan ägs av någon annan – bryggan svarar 403 på den. */
  function lagringMedAnnansProcess() {
    const filer = new Map<string, SavedFlow>();
    const store: FlowStore = {
      kind: "local",
      async list() {
        return [];
      },
      async load(id) {
        if (id === "ny-dator") throw new BryggFel("Processen ligger i en annan användares katalog.", 403);
        const f = filer.get(id);
        if (!f) throw new BryggFel("Flödet finns inte.", 404);
        return f;
      },
      async save(f) {
        filer.set(f.id, f);
      },
      async remove(id) {
        filer.delete(id);
      },
    };
    return { store, filer };
  }

  it("REGRESSION: ett nytt flöde vars id redan används i någon annans egen katalog får nästa lediga id i stället för att vägras", async () => {
    const { store, filer } = lagringMedAnnansProcess();
    const sparat = await saveFlowVersion(store, {
      name: "Ny dator",
      rawText: "",
      draft: textToDraft("Ny dator\nA → B"),
    });
    expect(sparat.id).toBe("ny-dator-2");
    expect(filer.has("ny-dator-2")).toBe(true);
  });

  it("ett ÖPPNAT flöde byter aldrig id – där är 403 ett riktigt nej", async () => {
    const { store } = lagringMedAnnansProcess();
    await expect(
      saveFlowVersion(store, { id: "ny-dator", name: "Ny dator", rawText: "", draft: textToDraft("X\nA") }),
    ).rejects.toThrow(/annan användares/);
  });

  it("flytten till den gemensamma katalogen i webbläsarlagringen tar bort ägaren men rör inte historiken", async () => {
    const store = createLocalStore(fakeStorage());
    const f = await saveFlowVersion(store, { name: "Mitt", rawText: "", draft: textToDraft("Mitt\nA") });
    await store.save({ ...f, ägare: { id: "anna", namn: "Anna" } });
    const flyttad = await flyttaTillYta(store, f.id, "gemensam", { category: "Gemensamma flöden" });
    expect(flyttad.ägare).toBeUndefined();
    expect(flyttad.category).toBe("Gemensamma flöden");
    expect(flyttad.versions).toEqual(f.versions);
    expect(flyttad.savedAt).toBe(f.savedAt);
  });
});
