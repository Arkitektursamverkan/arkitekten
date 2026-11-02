import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { compileDraft } from "@/core/draft";
import { senasteFastslagna } from "@/core/status";
import type { SavedFlow } from "@/core/flow-store";
import { filterByPerspective } from "@/tools/flowchart/perspective";
import { layoutModel, PAGE_FORMATS } from "./layout";
import { döljDubblaHänvisningar } from "./dubbla-hanvisningar";

const optioner = (skala: number) => ({
  pageWidth: PAGE_FORMATS.word.width,
  pageHeight: null,
  scale: skala,
  shrinkToContent: true,
  spacing: 1,
});

// Testerna läser en viss installations flöde, som inte ligger i git. Utan det hoppas de över.
describe.skipIf(!fs.existsSync("flows/avvikelse-byt-avdelning.json"))("dubbla sidhänvisningar", () => {
  /**
   * REGRESSION: regeln fanns bara inuti skriptet som skapade avvikelseflödena.
   * "Byt avdelning/enhet" ändrades efteråt i appen (Nej-kanten drogs om), snittet
   * flyttade sig, och beslutsrutan "Är ärendet en avvikelse?" fick tillbaka två
   * identiska "från del 2" ovanpå varandra – ett från sekvenspilen s10→s11 och
   * ett från datalagrets association s9→s11. Ingen upptäckte det förrän bilden
   * exporterades. Nu är regeln en delad modul, och det här testet håller den vid
   * liv oavsett vem som kallar den.
   */
  it("behåller flödets märke och döljer artefaktens", () => {
    const flow = JSON.parse(
      fs.readFileSync("flows/avvikelse-byt-avdelning.json", "utf8"),
    ) as SavedFlow;
    // Den fastslagna versionen är den som exporteras – det är den som ska stämma.
    const fast = senasteFastslagna(flow.versions)!;
    const modell = compileDraft(fast.version.draft);
    const lay = layoutModel(
      filterByPerspective(modell, "system"),
      optioner(flow.view?.scale ?? 0.6),
    );

    // Inget kvar att dölja: rättningen sitter redan i den fastslagna versionen.
    expect(döljDubblaHänvisningar(modell, lay)).toEqual({});

    // Och det som syns är sekvenspilens märke, inte associationens.
    const in11 = lay.pageRefs.filter((r) => r.nodeId === "s11" && r.sida === "in");
    expect(in11).toHaveLength(1);
    expect(in11[0].edgeSource).toBe("s10");
  });

  it("pekar ut märket som ska bort när det inte redan är dolt", () => {
    const flow = JSON.parse(
      fs.readFileSync("flows/avvikelse-byt-avdelning.json", "utf8"),
    ) as SavedFlow;
    const fast = senasteFastslagna(flow.versions)!;
    // Utan rättningen: samma flöde, men de dolda flaggorna bortplockade.
    const utan = {
      ...fast.version.draft,
      edgeStyles: Object.fromEntries(
        Object.entries(fast.version.draft.edgeStyles ?? {}).map(([k, v]) => [
          k,
          { ...(v as object), hideRefIn: undefined, hideRefOut: undefined },
        ]),
      ),
    };
    const modell = compileDraft(utan);
    const lay = layoutModel(
      filterByPerspective(modell, "system"),
      optioner(flow.view?.scale ?? 0.6),
    );
    expect(döljDubblaHänvisningar(modell, lay)).toEqual({ "s9->s11": { hideRefIn: true } });
  });

  /**
   * REGRESSION: regeln bevakades bara på ETT flöde (avvikelse-byt-avdelning),
   * och husstil.test.ts svepte bara familjerna `avvikelse-` och `reduktion-`.
   * Därför kunde tre flöden utanför de familjerna – bestallning-ny,
   * utvecklingsforslag-fortsatta-utkast och
   * utvecklingsforslag-skicka-till-handlaggare – bära dubbelmärket helt
   * oupptäckt, medan det fjärde (reduktion-las-upp-for-redigering) råkade ligga
   * i en bevakad familj och var det enda som gjorde bygget rött. Ett fel som
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
