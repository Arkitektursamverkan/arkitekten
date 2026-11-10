/**
 * Mallen ska göra det LÄTT att göra rätt. Testerna beskriver vad det betyder:
 * att det man väljer är det man får (ingen gissning), att det som saknas sägs
 * i klartext, och att resultatet går hela vägen genom kompileringen.
 */

import { describe, expect, it } from "vitest";
import { compileDraft } from "./draft";
import {
  allaRader,
  döpOmBana,
  taBortBana,
  draftTillMall,
  fortsättMedMall,
  granskaMall,
  mallSomText,
  mallTillDraft,
  nyGren,
  nyRad,
  tomMall,
  type Mall,
} from "./template";

function mall(): Mall {
  return {
    titel: "Driftfråga",
    underrubrik: "Från fel till avslutat ärende",
    banor: ["Användare", "Portalen", "Power Automate", "SharePoint"],
    rader: [
      { ...nyRad("r1", "start"), text: "Fel uppkommer", bana: "Användare" },
      { ...nyRad("r2"), text: "Startar Portalen", bana: "Portalen" },
      {
        ...nyRad("r3", "decision"),
        text: "Hög prioritet?",
        bana: "Portalen",
        grenar: [
          { id: "g1", etikett: "Ja", rader: [{ ...nyRad("r3a"), text: "Teamschatt skapas", bana: "Power Automate" }] },
          { id: "g2", etikett: "Nej", rader: [{ ...nyRad("r3b"), text: "Mejl till handläggaren", bana: "Power Automate" }] },
        ],
      },
      { ...nyRad("r4", "datastore"), text: "Loggpost skrivs", bana: "SharePoint" },
      { ...nyRad("r5", "end"), text: "Klart", bana: "Power Automate" },
    ],
  };
}

describe("mallen bygger vad man valt", () => {
  it("REGRESSION: banan blir den man valde, inte den reglerna gissar", () => {
    // Hela poängen med mallen. "Teamschatt skapas" skulle regelmotorn lägga i
    // Kommunikationsmedel; här står det Power Automate och då gäller det.
    const d = mallTillDraft(mall());
    const steg = d.steps.find((s) => s.text === "Teamschatt skapas")!;
    expect(steg.laneId).toBe("Power Automate");
  });

  it("typen blir den man valde", () => {
    const d = mallTillDraft(mall());
    expect(d.steps.find((s) => s.text === "Loggpost skrivs")!.type).toBe("datastore");
    expect(d.steps.find((s) => s.text === "Fel uppkommer")!.type).toBe("start");
  });

  it("ett beslut blir en exklusiv gateway med sina grenar", () => {
    const d = mallTillDraft(mall());
    const beslut = d.steps.find((s) => s.type === "decision")!;
    expect(beslut.gateway).toBe("exclusive");
    const grenSteg = d.steps.filter((s) => s.branchOf?.stepId === beslut.id);
    expect(grenSteg.map((s) => s.branchOf!.label).sort()).toEqual(["Ja", "Nej"]);
  });

  it("en notifiering får sin mottagare", () => {
    const m = mall();
    m.rader.push({ ...nyRad("r6", "notification"), text: "Mejl skickas", mottagare: "handläggaren" });
    const d = mallTillDraft(m);
    const steg = d.steps.find((s) => s.text === "Mejl skickas")!;
    expect(steg.recipient).toBe("handläggaren");
    expect(steg.messageDirection).toBe("send");
  });

  it("REGRESSION: banorna kommer i den ordning MALLEN satt, inte användningsordningen", () => {
    // Banorna är flödets egna och deras ordning är ett val. SharePoint används
    // sist men ligger sist i mallen – då ska den ligga sist i diagrammet.
    const d = mallTillDraft(mall());
    expect(d.lanes.map((l) => l.id)).toEqual([
      "Användare",
      "Portalen",
      "Power Automate",
      "SharePoint",
    ]);
  });

  it("en bana som inte används kommer ändå med", () => {
    // Man ska kunna lägga upp banorna först och fylla i stegen sedan.
    const m = mall();
    m.banor = [...m.banor, "Ekonomi"];
    expect(mallTillDraft(m).lanes.map((l) => l.id)).toContain("Ekonomi");
  });

  it("resultatet går hela vägen genom kompileringen", () => {
    const m = compileDraft(mallTillDraft(mall()));
    expect(m.title).toBe("Driftfråga");
    expect(m.nodes.length).toBeGreaterThan(4);
    expect(m.edges.length).toBeGreaterThan(3);
    // Beslutet ska ha två utgående kanter med var sin etikett.
    const beslut = m.nodes.find((n) => n.type === "decision")!;
    const ut = m.edges.filter((e) => e.source === beslut.id);
    expect(ut.map((e) => e.label).sort()).toEqual(["Ja", "Nej"]);
  });

  it("stegen påstår inte att de kommer ur en källtext", () => {
    // sourceIndex −1 = tillagt för hand. Spårbarheten får inte ljuga.
    for (const s of mallTillDraft(mall()).steps) expect(s.sourceIndex).toBe(-1);
  });
});

