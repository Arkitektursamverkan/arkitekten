// @vitest-environment happy-dom
/**
 * Saneringen före `dangerouslySetInnerHTML` (render/saker-svg.ts).
 *
 * happy-dom är inte DOMPurifys miljö (den läser elementnamnen tomma och
 * plockar bort svg-roten), så här prövas bara att det farliga försvinner. Att
 * saneringen INTE tar något från appens egna bilder prövas i en riktig
 * webbläsare: e2e/saker-svg.browser.test.ts.
 */

import { describe, expect, it } from "vitest";
import { compileAp } from "@/core/affarsprocess";
import { textToDraft } from "@/tools/flowchart/parser/toDraft";
import { layoutAp } from "@/tools/affarsprocess/layout-affarsprocess";
import { renderApSvg } from "@/tools/affarsprocess/svg-affarsprocess";
import { läggPåRam, TOM_SVG } from "@/tools/ramar/effekter";
import { säkerSvg } from "./saker-svg";

describe("säkerSvg", () => {
  it("REGRESSION: skript, händelseattribut och foreignObject i en bild når aldrig sidan", () => {
    const ond =
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script>` +
      `<path d="M0,0" marker-end="url(#x)" onload="alert(2)"/>` +
      `<foreignObject><div onclick="alert(3)">x</div></foreignObject>` +
      `<a href="javascript:alert(4)"><text>klick</text></a>` +
      `<style>*{background:url(javascript:alert(5))}</style>` +
      `<animate attributeName="href" values="javascript:alert(6)"/></svg>`;
    const ut = säkerSvg(ond);
    expect(ut).not.toMatch(/script|onload|onclick|foreignObject|javascript|<style|<a\b|attributeName="href"/i);
  });

  it("REGRESSION: en HUKI-bokstav med markup bryter inte ut ur marker-end", () => {
    const draft = { ...textToDraft("Test\nGör något [Roll: Handläggare U] → Klart"), diagramType: "affarsprocess" as const };
    const steg = draft.steps.find((s) => s.ap?.roller?.length)!;
    steg.ap!.roller![0].huki = 'U)"/><script>alert(1)</script><path d="' as never;
    const svg = renderApSvg(layoutAp(compileAp(draft)));
    expect(svg).not.toContain("<script");
    expect(svg).toContain('marker-end="url(#ap-arrow-huki-U)"');
  });

  it("REGRESSION: läggPåRam lämnar aldrig tillbaka indata som inte är en bild", () => {
    const r = läggPåRam(`<img src=x onerror="alert(1)">`, null);
    expect(r.svg).toBe(TOM_SVG);
  });
});
