// @vitest-environment happy-dom
/**
 * REGRESSION: en ny process fanns ingenstans förrän man tryckte Spara.
 *
 * Katalogens rubriker finns bara genom sparade processer. Skrev man in en ny
 * kategori i "Ny process" hände det alltså ingenting synligt – rubriken dök
 * upp först efter en sparning, och att den behövdes var inte uppenbart (beslut
 * 2026-09-04: "Direkt när jag anger ny Kategori i katalogen så ska det
 * skapas"). Nu läggs posten in i biblioteket i samma andetag som processen.
 *
 * Testet ligger på verktyget och inte på vyn: det är verktyget som äger
 * mellanlagret, och sparningen sker i en effekt EFTER den render som
 * begäran utlöser – ett anrop inne i `påbörjaNy` hade sparat gamla props.
 */

import { expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { SavedFlow } from "@/core/flow-store";

const sparade = new Map<string, SavedFlow>();

vi.mock("@/core/flow-store", async () => {
  const riktig = await vi.importActual<typeof import("@/core/flow-store")>("@/core/flow-store");
  return {
    ...riktig,
    getFlowStore: async () => ({
      kind: "local" as const,
      list: async () => [],
      load: async (id: string) => {
        const f = sparade.get(id);
        if (!f) throw new Error("Flödet finns inte.");
        return f;
      },
      save: async (f: SavedFlow) => void sparade.set(f.id, f),
      remove: async (id: string) => void sparade.delete(id),
    }),
  };
});

const { FlowchartTool } = await import("./FlowchartTool");

it("en ny process med ny kategori hamnar i biblioteket direkt", async () => {
  render(
    <FlowchartTool
      nyProcess={{
        namn: "Demo",
        kategori: "Demo",
        underkategori: "Utbildning",
        text: "Medarbetare → Startar Portalen → Skickar in",
        start: "regler",
        nonce: 1,
      }}
      läge="redigerar"
    />,
  );

  await waitFor(() => expect(sparade.size).toBe(1), { timeout: 4000 });
  const flöde = sparade.get("demo")!;
  expect(flöde.name).toBe("Demo");
  // Kategorin är det som ger rubriken i menyn – utan den ingen "Demo"-gren.
  expect(flöde.category).toBe("Demo");
  // …och underkategorin grenen under den.
  expect(flöde.subcategory).toBe("Utbildning");
  // Första sparningen är ett utkast: 0.1, inte en fastslagen version.
  expect(flöde.versions).toHaveLength(1);
});

it("REGRESSION: begäran om en ny process spelades upp igen och sparade processen TOM ovanpå det man ritat", async () => {
  // Innovation - demo, 2026-10-01: effekten som tar emot begäran kördes om
  // (Fast Refresh/ommontering) med SAMMA begäran. Verktyget började om på
  // processen och sparade direkt – en tom version ovanpå den ifyllda.
  sparade.clear();
  const begäran = { namn: "Ide", kategori: "", underkategori: "", text: "", start: "tom" as const, nonce: 7 };
  const mottagen = vi.fn();
  const { rerender } = render(
    <FlowchartTool nyProcess={begäran} onNyProcessMottagen={mottagen} läge="redigerar" />,
  );
  await waitFor(() => expect(sparade.size).toBe(1), { timeout: 4000 });
  // Skalet får veta att begäran är mottagen, så att det kan släppa den.
  expect(mottagen).toHaveBeenCalledTimes(1);

  // Användaren ritar och sparar: en andra version med innehåll.
  const första = sparade.get("ide")!;
  const ifylld = { ...första.draft, title: "Ifylld" };
  sparade.set("ide", {
    ...första,
    draft: ifylld,
    versions: [...första.versions, { ...första.versions[0], id: "v2", draft: ifylld }],
  });

  // Samma begäran en gång till (ny identitet, samma nonce) – effekten körs om.
  rerender(<FlowchartTool nyProcess={{ ...begäran }} onNyProcessMottagen={mottagen} läge="redigerar" />);
  await new Promise((r) => setTimeout(r, 300));

  expect(sparade.get("ide")!.versions).toHaveLength(2);
  expect(sparade.get("ide")!.draft.title).toBe("Ifylld");
  expect(mottagen).toHaveBeenCalledTimes(1);
});
