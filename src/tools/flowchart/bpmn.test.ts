import { describe, expect, it } from "vitest";
import { compileDraft, emptyDraft, makeLane, type DraftStep, type ProcessDraft } from "@/core/draft";
import { emptyModel } from "@/core/model";
import { parseToModel } from "./parser/parse";
import { checkBpmn, flowOrder, validateModel } from "./parser/validate";
import { toDrawioXml } from "./export/drawio";
import { toMermaid } from "./export/mermaid";
import { renderSvg } from "./export/svg";

const EXAMPLE = `Driftfråga ny
Fel uppkommer → Startar Portalen → Fyller i formulär → Kommer till en sida med tack för ditt ärende → Får via mejl bekräftelse på att driftfråga har inkommit`;

/** Har en namngiven mottagare → ger ett riktigt meddelandeflöde ut ur poolen. */
const MED_MOTTAGARE = `Driftfråga ny
Fel uppkommer → Startar Portalen → Fyller i formulär → Mejl skickas till handläggaren → Loggpost skapas`;

describe("BPMN-anpassning", () => {
  const model = parseToModel(EXAMPLE);
  const mottagarModel = parseToModel(MED_MOTTAGARE);

  it("notifiering med mottagare blir ett meddelandeflöde till en svart-låda-pool", () => {
    // Tidigare var detta en streckad KANT i `edges` – ett formellt BPMN-fel,
    // eftersom ett sekvensflöde aldrig får korsa en poolgräns.
    expect(mottagarModel.messageFlows.length).toBeGreaterThan(0);
    const mf = mottagarModel.messageFlows[0];
    const avsändare = mottagarModel.nodes.find((n) => n.id === mf.nodeId)!;
    expect(avsändare.type).toBe("notification");
    const pool = mottagarModel.pools.find((p) => p.id === mf.poolId)!;
    expect(pool.blackBox).toBe(true);
    // Och inget meddelande får finnas kvar bland sekvensflödena.
    expect(mottagarModel.edges.some((e) => e.kind === "message")).toBe(false);
  });

  it("SVG ritar event-cirkel och streckat meddelandeflöde", () => {
    const svg = renderSvg(mottagarModel);
    expect(svg).toContain("<circle"); // start/slut-event
    expect(svg).toContain('stroke-dasharray="6 4"'); // meddelandeflöde
    expect(svg).toContain("url(#arwOpen)"); // öppen pilspets
  });

  it("draw.io använder äkta BPMN-stencils + öppen streckad pil för meddelande", () => {
    const xml = toDrawioXml(mottagarModel);
    expect(xml).toContain("shape=mxgraph.bpmn.shape"); // event/gateway
    expect(xml).toContain("symbol=general"); // event
    expect(xml).toContain("dashed=1;endArrow=open;startArrow=oval;startFill=0"); // meddelandeflöde
    expect(xml).toContain('style="swimlane;horizontal=0'); // pool
    expect(xml).toContain("shape=swimlane;horizontal=0;startSize=26"); // svart låda
  });

  it("mermaid ritar event som cirkel och meddelande streckat", () => {
    const mmd = toMermaid(mottagarModel);
    expect(mmd).toMatch(/\(\(.*\)\)/); // ((event))
    expect(mmd).toContain("-.->|meddelande|"); // meddelandeflöde
  });

  it("välformad process ger inga hårda BPMN-fel", () => {
    const report = validateModel(model);
    expect(report.bpmn.filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("'kommer till en sida' mitt i flödet är inte ett slut-event", () => {
    const tack = model.nodes.find((n) => /sida med tack/i.test(n.sourceText ?? ""));
    expect(tack).toBeTruthy();
    expect(tack!.type).not.toBe("end"); // degraderad till aktivitet
  });

  it("slut-eventet (röd cirkel) ligger sist i följden", () => {
    const order = flowOrder(model);
    expect(order[order.length - 1].type).toBe("end");
    // Ett slut-event får aldrig ha utgående flöde.
    const endIds = new Set(model.nodes.filter((n) => n.type === "end").map((n) => n.id));
    const endWithOutgoing = model.edges.some((e) => endIds.has(e.source));
    expect(endWithOutgoing).toBe(false);
  });

  it("BPMN-kontroll fångar saknat slut-event och hängande nod", () => {
    const m = emptyModel();
    m.nodes = [
      { id: "a", type: "start", label: "Start", laneId: "L", sourceIndex: 0, perspectives: ["system"] },
      { id: "b", type: "activity", label: "Gör X", laneId: "L", sourceIndex: 1, perspectives: ["system"] },
    ];
    m.edges = [{ id: "e", source: "a", target: "b", perspectives: ["system"] }];
    const issues = checkBpmn(m);
    expect(issues.some((i) => /slut-event/i.test(i.message))).toBe(true);
    expect(issues.some((i) => /hängande/i.test(i.message))).toBe(true);
  });

  /**
   * REGRESSION: kontrollen krävde "sätt mottagaren i mellanlagret" även när
   * mottagaren VAR satt – den såg bara att inget meddelandeflöde ritats. Men
   * en mottagare som deltar i processen får per BPMN inget meddelandeflöde
   * (det får inte gå inom poolen); kopplingen är ett sekvensflöde till
   * mottagningssteget. Alla flöden med bekräftelsemejl till Användare-banan
   * bar därför en varning som inte gick att åtgärda.
   */
  it("REGRESSION: mottagare som är en egen bana ger ingen 'saknar mottagare'-varning", () => {
    const steg = (
      id: string,
      type: "activity" | "notification",
      text: string,
      laneId: string,
      extra: Record<string, unknown> = {},
    ) => ({ id, type, text, laneId, sourceIndex: 0, ...extra }) as DraftStep;
    const draft: ProcessDraft = {
      ...emptyDraft(),
      title: "Bekräftelse",
      lanes: [makeLane("Användare", 0), makeLane("Power Automate", 1)],
      steps: [
        steg("s1", "activity", "Skickar in formuläret", "Användare"),
        steg("s2", "notification", "Bekräftelsemejl till användaren", "Power Automate", {
          recipient: "Användare",
          messageDirection: "send",
        }),
        steg("s3", "notification", "Användaren får bekräftelsemejlet", "Användare", {
          messageDirection: "receive",
        }),
      ],
    };
    const m = compileDraft(draft);
    // Inget meddelandeflöde – mottagaren är med i poolen.
    expect(m.messageFlows).toHaveLength(0);
    expect(checkBpmn(m).some((i) => /saknar mottagare/.test(i.message))).toBe(false);

    // Men utan mottagare på steget ska den fortfarande larma.
    const utan = compileDraft({
      ...draft,
      steps: draft.steps.map((s) => (s.id === "s2" ? { ...s, recipient: undefined } : s)),
    });
    expect(checkBpmn(utan).some((i) => /saknar mottagare/.test(i.message))).toBe(true);
  });
});

/**
 * Ett slut-event utför ingenting eget – det avslutar de vägar som når det och
 * hör därför hemma i deras bana. Låg det i loggningens bana hoppade pilen ner
 * ett steg utan att något hände där.
 */
describe("slut-eventets bana", () => {
  const steg = (
    id: string,
    type: DraftStep["type"],
    text: string,
    laneId: string,
    extra: Record<string, unknown> = {},
  ) => ({ id, type, text, laneId, sourceIndex: 0, ...extra }) as DraftStep;

  it("REGRESSION: end_final tar banan ur vägarna in, inte ur kompileringsordningen", () => {
    // Beslutet ligger sist med bara en uttalad gren → den öppna "Nej"-vägen
    // samlas i end_final. `nodes[nodes.length - 1]` stod här förut: den senast
    // kompilerade noden är grensteget, som kan ligga i en helt annan bana.
    const draft: ProcessDraft = {
      ...emptyDraft(),
      title: "Slut efter beslut",
      lanes: [makeLane("Handläggare", 0), makeLane("Teams", 1)],
      steps: [
        steg("s1", "start", "Ärendet öppnas", "Handläggare"),
        steg("s2", "decision", "Ska chatt startas?", "Handläggare"),
        steg("s3", "activity", "Startar chatten", "Teams", {
          branchOf: { stepId: "s2", label: "Ja" },
        }),
      ],
    };
    const m = compileDraft(draft);
    const slut = m.nodes.find((n) => n.id === "end_final")!;
    const banorIn = new Set(
      m.edges
        .filter((e) => e.target === slut.id)
        .map((e) => m.nodes.find((n) => n.id === e.source)!.laneId),
    );
    expect(banorIn.size).toBeGreaterThan(0);
    expect(banorIn.has(slut.laneId)).toBe(true);
  });

  /**
   * `end_final` samlar en öppen, märkt utgång: beslutet har bara EN uttalad gren,
   * så motsatta vägen faller igenom och möter grenens svans i ett gemensamt slut.
   * Två vägar in med olika djup – och det är djupet som skiljer huvudvägen från
   * återvändsgränden.
   */
  const medÖppenUtgång = (beslutsBana: string, grenBanor: string[]): ProcessDraft => ({
    ...emptyDraft(),
    title: "Öppen utgång",
    lanes: [makeLane("Portalen", 0), makeLane("Power Automate", 1)],
    steps: [
      steg("s1", "start", "Ärendet ska kommenteras", "Portalen"),
      steg("s2", "decision", "Status inte avslutat?", beslutsBana),
      ...grenBanor.map((bana, i) =>
        steg(`s${i + 3}`, "activity", `Steg ${i + 1}`, bana, {
          branchOf: { stepId: "s2", label: "Ja" },
        }),
      ),
    ],
  });

  it("REGRESSION: slutet följer HUVUDVÄGEN, inte den korta vägen ur beslutet", () => {
    // Huvudvägen är tre steg djup och slutar i Power Automate; den öppna
    // Nej-utgången kommer direkt ur beslutet i Portalen. Både
    // kompileringsordningen och "flest vägar in" la slutet i Portalen – hos
    // den som ställde frågan, inte hos den som avslutade arbetet.
    const m = compileDraft(medÖppenUtgång("Portalen", ["Portalen", "Power Automate"]));
    const slut = m.nodes.find((n) => n.id === "end_final")!;
    const banorIn = m.edges
      .filter((e) => e.target === slut.id)
      .map((e) => m.nodes.find((n) => n.id === e.source)!.laneId);
    expect(new Set(banorIn).size).toBeGreaterThan(1); // vägarna in ligger i olika banor
    expect(slut.laneId).toBe("Power Automate"); // huvudvägens sista steg
  });

  it("spegelvänt: huvudvägen vinner även när den korta vägen ligger i systemet", () => {
    // Regeln får inte vara "sista banan" eller "systemet vinner" – den är
    // huvudvägens sista steg, vilken bana det än är.
    const m = compileDraft(medÖppenUtgång("Power Automate", ["Portalen", "Portalen"]));
    expect(m.nodes.find((n) => n.id === "end_final")!.laneId).toBe("Portalen");
  });

  it("två återvändsgränder utan gemensamt slut får ett slut var, i sin egen bana", () => {
    // Båda grenarna är uttalade → ingen öppen utgång, alltså inget end_final.
    // Varje gren avslutas där den slutar, och det är rätt: de möts aldrig.
    const draft: ProcessDraft = {
      ...emptyDraft(),
      title: "Två grenar",
      lanes: [makeLane("Portalen", 0), makeLane("Power Automate", 1)],
      steps: [
        steg("s1", "start", "Startar", "Portalen"),
        steg("s2", "decision", "Går det?", "Portalen"),
        steg("s3", "system", "Behörighet sätts", "Power Automate", {
          branchOf: { stepId: "s2", label: "Ja" },
        }),
        steg("s4", "activity", "Går inte att välja", "Portalen", {
          branchOf: { stepId: "s2", label: "Nej" },
        }),
      ],
    };
    const m = compileDraft(draft);
    for (const slut of m.nodes.filter((n) => n.type === "end")) {
      const banorIn = m.edges
        .filter((e) => e.target === slut.id)
        .map((e) => m.nodes.find((n) => n.id === e.source)!.laneId);
      expect(banorIn).toEqual([slut.laneId]);
    }
  });

  it("en ENDA väg in avgör själv, oavsett vilken bana den ligger i", () => {
    // Ett flöde som verkligen slutar hos Power Automate ska stanna där.
    const draft: ProcessDraft = {
      ...emptyDraft(),
      title: "Slutar i systemet",
      lanes: [makeLane("Portalen", 0), makeLane("Power Automate", 1)],
      steps: [
        steg("s1", "start", "Startar", "Portalen"),
        steg("s2", "system", "Behörighet sätts på ärendet", "Power Automate"),
        steg("s3", "end", "Klart", "Power Automate"),
      ],
    };
    expect(checkBpmn(compileDraft(draft)).some((i) => i.message.includes("ligger i banan"))).toBe(
      false,
    );
  });

  it("ett manuellt banbyte på auto-slutet vinner alltid över härledningen", () => {
    const bas: ProcessDraft = {
      ...emptyDraft(),
      title: "Manuellt val",
      lanes: [makeLane("Handläggare", 0), makeLane("SharePoint", 1)],
      steps: [
        steg("s1", "start", "Startar", "Handläggare"),
        steg("s2", "decision", "Klart?", "Handläggare"),
        steg("s3", "activity", "Gör klart", "Handläggare", {
          branchOf: { stepId: "s2", label: "Ja" },
        }),
      ],
    };
    expect(compileDraft(bas).nodes.find((n) => n.id === "end_final")!.laneId).toBe("Handläggare");
    // Användaren drar slutet till SharePoint → valet lagras i autoLanes och ska stå kvar.
    const flyttad = { ...bas, autoLanes: { end_final: "SharePoint" } };
    expect(compileDraft(flyttad).nodes.find((n) => n.id === "end_final")!.laneId).toBe("SharePoint");
  });

  it("kontrollen varnar RÅDGIVANDE när slutet ligger i en bana ingen väg går till", () => {
    const draft: ProcessDraft = {
      ...emptyDraft(),
      title: "Slut i fel bana",
      lanes: [makeLane("Portalen", 0), makeLane("SharePoint", 1)],
      steps: [
        steg("s1", "start", "Startar", "Portalen"),
        steg("s2", "activity", "Arbetar i portalen", "Portalen"),
        // Precis felet i de sparade flödena: slutet la sig i loggningens bana.
        steg("s3", "end", "Klart", "SharePoint"),
      ],
    };
    const frågor = checkBpmn(compileDraft(draft));
    const träff = frågor.find((i) => i.message.includes('Slut-event "Klart" ligger i banan'));
    expect(träff).toBeTruthy();
    expect(träff!.level).toBe("warn"); // rådgivande, aldrig en spärr
    expect(träff!.message).toContain("Portalen");
  });

  it("ligger slutet rätt säger kontrollen ingenting", () => {
    const draft: ProcessDraft = {
      ...emptyDraft(),
      title: "Slut i rätt bana",
      lanes: [makeLane("Portalen", 0)],
      steps: [
        steg("s1", "start", "Startar", "Portalen"),
        steg("s2", "activity", "Arbetar i portalen", "Portalen"),
        steg("s3", "end", "Klart", "Portalen"),
      ],
    };
    expect(checkBpmn(compileDraft(draft)).some((i) => i.message.includes("ligger i banan"))).toBe(
      false,
    );
  });
});
