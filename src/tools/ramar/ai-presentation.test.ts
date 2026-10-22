/**
 * AI-presentationen: svaret på uppdraget blir en förenklad process och en
 * ramserie – och ingenting i svaret får hamna på fel objekt eller skriva över
 * något som redan finns.
 */

import { describe, expect, it } from "vitest";
import { createLocalStore, type FlowStore } from "@/core/flow-store";
import { createLocalRamStore } from "@/core/ram-store";
import { PRESENTATIONSKATEGORI } from "./avskalad";
import {
  byggFörenklad,
  byggPresentation,
  presentationsFlödeId,
  presentationsInstruktion,
  sparaPresentation,
} from "./ai-presentation";

const KÄLLA = { flödeId: "ap-uthyrning", namn: "Uthyrning", beskrivning: "Uthyrning\nA → B" };

const FÖRENKLAD = {
  aiText: "Uthyrning\nPublicerar lägenhet → Visar lägenhet → Skriver avtal",
  title: "Uthyrning",
  subtitle: null,
  lanes: [{ id: "Uthyrning", title: "Uthyrning" }],
  steps: [
    { id: "publicera", type: "activity", text: "Publicerar lägenhet [In: Ledig lägenhet] [Roll: Kundkoordinator U] [IT: Fastighetssystemet]", laneId: "Uthyrning" },
    { id: "visa", type: "activity", text: "Visar lägenhet [Roll: Förvaltare U]", laneId: "Uthyrning" },
    { id: "avtal", type: "activity", text: "Skriver avtal [Roll: Kundkoordinator U] [Ut: Lägenhet uthyrd]", laneId: "Uthyrning" },
  ],
};

const ram = (extra: Record<string, unknown> = {}) => ({
  rubrik: "Steg 1",
  text: "Lägenheten publiceras.",
  markeringar: [
    { mål: { typ: "nod", id: "publicera" }, verktyg: "puls", färg: "#f59f00" },
    { mål: { typ: "kant", id: "publicera->visa" }, verktyg: "puls", färg: "#f59f00" },
  ],
  ...extra,
});

const SCEN = {
  bakgrund: { typ: "stad" },
  figurer: [
    { id: "kontor", typ: "huvudkontor", namn: "Kundcenter", x: 1200, y: 545 },
    { id: "sokande", typ: "person", namn: "Sökande", x: 600, y: 650 },
  ],
};

const svar = (ramar: unknown[], scen: unknown = SCEN) => ({ förenklad: FÖRENKLAD, presentation: { scen, ramar } });

/** localStorage i miniatyr – nycklarna ligger som egna egenskaper, som i webbläsaren. */
function minne(): Storage {
  const s: Record<string, unknown> = {};
  Object.defineProperties(s, {
    getItem: { value: (k: string) => (k in s ? (s[k] as string) : null) },
    setItem: { value: (k: string, v: string) => void (s[k] = v) },
    removeItem: { value: (k: string) => void delete s[k] },
  });
  return s as unknown as Storage;
}

describe("presentationsFlödeId", () => {
  it("härleds ur källans id och är alltid en affärsprocess", () => {
    expect(presentationsFlödeId("ap-uthyrning")).toBe("ap-uthyrning-presentation");
    expect(presentationsFlödeId("felanmalan-ny")).toBe("ap-felanmalan-ny-presentation");
  });

  it("ryms i bryggans id-regel också för ett långt källnamn", () => {
    const id = presentationsFlödeId("ap-" + "omforhandling-av-kommersiella-lokaler-".repeat(3));
    expect(id).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(id.endsWith("-presentation")).toBe(true);
  });

  it("väljer ett ledigt id när processen redan har en presentation", () => {
    expect(presentationsFlödeId("ap-uthyrning", ["ap-uthyrning-presentation"])).toBe("ap-uthyrning-presentation-2");
    const lång = "ap-" + "omforhandling-av-kommersiella-lokaler-".repeat(3);
    expect(presentationsFlödeId(lång, [presentationsFlödeId(lång)])).toMatch(/^[a-z0-9-]{1,64}$/);
  });
});

