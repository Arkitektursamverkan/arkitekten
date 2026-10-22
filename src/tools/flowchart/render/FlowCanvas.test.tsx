// @vitest-environment happy-dom
/**
 * Komponenttest för canvasen vid banstorleks-ändring.
 *
 * Varför ett riktigt DOM-test: layoutmotorn är enhetstestad och ger rätt svar
 * (alla noder kvar, inom bild, i sin bana) även när en bana ändrar höjd. Ändå
 * försvann objekten på skärmen. Det säger att felet ligger i steget MELLAN
 * layouten och React Flow – och det steget syns bara om komponenten körs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { compileDraft, setLaneHeight, type ProcessDraft } from "@/core/draft";
import { filterByPerspective } from "../perspective";
import { textToDraft } from "../parser/toDraft";
import { FlowCanvas } from "./FlowCanvas";
import { etikettTitel } from "./RoutedEdge";

const TEXT = `Testflöde
A startar → B i portalen → C i portalen → Power Automate flödet triggas → Mejl skickas till handläggaren → D avslutar`;

beforeEach(() => {
  // React Flow mäter sin behållare; utan de här är bredden 0 och inget ritas.
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  global.DOMMatrixReadOnly = class {
    m22 = 1;
    constructor(_t?: string) {}
  } as never;
  for (const [nyckel, värde] of [
    ["offsetWidth", 1200],
    ["offsetHeight", 800],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, nyckel, {
      configurable: true,
      value: värde,
    });
  }
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800 }),
  });
});

afterEach(cleanup);

const draft = textToDraft(TEXT);

function vy(
  d: ProcessDraft,
  pageFormat: "word" | "free",
  locked = false,
  visaVerktyg = true,
  onEdgeRemove: (source: string, target: string, label?: string) => void = vi.fn(),
) {
  const modell = filterByPerspective(compileDraft(d), "system");
  return (
    <FlowCanvas
      model={modell}
      pageFormat={pageFormat}
      scale={1}
      colorMode="type"
      regenKey={0}
      locked={locked}
      visaVerktyg={visaVerktyg}
      onLabelChange={vi.fn()}
      onLaneResize={vi.fn()}
      onPositionChange={vi.fn()}
      onEdgeSidesChange={vi.fn()}
      onEdgeSidesReset={vi.fn()}
      onEdgeRemove={onEdgeRemove}
      editablePairs={new Set<string>()}
    />
  );
}

/** Antalet processnoder som faktiskt hamnat i DOM:en. */
function antalObjekt(el: HTMLElement): number {
  return el.querySelectorAll(".react-flow__node-process").length;
}

describe("objekten överlever en banstorleks-ändring", () => {
  const bana = filterByPerspective(compileDraft(draft), "system").swimlanes[1];

  for (const format of ["word", "free"] as const) {
    it(`${format}: noderna finns kvar när banan får ny höjd i en LEVANDE vy`, () => {
      // Att montera om med den nya höjden bevisar ingenting – det är den
      // levande omritningen (samma komponent, ny model-prop) som går genom
      // useEffect + setNodes, och det är där objekten försvann.
      const { container, rerender } = render(vy(draft, format));
      const före = antalObjekt(container);
      expect(före, "inga noder ritades ens från början").toBeGreaterThan(0);

      rerender(vy(setLaneHeight(draft, bana.id, 320), format));
      expect(antalObjekt(container), `objekten försvann i ${format}`).toBe(före);
    });

    it(`${format}: förstora och dra TILLBAKA lämnar inget tomt`, () => {
      // Exakt sekvensen: dra ned (förstora), dra upp igen (minska).
      const { container, rerender } = render(vy(draft, format));
      const före = antalObjekt(container);
      const upp = [200, 300, 450, 600, 800];
      const ner = [600, 450, 300, 200, 150, 120, 90, 60];
      for (const h of [...upp, ...ner]) {
        rerender(vy(setLaneHeight(draft, bana.id, h), format));
        expect(antalObjekt(container), `objekten försvann vid höjd ${h} i ${format}`).toBe(före);
      }
    });

    it(`${format}: noderna överlever ett HELT drag (många små steg)`, () => {
      // Ett riktigt drag ger hundratals omritningar i rad.
      const { container, rerender } = render(vy(draft, format));
      const före = antalObjekt(container);
      for (let h = 130; h <= 400; h += 10) {
        rerender(vy(setLaneHeight(draft, bana.id, h), format));
      }
      expect(antalObjekt(container), `objekten försvann under draget i ${format}`).toBe(före);
    });
  }
});

