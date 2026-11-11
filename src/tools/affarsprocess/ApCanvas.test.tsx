// @vitest-environment happy-dom
/**
 * Komponenttest för affärsprocessens rityta: MUSGESTERNA.
 *
 * Att markera flera objekt med en ram (och sedan flytta dem tillsammans) är
 * samma gest i båda verktygen – konstanterna delas i render/canvas-gester.ts.
 * React Flow visar utfallet i ritytans egna klasser: `selection` = ett
 * vänsterdrag ritar en markeringsram, `draggable` = det panorerar. De två kan
 * inte gälla samtidigt, och växlingen ska följa läget: redigering, låst
 * (läsläge) eller placering ur paletten.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { compileAp, setStepAp } from "@/core/affarsprocess";
import { emptyDraft, makeLane, type DraftStep, type ProcessDraft } from "@/core/draft";
import type { NodeType } from "@/core/model";
import { ApCanvas, kedjekantFör } from "./ApCanvas";
import { layoutAp } from "./layout-affarsprocess";

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
    Object.defineProperty(HTMLElement.prototype, nyckel, { configurable: true, value: värde });
  }
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800 }),
  });
});

afterEach(cleanup);

function steg(id: string, type: NodeType, text: string): DraftStep {
  return { id, type, text, laneId: "Processen", sourceIndex: 0 };
}

const draft: ProcessDraft = {
  ...emptyDraft(),
  title: "Test",
  lanes: [makeLane("Processen", 0)],
  steps: [
    steg("s0", "start", "Behov uppstår"),
    steg("a1", "activity", "Registrera ansökan"),
    steg("a2", "activity", "Genomför urval"),
  ],
};

const layout = layoutAp(compileAp(draft));

function vy(låst = false, placerar = false) {
  return (
    <ApCanvas
      layout={layout}
      textScale={1}
      låst={låst}
      placerar={placerar}
      onPositionChange={vi.fn()}
      onWaypointChange={vi.fn()}
      onSelect={vi.fn()}
    />
  );
}

const pane = (el: HTMLElement) => el.querySelector(".react-flow__pane")!;

describe("markeringsruta", () => {
  it("redigeringsläge: vänsterdraget ritar en ram", () => {
    const { container } = render(vy());
    expect(pane(container).classList.contains("selection")).toBe(true);
    // …och panoreringen har lämnat vänsterknappen, annars vore ramen död.
    expect(pane(container).classList.contains("draggable")).toBe(false);
  });

  it("låst rityta: vänsterdraget panorerar som förut", () => {
    const { container } = render(vy(true));
    expect(pane(container).classList.contains("draggable")).toBe(true);
    expect(pane(container).classList.contains("selection")).toBe(false);
  });

  it("placeringsläge: ytan hör till palettobjektet, inte till ramen", () => {
    const { container } = render(vy(false, true));
    expect(pane(container).classList.contains("selection")).toBe(false);
  });
});

/**
 * REGRESSION-vakt för markeringsrutan: Delete får inte tömma ritytan.
 *
 * Objekten ligger i canvasens EGEN nodlista (onNodesChange applicerar allt
 * React Flow skickar), så en radering hade tagit bort dem från skärmen utan
 * att röra mellanlagret – borta tills nästa omkompilering, som om de aldrig
 * funnits. Objekt tas bort i inspektören, där man ser vad man tar bort.
 */
describe("Delete på ett markerat objekt", () => {
  it("lämnar objektet kvar", async () => {
    const { container } = render(vy());
    const objekt = container.querySelectorAll(".react-flow__node-ap");
    expect(objekt.length).toBeGreaterThan(0);
    fireEvent.click(objekt[0]);
    fireEvent.keyDown(document, { key: "Backspace", code: "Backspace" });
    fireEvent.keyUp(document, { key: "Backspace", code: "Backspace" });
    // Raderingen är asynkron – React Flow rör noderna först i nästa mikrotick.
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelectorAll(".react-flow__node-ap")).toHaveLength(objekt.length);
  });
});