describe("byggPresentation", () => {
  it("den förenklade processen går samma väg som en tolkning och märks som affärsprocess", () => {
    const p = byggFörenklad({ förenklad: FÖRENKLAD }, KÄLLA);
    expect(p.draft.diagramType).toBe("affarsprocess");
    expect(p.draft.meta.origin).toBe("ai");
    expect(p.bild.zoner.map((z) => z.namn)).toEqual(["Kundkoordinator", "Förvaltare"]);
    expect(p.bild.rutor.filter((r) => r.sort === "steg").map((r) => r.id)).toEqual(["publicera", "visa", "avtal"]);
  });

  it("en gren kan gå tillbaka i stället för att återförenas – med draftens egna helpers", () => {
    const f = {
      ...FÖRENKLAD,
      steps: [
        ...FÖRENKLAD.steps.slice(0, 2),
        { id: "vill", type: "decision", text: "Vill sökande ha lägenheten?", laneId: "Uthyrning" },
        { id: "nasta", type: "activity", text: "Bjuder in nästa", laneId: "Uthyrning", branchOfStepId: "vill", branchLabel: "Nej" },
        FÖRENKLAD.steps[2],
      ],
      kopplingar: {
        taBort: [{ från: "nasta", till: "avtal" }, { från: "nasta", till: "finns-inte" }],
        läggTill: [{ från: "nasta", till: "visa" }],
      },
    };
    const p = byggFörenklad({ förenklad: f }, KÄLLA);
    const nycklar = p.bild.kanter.map((k) => k.nyckel);
    expect(nycklar).toContain("nasta->visa");
    expect(nycklar).not.toContain("nasta->avtal");
    expect(nycklar).toContain("vill->nasta#Nej");
    expect(p.draft.meta.origin).toBe("ai");
    expect(p.anmärkningar).toHaveLength(1);
  });

  it("serien pekar på den förenklade processen, i avskalad stil, med egna id:n på varje ram", () => {
    const b = byggPresentation(svar([ram(), ram({ rubrik: "Steg 2" })]), KÄLLA, ["ramar-uthyrning-presentation"]);
    expect(b.flödeId).toBe("ap-uthyrning-presentation");
    expect(b.serie.flödeId).toBe(b.flödeId);
    expect(b.serie.stil).toBe("avskalad");
    // Namnet är upptaget – en ny serie, aldrig den gamla överskriven.
    expect(b.serie.id).toBe("ramar-uthyrning-presentation-2");
    expect(new Set(b.serie.ramar.map((r) => r.id)).size).toBe(2);
    expect(b.serie.ramar[0].markeringar).toHaveLength(2);
  });

  it("en markering på ett objekt som inte finns i bilden stryks och redovisas", () => {
    const b = byggPresentation(
      svar([
        ram({
          markeringar: [
            { mål: { typ: "nod", id: "publicera" }, verktyg: "puls", färg: "#f59f00" },
            // Mellanobjektet ritas inte i den avskalade bilden.
            { mål: { typ: "nod", id: "vo_publicera" }, verktyg: "puls", färg: "#f59f00" },
            { mål: { typ: "kant", id: "publicera->avtal" }, verktyg: "puls", färg: "#f59f00" },
          ],
        }),
      ]),
      KÄLLA,
    );
    expect(b.serie.ramar[0].markeringar.map((m) => m.mål.id)).toEqual(["publicera"]);
    expect(b.anmärkningar.some((a) => a.includes('"vo_publicera"'))).toBe(true);
    expect(b.anmärkningar.some((a) => a.includes('"publicera->avtal"'))).toBe(true);
  });

  it("det som pekar på en figur som inte finns i scenen stryks, resten får id:n och förval", () => {
    const b = byggPresentation(
      svar([
        ram({
          scen: {
            markeringar: [{ figur: "kontor", verktyg: "blink", färg: "#e8590c" }, { figur: "spöke" }],
            pulser: [
              { från: "kontor", till: "sokande", färg: "#f59f00", text: "Annons" },
              { från: "kontor", till: "spöke" },
            ],
            dolda: ["sokande", "spöke"],
            textrutor: [{ x: 40, y: 40, text: "Steg 1" }],
          },
        }),
      ]),
      KÄLLA,
    );
    const rs = b.serie.ramar[0].scen!;
    expect(rs.markeringar.map((m) => m.figur)).toEqual(["kontor"]);
    expect(rs.pulser).toHaveLength(1);
    expect(rs.pulser[0].id).toMatch(/^puls_/);
    expect(rs.dolda).toEqual(["sokande"]);
    expect(rs.textrutor[0]).toMatchObject({ x: 40, y: 40, bredd: 520, text: "Steg 1" });
    expect(rs.bubblor).toEqual([]);
    expect(rs.figurLägen).toEqual({});
    expect(b.anmärkningar.filter((a) => a.includes('"spöke"'))).toHaveLength(3);
  });

  it("en figur av okänd typ stryks; utan scen gäller standardscenen", () => {
    const b = byggPresentation(
      svar([ram()], { bakgrund: { typ: "tom" }, figurer: [{ id: "drake", typ: "drake", namn: "", x: 1, y: 1 }, SCEN.figurer[0]] }),
      KÄLLA,
    );
    expect(b.serie.scen!.bakgrund).toEqual({ typ: "tom" });
    expect(b.serie.scen!.figurer.map((f) => f.id)).toEqual(["kontor"]);
    expect(b.anmärkningar.some((a) => a.includes('"drake"'))).toBe(true);

    const utan = byggPresentation({ förenklad: FÖRENKLAD, presentation: { ramar: [ram()] } }, KÄLLA);
    expect(utan.serie.scen!.figurer.map((f) => f.id)).toContain("huvudkontor");
  });

  it("säger till om ett steg aldrig lyfts fram", () => {
    const b = byggPresentation(svar([ram()]), KÄLLA);
    expect(b.anmärkningar.some((a) => a.includes("(visa) lyfts aldrig fram"))).toBe(true);
    expect(b.anmärkningar.some((a) => a.includes("(publicera)"))).toBe(false);
  });

  it("ett svar utan process eller utan ramar är ett fel, inte en tom presentation", () => {
    expect(() => byggPresentation({ presentation: { ramar: [ram()] } }, KÄLLA)).toThrow(/förenklad/);
    expect(() => byggPresentation({ förenklad: FÖRENKLAD, presentation: { ramar: [] } }, KÄLLA)).toThrow(/ram/);
  });
});