/**
 * REGRESSION: det gick att dra nya kopplingar på en LÅST rityta.
 *
 * React Flows `<Handle>` har `isConnectable = true` som STANDARD, och nodens
 * egen flagga (`nodesConnectable` / `node.connectable`) når handtaget bara om
 * nodvyn skickar propen vidare. Det gjorde ingen av dem, så låsningen stängde
 * av dragning och markering men inte kopplingar – i läsläge, där ingenting
 * alls ska gå att ändra.
 *
 * Handtaget märks med klassen `connectable` när det ÄR kopplingsbart; testet
 * mäter alltså exakt det React Flow går på när gesten ska tillåtas.
 */
describe("låst rityta", () => {
  it("går inte att koppla ihop objekt på", () => {
    const { container } = render(vy(draft, "free", true));
    expect(container.querySelectorAll(".ark-handle").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".ark-handle.connectable")).toHaveLength(0);
  });

  it("…men upplåst går det", () => {
    const { container } = render(vy(draft, "free", false));
    expect(container.querySelectorAll(".ark-handle.connectable").length).toBeGreaterThan(0);
  });
});

/**
 * REGRESSION: etikettens hovertext svarade på fel fråga.
 *
 * Kantens innebörd låg bara på det osynliga svepet längs strecket, medan
 * etiketten – det man faktiskt pekar på – bar handgreppet ("dra för att
 * flytta") eller ingenting alls. En ensam HUKI-bokstav förklarade sig alltså
 * aldrig. Nu står innebörden först och handgreppet sist.
 */
describe("etikettTitel", () => {
  it("sätter innebörden först och handgreppet sist", () => {
    expect(etikettTitel("U – Utför: ”HR” utför ”Genomför urval”", "Dra för att flytta")).toBe(
      "U – Utför: ”HR” utför ”Genomför urval” · Dra för att flytta",
    );
  });

  it("var för sig fungerar de lika bra", () => {
    expect(etikettTitel("Flöde: ”A” → ”B”")).toBe("Flöde: ”A” → ”B”");
    expect(etikettTitel(undefined, "Dra för att flytta")).toBe("Dra för att flytta");
  });

  it("ingen text alls ger ingen titel – inte en tom sträng", () => {
    // En tom title-attribut ger en tom ruta vid pekaren i vissa webbläsare.
    expect(etikettTitel()).toBeUndefined();
    expect(etikettTitel("", "")).toBeUndefined();
  });
});

/**
 * REGRESSION: ritverktygen låg kvar OVANPÅ ett formulär.
 *
 * Verktygsraden (Koppla ihop, Start, Aktivitet …) flyter över ritytan med
 * z-index. Startade man en process från MALLEN öppnades formuläret på samma
 * yta – och verktygen stod kvar ovanpå det, så man fyllde i ett formulär med
 * ritverktygen i handen (2026-09-04). Samma sak gällde mellanlagret,
 * granskningen och spårbarheten.
 */
describe("ritverktygen och formulären", () => {
  it("verktygsraden göms när ett formulär tar över ytan", () => {
    const { container, rerender } = render(vy(draft, "free"));
    expect(container.querySelectorAll(".ark-verktygsrad")).toHaveLength(1);

    rerender(vy(draft, "free", false, false));
    expect(container.querySelectorAll(".ark-verktygsrad")).toHaveLength(0);

    // …och kommer tillbaka när formuläret stängs.
    rerender(vy(draft, "free", false, true));
    expect(container.querySelectorAll(".ark-verktygsrad")).toHaveLength(1);
  });

  it("ett låst läge göms som förut", () => {
    const { container } = render(vy(draft, "free", true));
    expect(container.querySelectorAll(".ark-verktygsrad")).toHaveLength(0);
  });
});