/** Samma växel som i flödesschemat, på samma plats och med samma förval. */
describe("växeln markera/flytta vyn", () => {
  it("börjar i markeringsläge och byter till hand – och tillbaka", () => {
    const { container } = render(vy());
    expect(pane(container).classList.contains("selection")).toBe(true);

    fireEvent.click(screen.getByText("Flytta vyn"));
    expect(pane(container).classList.contains("draggable")).toBe(true);
    expect(pane(container).classList.contains("selection")).toBe(false);

    fireEvent.click(screen.getByText("Markera"));
    expect(pane(container).classList.contains("selection")).toBe(true);
  });

  it("finns inte i låst läge – där gäller handen alltid", () => {
    const { container } = render(vy(true));
    expect(container.querySelectorAll(".ark-pekarval")).toHaveLength(0);
    expect(pane(container).classList.contains("draggable")).toBe(true);
  });
});

/**
 * REGRESSION: markeringsrapporten gick i en evig slinga. Handlaren till React
 * Flow skapades inline, så SelectionListener fick en ny handlare per render,
 * rapporterade en ny (tom) lista, föräldern satte state och renderade om –
 * "Maximum update depth exceeded" så fort en affärsprocess öppnades.
 */
describe("markeringsrapporten", () => {
  it("rapporterar inte om en oförändrad markering när föräldern renderar om", () => {
    const rapporter: string[][] = [];
    function Förälder() {
      const [, setMarkerade] = React.useState<string[]>([]);
      return (
        <ApCanvas
          layout={layout}
          textScale={1}
          onPositionChange={vi.fn()}
          onWaypointChange={vi.fn()}
          onSelect={vi.fn()}
          onSelectionChange={(ids) => {
            rapporter.push(ids);
            // Taket bryter slingan, så att testet fallerar i stället för att hänga.
            if (rapporter.length < 20) setMarkerade(ids);
          }}
        />
      );
    }
    render(<Förälder />);
    expect(rapporter.length).toBeLessThanOrEqual(1);
  });
});

/**
 * REGRESSION: markeringen försvann när avståndet ändrades. "Tätare"/"Glesare"
 * ger ett nytt utlägg, noderna byggdes om utan `selected`, och man fick
 * markera om objekten för varje klick.
 */
describe("markeringen efter ett nytt utlägg", () => {
  it("står kvar på objekten som finns kvar", async () => {
    const ny = layoutAp(compileAp({ ...draft, kolumnAvstånd: { s0: 0.5, a1: 0.5 } }));
    const props = { textScale: 1, onPositionChange: vi.fn(), onWaypointChange: vi.fn(), onSelect: vi.fn() };
    const { container, rerender } = render(<ApCanvas layout={layout} {...props} />);
    const a1 = () => container.querySelector('.react-flow__node-ap[data-id="a1"]')!;
    fireEvent.click(a1());
    expect(a1().classList.contains("selected")).toBe(true);
    rerender(<ApCanvas layout={ny} {...props} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(a1().classList.contains("selected")).toBe(true);
  });
});

/**
 * REGRESSION: kedjan mellan tolkade steg gick inte att bryta i Affärsprocess.
 * Klick på en kedjepil ger knappen "Bryt kedjan här", som skickar
 * MELLANLAGRETS kant (inte relationens ändar). React Flow ritar inga kanter i
 * happy-dom, så kopplingen pil → kant testas här och knappens frånvaro nedan.
 */
describe("Bryt kedjan här", () => {
  it("en kedjepil ger mellanlagrets kant, ett satellitstreck ingen", () => {
    const rel = layout.relations.find((r) => r.kant?.source === "a1" && r.kant.target === "a2")!;
    expect(kedjekantFör(layout.relations, { source: rel.source, target: rel.target, label: rel.label })).toEqual(
      rel.kant,
    );
    expect(kedjekantFör(layout.relations, { source: "a1", target: "a2", label: "Ja" })).toBeUndefined();
    // Klicket på en omärkt pil bär den utskrivna etiketten "" (fanns bara i webbläsaren).
    expect(kedjekantFör(layout.relations, { source: rel.source, target: rel.target, label: "" })).toEqual(rel.kant);
    const medRoll = layoutAp(
      compileAp(setStepAp(draft, "a1", { roller: [{ namn: "Handläggare" }] })),
    );
    const streck = medRoll.relations.find((r) => r.kind === "huki")!;
    expect(
      kedjekantFör(medRoll.relations, { source: streck.source, target: streck.target, label: streck.huki }),
    ).toBeUndefined();
  });

  it("knappen syns inte förrän en kedjepil är vald", () => {
    render(
      <ApCanvas
        layout={layout}
        textScale={1}
        onPositionChange={vi.fn()}
        onWaypointChange={vi.fn()}
        onSelect={vi.fn()}
        onTaBortKant={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Bryt kedjan här/)).toBeNull();
  });
});
