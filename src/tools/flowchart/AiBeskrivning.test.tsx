// @vitest-environment happy-dom
/**
 * "Använd AI-beskrivningen" – knappen som såg ut att vara död.
 *
 * FELBETEENDET: knappen kör beskrivningen genom REGELMOTORN. Trycker man
 * direkt efter en AI-tolkning är texten oförändrad, och regelmotorn kommer
 * fram till exakt samma steg som redan står på skärmen – men den kan inte veta
 * vilka BANOR AI:n valde, för pilformatet bär ingen bana. Trycket såg alltså ut
 * att inte göra någonting, och det lilla det gjorde var en försämring: flödet
 * flyttades till standardbanan.
 *
 * Kravet: knappen är aktiv bara när texten faktiskt ändrats, och en
 * tillämpning kvitteras så att den aldrig läses som verkningslös.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FlowchartTool } from "./FlowchartTool";

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
  for (const [k, v] of [
    ["offsetWidth", 1200],
    ["offsetHeight", 800],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, k, { configurable: true, value: v });
  }
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800 }),
  });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ingen brygga")));
});

afterEach(cleanup);

/** Beskrivningspanelen står öppen i redigeringsläget – byt till AI-fliken. */
function öppnaAiFliken() {
  render(<FlowchartTool läge="redigerar" />);
  fireEvent.click(screen.getByRole("button", { name: "AI-beskrivning" }));
  return screen.getByPlaceholderText(/AI:ns tolkade/);
}

const knapp = () =>
  screen.getByRole("button", { name: "Använd AI-beskrivningen" }) as HTMLButtonElement;
const steg = () => document.querySelector(".ark-flow-header-steg")!.textContent;

it("REGRESSION: knappen är död när det inte finns något att tillämpa, och säger varför", () => {
  öppnaAiFliken();

  // Tom beskrivning: ingenting att tolka.
  expect(knapp().disabled).toBe(true);
  expect(screen.getByText(/oförändrad sedan tolkningen/)).toBeTruthy();
});

it("en ÄNDRAD beskrivning går att tillämpa, och tillämpningen kvitteras", async () => {
  const ruta = öppnaAiFliken();
  const före = steg();

  fireEvent.change(ruta, { target: { value: "Prov\nEtt steg → Två steg → Tre steg" } });
  expect(knapp().disabled).toBe(false);
  // Beskedet ska nämna att banorna inte följer med – det är den enda skillnad
  // man annars upptäcker först efteråt.
  expect(screen.getByText(/standardbanan/)).toBeTruthy();

  fireEvent.click(knapp());
  await waitFor(() => expect(steg()).not.toBe(före));
  expect(steg()).toBe("3 steg");
  // Kvittensen gör att ett tryck aldrig läses som verkningslöst.
  expect(screen.getByText(/Diagrammet byggdes om ur beskrivningen/)).toBeTruthy();
});

it("efter en tillämpning finns det inget nytt att tillämpa förrän texten ändras igen", async () => {
  const ruta = öppnaAiFliken();

  fireEvent.change(ruta, { target: { value: "Prov\nEtt steg → Två steg" } });
  fireEvent.click(knapp());
  await waitFor(() => expect(steg()).toBe("2 steg"));

  expect(knapp().disabled).toBe(true);
  fireEvent.change(ruta, { target: { value: "Prov\nEtt steg → Två steg → Tre steg" } });
  expect(knapp().disabled).toBe(false);
});

it("REGRESSION: sidolistan med Beskrivning och AI-beskrivning var stängd när man redigerade ett vanligt flöde – den öppnas nu i redigeringsläget", () => {
  const { rerender } = render(<FlowchartTool läge="läser" />);
  expect(screen.queryByRole("button", { name: "AI-beskrivning" })).toBeNull();
  rerender(<FlowchartTool läge="redigerar" />);
  expect(screen.getByRole("button", { name: "AI-beskrivning" })).toBeTruthy();
});
