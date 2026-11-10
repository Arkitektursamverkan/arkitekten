import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { compileDraft } from "@/core/draft";
import type { SavedFlow } from "@/core/flow-store";
import { filterByPerspective } from "@/tools/flowchart/perspective";
import { layoutModel, PAGE_FORMATS } from "./layout";

const optioner = (skala: number) => ({
  pageWidth: PAGE_FORMATS.word.width,
  pageHeight: null,
  scale: skala,
  shrinkToContent: true,
  spacing: 1,
});

// Testet läser installationens flöden, som inte ligger i git. Utan dem hoppas det över.
// (Regressionen på det enskilda flöde där felet först syntes nämner det flödet
// och ligger därför i installationens `.lokalt/`.)
describe("dubbla sidhänvisningar", () => {
  /**
   * REGRESSION: regeln bevakades bara på ETT flöde, och husstil.test.ts svepte
   * bara två flödesfamiljer. Därför kunde tre flöden utanför de familjerna
   * bära dubbelmärket helt oupptäckt, medan det fjärde råkade ligga i en
   * bevakad familj och var det enda som gjorde bygget rött. Ett fel som
   * bara upptäcks när det råkar ligga i rätt mapp är inte bevakat.
   *
   * Svepningen mäter FLÖDETS NUVARANDE innehåll (`flow.draft`) – samma sak som
   * `scripts/ratta-dubbla-hanvisningar.mts` rättar och samma sak husstil-testet
   * läser. Rättas ett flöde som utkast syns det alltså här direkt, medan
   * exporten (som tar den fastslagna versionen) släpar tills någon fastställer.
   */
  it("inget flöde i biblioteket bär två likadana sidhänvisningar", () => {
    if (!fs.existsSync("flows")) return; // tom kassering – inget att bevaka

    const brott: string[] = [];
    for (const fil of fs.readdirSync("flows").filter((f) => f.endsWith(".json"))) {
      const flow = JSON.parse(fs.readFileSync(`flows/${fil}`, "utf8")) as SavedFlow;
      // Affärsprocesserna har en egen layoutmotor med egna regler (layout-affarsprocess.ts) –
      // att köra dem genom flödesschemats sidplanerare mäter något som aldrig
      // ritas. Samma avgränsning som page-rules.test.ts gör.
      if (fil.startsWith("ap-") || flow.draft?.diagramType === "affarsprocess") continue;
      if (!flow.draft?.steps) continue;

      const modell = compileDraft(flow.draft);
      const lay = layoutModel(
        filterByPerspective(modell, flow.view?.perspective ?? "system"),
        // Flödets egen skala – samma optioner som rättningsskriptet använder,
        // annars kan testet kräva något fixaren inte kan åstadkomma.
        optioner(flow.view?.scale ?? 1),
      );

      const sedda = new Set<string>();
      for (const r of lay.pageRefs) {
        const k = `${r.nodeId}|${r.sida}|${r.text}`;
        if (sedda.has(k)) brott.push(`${fil}: ${k}`);
        sedda.add(k);
      }
    }
    expect(brott).toEqual([]);
  });
});
