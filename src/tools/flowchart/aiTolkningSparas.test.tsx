// @vitest-environment happy-dom
/**
 * REGRESSION: en AI-tolkning sparades inte som en version.
 *
 * "Begäran om loggutdrag", 2026-10-02: processen skapades och sparades (0.1,
 * regeltolkad), sedan kördes "Tolka med AI". Svaret ritades, men filen stod
 * kvar på den första versionen – tolkningen fanns bara i editorn tills man
 * tryckte Spara, och ingenting sa att det behövdes. En ny process sparas
 * direkt (2026-09-04); tolkningen av den ska göra detsamma.
 *
 * Felet sågs i verktyget Affärsprocess, men testet ligger på flödesschemat: de två
 * verktygen har samma rader i `runBridge`/`runAi`, och ApTool går inte att
 * rita i testmiljön (renderingen blir aldrig klar i happy-dom).
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

vi.mock("./ai/bridge", async () => {
  const { textToDraft } = await vi.importActual<typeof import("@/tools/flowchart/parser/toDraft")>(
    "@/tools/flowchart/parser/toDraft",
  );
  return {
    aiVäg: async () => "claude-code",
    aktivAiVäg: () => null,
    AKTIV_VÄG_ÄNDRAD: "ark-ai-vag-andrad",
    requestClaudeCodeDraft: async () => {
      // Svaret kommer EFTER att den nya processen hunnit sparas – som i
      // verkligheten, där tolkningen tar minuter.
      for (let i = 0; i < 100 && sparade.size === 0; i++) await new Promise((r) => setTimeout(r, 20));
      await new Promise((r) => setTimeout(r, 100));
      const aiText = "Loggutdrag\nDiarieför ärende → Lämna ut materialet";
      const d = textToDraft(aiText);
      return { ...d, meta: { ...d.meta, aiText, origin: "ai" } };
    },
  };
});

const { FlowchartTool } = await import("./FlowchartTool");

it("REGRESSION: AI-tolkningen av en sparad process blev aldrig en version", async () => {
  const { unmount } = render(
    <FlowchartTool
      nyProcess={{ namn: "Loggutdrag", kategori: "", underkategori: "", text: "Registrator diarieför", start: "ai", nonce: 1 }}
      läge="redigerar"
    />,
  );
  await waitFor(() => expect([...sparade.values()][0]?.versions).toHaveLength(2), { timeout: 4000 });
  const flöde = [...sparade.values()][0];
  expect(flöde.aiText).toContain("Diarieför ärende");
  expect(flöde.draft.steps.some((s) => s.text.includes("Lämna ut materialet"))).toBe(true);
  // Den första versionen står kvar som den var (invariant 11).
  expect(flöde.versions[0].draft.steps.some((s) => s.text.includes("Lämna ut"))).toBe(false);
  // Avmontera: annars kan kanvasens fördröjda fitView slå till efter att
  // testmiljön rivits ("window is not defined") och fälla hela körningen.
  unmount();
});
