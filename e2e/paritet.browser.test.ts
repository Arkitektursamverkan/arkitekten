/**
 * REGRESSION: skärmen och SVG-exporten ritar kanterna på SAMMA koordinater.
 *
 * Canvasens kanter hämtade tidigare sina portar ur React Flows MÄTTA
 * handtagspositioner, som kunde ligga 3–4 px utanför layoutens ruta (stale
 * handleBounds). Auto-kanternas linjer låg då några pixlar fel på skärmen
 * jämfört med filen – och en Shift-linjering mot en sådan linje såg perfekt
 * ut på ytan men var bevisligen sned i exporten (en uppmätt 5.svg: 344 vs 347).
 * Nu räknas portarna ur layoutens rutor i BÅDA världarna.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChromium, startaAppen, väljFormat } from "./harness";
import { compileDraft } from "@/core/draft";
import { filterByPerspective } from "../src/tools/flowchart/perspective";
import { textToDraft } from "../src/tools/flowchart/parser/toDraft";
import { layoutModel, PAGE_FORMATS } from "../src/tools/flowchart/layout/layout";
import { renderSvg } from "../src/tools/flowchart/export/svg";

const chromium = findChromium();

const EXAMPLE = `Felanmälan ny
Fel uppkommer → Medarbetare → Startar Portalen → Väljer ny felanmälan från startsidan → Fyller i formulär för felanmälan → Väljer skicka in formuläret för felanmälan → Handläggare utses automatiskt utifrån det system som valts → Kommer till en sida med tack för ditt ärende → Får via mejl bekräftelse på att felanmälan har inkommit

Felanmälan inkommer i SP-listan "Incident" → Power Automate flödet "INC nytt ärende" triggas (↓ Om klassificering = Hög prioritet → Teamschatt skapas med alla handläggare på IT → Chattmeddelande genereras för det specifika ärendet) → Mejlbekräftelse skickas till användaren → Mejl skickas till handläggaren → Loggpost skapas`;

/** Y-koordinater för vågräta segment (längre än 30 px) i en path. */
function horisontellaYn(d: string): number[] {
  const pts = [...d.matchAll(/(-?[\d.]+)[, ](-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  const ys: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    if (Math.abs(pts[i].y - pts[i + 1].y) < 0.01 && Math.abs(pts[i].x - pts[i + 1].x) > 30)
      ys.push(pts[i].y);
  }
  return ys;
}

describe.skipIf(!chromium)("paritet canvas ↔ export", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;
  beforeAll(async () => {
    rigg = await startaAppen();
    // Jämförelsen ställer skärmen mot en export i WORD-format – då måste
    // skärmen också stå i Word. Formatet väljs uttryckligen och hänger inte
    // på vilket format appen råkar ha som förval (det är Fri sedan ett beslut,
    // och testet ska inte falla av ett produktbeslut).
    await väljFormat(rigg.page, "Word");
  }, 90_000);
  afterAll(async () => rigg?.stäng());

  it("REGRESSION: varje vågrät kantlinje på skärmen finns på samma y i exporten", async () => {
    // Meddelandeflödenas mål är poolband (utanför layoutens nodrutor) och
    // jämförs inte här – de har ingen linjeringsbärande vågrät sträcka.
    const canvasYs = (
      await rigg.page.evaluate(() =>
        [...document.querySelectorAll<SVGGElement>(".react-flow__edge")]
          .filter((g) => !(g.getAttribute("data-id") ?? "").startsWith("mf_"))
          .map((g) => g.querySelector(".react-flow__edge-path")?.getAttribute("d") ?? ""),
      )
    ).flatMap(horisontellaYn);
    expect(canvasYs.length).toBeGreaterThan(5);

    const model = filterByPerspective(compileDraft(textToDraft(EXAMPLE)), "system");
    const fmt = PAGE_FORMATS.word;
    const lo = layoutModel(model, { pageWidth: fmt.width, scale: 1, shrinkToContent: true });
    const svg = renderSvg(model, lo, "type", 1);
    const exportYs = [...svg.matchAll(/<path d="(M[^"]+)"[^>]*marker-end/g)].flatMap((m) =>
      horisontellaYn(m[1]),
    );

    for (const y of canvasYs) {
      const träff = exportYs.some((e) => Math.abs(e - y) <= 0.75);
      expect(träff, `canvaslinje på y=${y} saknar motsvarighet i exporten (${exportYs.map((e) => e.toFixed(0)).join(", ")})`).toBe(true);
    }
  });
});