describe("sparaPresentation", () => {
  const lagring = () => ({ flöden: createLocalStore(minne()) as FlowStore, ramar: createLocalRamStore(minne()) });

  it("första gången: ett nytt flöde i kategorin Presentation och en ramserie", async () => {
    const { flöden, ramar } = lagring();
    const { flöde, serie } = await sparaPresentation(flöden, ramar, byggPresentation(svar([ram()]), KÄLLA));
    expect(flöde.id).toBe("ap-uthyrning-presentation");
    expect(flöde.name).toBe("Uthyrning (presentation)");
    expect(flöde.category).toBe(PRESENTATIONSKATEGORI);
    expect(flöde.versions).toHaveLength(1);
    expect((await ramar.load(serie.id)).flödeId).toBe(flöde.id);
  });

  it("REGRESSION: en omkörning skrev över den förra förenklade processen (ny version av samma flöde) – nu blir det en NY process", async () => {
    const { flöden, ramar } = lagring();
    await sparaPresentation(flöden, ramar, byggPresentation(svar([ram()]), KÄLLA));
    const första = await flöden.load("ap-uthyrning-presentation");

    const annan = {
      ...svar([ram()]),
      förenklad: { ...FÖRENKLAD, steps: FÖRENKLAD.steps.map((s) => (s.id === "visa" ? { ...s, text: "Håller visning [Roll: Förvaltare U]" } : s)) },
    };
    const serier = (await ramar.list()).map((s) => s.id);
    const sparade = (await flöden.list()).map((f) => f.id);
    const { flöde, serie } = await sparaPresentation(flöden, ramar, byggPresentation(annan, KÄLLA, serier, sparade));

    expect(flöde.id).toBe("ap-uthyrning-presentation-2");
    expect(flöde.name).toBe("Uthyrning (presentation 2)");
    expect(serie.flödeId).toBe(flöde.id);
    expect(serie.id).toBe("ramar-uthyrning-presentation-2");
    // Den förra står kvar, orörd.
    expect(await flöden.load("ap-uthyrning-presentation")).toEqual(första);
    expect(await ramar.list()).toHaveLength(2);
  });
});

describe("presentationsInstruktion", () => {
  it("bär uppdraget, svarets form, figurtyperna och affärsprocessens regler", () => {
    const t = presentationsInstruktion();
    expect(t).toContain('"förenklad"');
    expect(t).toContain('"presentation"');
    expect(t).toContain("servicebil");
    expect(t).toContain("scripts/presentation.mts");
    expect(t).toContain("AFFÄRSPROCESS");
    expect(t).not.toMatch(new RegExp(["2", "c", "8"].join(""), "i"));
  });
});