describe("mallen säger vad som saknas", () => {
  it("en tom mall listar det som behövs", () => {
    const problem = granskaMall(tomMall());
    expect(problem.some((p) => /titel/i.test(p.text))).toBe(true);
    expect(problem.some((p) => /vad som händer/i.test(p.text))).toBe(true);
  });

  it("en ifylld mall är utan anmärkning", () => {
    expect(granskaMall(mall())).toEqual([]);
  });

  it("ett beslut utan två grenar anmärks", () => {
    const m = mall();
    m.rader[2].grenar = [nyGren("g1", "Ja")];
    expect(granskaMall(m).some((p) => /två grenar/i.test(p.text))).toBe(true);
  });

  it("en notifiering utan mottagare anmärks", () => {
    const m = mall();
    m.rader.push({ ...nyRad("r6", "notification"), text: "Mejl skickas" });
    expect(granskaMall(m).some((p) => /vem notifieringen/i.test(p.text))).toBe(true);
  });

  it("ett flöde utan start anmärks", () => {
    const m = mall();
    m.rader[0].typ = "activity";
    expect(granskaMall(m).some((p) => /startar flödet/i.test(p.text))).toBe(true);
  });

  it("problemet pekar ut raden det gäller", () => {
    const m = mall();
    m.rader[1].text = "";
    const p = granskaMall(m).find((x) => /vad som händer/i.test(x.text))!;
    expect(p.radId).toBe("r2");
  });
});

describe("mallen som text", () => {
  it("skrivs i samma pilformat som beskrivningsrutan", () => {
    const t = mallSomText(mall());
    expect(t.split("\n")[0]).toBe("Driftfråga");
    expect(t).toContain("Fel uppkommer → Startar Portalen");
    expect(t).toContain("↓ Om Ja → Teamschatt skapas");
  });

  it("allaRader hittar även stegen inuti grenarna", () => {
    expect(allaRader(mall()).map((r) => r.id)).toContain("r3a");
  });
});