/**
 * Markera flera objekt genom att dra en ram på tom yta (beslut 2026-09-07).
 *
 * React Flow visar valet i ritytans egna klasser: `selection` betyder att ett
 * vänsterdrag ritar en markeringsram, `draggable` att det panorerar. De två
 * kan inte gälla samtidigt – biblioteket stänger av markeringsrutan så fort
 * panoreringen har vänsterknappen – och det är just den växlingen som ska
 * följa redigeringsläget.
 */
describe("markeringsruta", () => {
  const pane = (el: HTMLElement) => el.querySelector(".react-flow__pane")!;

  it("redigeringsläge: vänsterdraget ritar en ram", () => {
    const { container } = render(vy(draft, "free"));
    expect(pane(container).classList.contains("selection")).toBe(true);
    // …och panoreringen har lämnat vänsterknappen, annars vore ramen död.
    expect(pane(container).classList.contains("draggable")).toBe(false);
  });

  it("låst rityta: vänsterdraget panorerar som förut", () => {
    const { container } = render(vy(draft, "free", true));
    expect(pane(container).classList.contains("draggable")).toBe(true);
    expect(pane(container).classList.contains("selection")).toBe(false);
  });

  it("med ett ritverktyg i handen gäller ytan verktyget, inte ramen", () => {
    const { container } = render(vy(draft, "free"));
    fireEvent.click(screen.getByText("Koppla ihop"));
    expect(pane(container).classList.contains("selection")).toBe(false);
  });
});

/**
 * REGRESSION-vakt för markeringsrutan: Delete får aldrig tömma flödet.
 *
 * Ramen markerar även KOPPLINGARNA mellan de inramade objekten – React Flows
 * egen regel. Utan spärren hade "markera flera och tryck Delete" plockat bort
 * alla de kopplingarna ur mellanlagret medan objekten kom tillbaka vid nästa
 * omritning, alltså ett flöde utan pilar. Objekt tas bort i inspektören.
 */
describe("Delete på markerade objekt", () => {
  it("tar varken bort objektet eller dess kopplingar", async () => {
    const taBortKant = vi.fn();
    const { container } = render(vy(draft, "free", false, true, taBortKant));
    const nod = container.querySelector(".react-flow__node-process")!;
    fireEvent.click(nod);
    fireEvent.keyDown(document, { key: "Backspace", code: "Backspace" });
    fireEvent.keyUp(document, { key: "Backspace", code: "Backspace" });
    // Raderingen är asynkron (React Flow frågar onBeforeDelete i en Promise).
    await act(async () => {
      await Promise.resolve();
    });
    expect(taBortKant).not.toHaveBeenCalled();
    expect(antalObjekt(container)).toBeGreaterThan(0);
  });
});

/**
 * Växeln mellan markering och hand (beslut 2026-09-07).
 *
 * Gesterna kan inte dela vänsterknapp, så valet måste vara ett läge man ser
 * och kan byta. React Flow visar utfallet i ritytans klasser: `selection` =
 * ramen, `draggable` = handen. Pekaren ska följa med – en hand i
 * markeringsläget lovar en flytt som inte händer.
 */
describe("växeln markera/flytta vyn", () => {
  const pane = (el: HTMLElement) => el.querySelector(".react-flow__pane")!;

  it("börjar i markeringsläge och byter till hand – och tillbaka", () => {
    const { container } = render(vy(draft, "free"));
    expect(pane(container).classList.contains("selection")).toBe(true);
    expect(container.querySelector(".ark-canvas")!.classList.contains("ark-canvas--markera")).toBe(true);

    fireEvent.click(screen.getByText("Flytta vyn"));
    expect(pane(container).classList.contains("draggable")).toBe(true);
    expect(pane(container).classList.contains("selection")).toBe(false);
    // …och kryss-pekaren släcks med läget.
    expect(container.querySelector(".ark-canvas")!.classList.contains("ark-canvas--markera")).toBe(false);

    fireEvent.click(screen.getByText("Markera"));
    expect(pane(container).classList.contains("selection")).toBe(true);
  });

  it("finns inte i låst läge – där gäller handen alltid", () => {
    const { container } = render(vy(draft, "free", true));
    expect(container.querySelectorAll(".ark-pekarval")).toHaveLength(0);
    expect(pane(container).classList.contains("draggable")).toBe(true);
  });
});