describe("banorna är flödets egna", () => {
  it("REGRESSION: det finns ingen fast lista med banor", () => {
    // Banorna var hårdkodade till ett visst projekts namn. De är olika från
    // flöde till flöde – ett eget namn ska fungera lika bra.
    const m = mall();
    m.banor = ["Kund", "Kundtjänst", "Faktureringssystem"];
    m.rader = [
      { ...nyRad("a", "start", "Kund"), text: "Kund ringer" },
      { ...nyRad("b", "activity", "Kundtjänst"), text: "Ärende tas emot" },
      { ...nyRad("c", "system", "Faktureringssystem"), text: "Faktura krediteras" },
    ];
    expect(granskaMall(m)).toEqual([]);
    const d = mallTillDraft(m);
    expect(d.lanes.map((l) => l.id)).toEqual(["Kund", "Kundtjänst", "Faktureringssystem"]);
    expect(d.steps.find((s) => s.text === "Faktura krediteras")!.laneId).toBe("Faktureringssystem");
  });

  it("att döpa om en bana tar med sig stegen", () => {
    // Annars pekar stegen på ett namn som inte längre finns.
    const m = döpOmBana(mall(), "Portalen", "Kundportalen");
    expect(m.banor).toContain("Kundportalen");
    expect(m.banor).not.toContain("Portalen");
    expect(m.rader.find((r) => r.id === "r2")!.bana).toBe("Kundportalen");
    expect(granskaMall(m)).toEqual([]);
  });

  it("att ta bort en bana flyttar dess steg till den första kvar", () => {
    const m = taBortBana(mall(), "SharePoint");
    expect(m.banor).not.toContain("SharePoint");
    expect(m.rader.find((r) => r.id === "r4")!.bana).toBe("Användare");
    expect(granskaMall(m)).toEqual([]);
  });

  it("den sista banan går inte att ta bort", () => {
    const m: Mall = { ...mall(), banor: ["Enda"] };
    expect(taBortBana(m, "Enda")).toBe(m);
  });

  it("två banor med samma namn anmärks", () => {
    const m = mall();
    m.banor = [...m.banor, "Användare"];
    expect(granskaMall(m).some((p) => /samma namn/i.test(p.text))).toBe(true);
  });

  it("ett steg i en bana som inte finns anmärks", () => {
    const m = mall();
    m.rader[1].bana = "Finns inte";
    const p = granskaMall(m).find((x) => /vilken simbana/i.test(x.text))!;
    expect(p.radId).toBe("r2");
  });
});

describe("fortsätta på mallen", () => {
  it("REGRESSION: Mall öppnade en tom mall fast flödet var ifyllt – mallen räknas nu fram ur flödet", () => {
    const m = mall();
    const tillbaka = draftTillMall(mallTillDraft(m));
    expect(tillbaka.titel).toBe(m.titel);
    expect(tillbaka.underrubrik).toBe(m.underrubrik);
    expect(tillbaka.banor).toEqual(m.banor);
    // Samma flöde ur den framräknade mallen som ur den ifyllda.
    expect(mallTillDraft(tillbaka).steps).toEqual(mallTillDraft(m).steps);
    expect(mallSomText(tillbaka)).toBe(mallSomText(m));
  });

  it("ett steg som döpts om på ritytan står med sitt nya namn i mallen", () => {
    const d = mallTillDraft(mall());
    const ändrad = { ...d, steps: d.steps.map((s) => (s.id === "r2" ? { ...s, text: "Öppnar portalen" } : s)) };
    expect(draftTillMall(ändrad).rader.find((r) => r.id === "r2")?.text).toBe("Öppnar portalen");
  });

  it("att köra mallen igen behåller det som gjorts på ritytan", () => {
    const d = mallTillDraft(mall());
    const ritad = {
      ...d,
      steps: d.steps.map((s) => (s.id === "r2" ? { ...s, position: { x: 400, y: 120 } } : s)),
      edgeStyles: { "r1->r2": { sourceSide: "right" as const } },
    };
    const m = draftTillMall(ritad);
    const utökad = { ...m, rader: [...m.rader, { ...nyRad("ny1"), text: "Följer upp", bana: "Användare" }] };
    const efter = fortsättMedMall(ritad, utökad);

    expect(efter.steps.find((s) => s.id === "r2")?.position).toEqual({ x: 400, y: 120 });
    expect(efter.edgeStyles).toEqual(ritad.edgeStyles);
    expect(efter.steps[efter.steps.length - 1]).toMatchObject({ id: "ny1", text: "Följer upp" });
    expect(efter.steps).toHaveLength(ritad.steps.length + 1);
  });

  it("en mall utan gemensamma steg är ett nytt flöde och byggs från början", () => {
    const annat = mallTillDraft({ ...tomMall(), titel: "Annat" });
    const d = { ...mallTillDraft(mall()), edgeStyles: { "r1->r2": { sourceSide: "right" as const } } };
    const m: Mall = { ...tomMall(), titel: "Annat", rader: [{ ...nyRad("x1", "start"), text: "Börjar", bana: "Användare" }] };
    expect(fortsättMedMall(d, m).edgeStyles).toBeUndefined();
    expect(annat.title).toBe("Annat");
  });
});
