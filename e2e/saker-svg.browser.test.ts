/**
 * Saneringen (src/render/saker-svg.ts) i en RIKTIG webbläsare: den tar
 * ingenting från bilderna appen själv ritar – affärsprocess, systemprocess,
 * ramarnas lager med animationer och den avskalade bilden – men allt farligt.
 *
 * Modulerna laddas ur Vite-servern i sidan, så det är samma kod som appen kör.
 * Bara exempelpaketet används (innehallspaket/exempel), inget eget innehåll.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChromium, startaAppen } from "./harness";

const chromium = findChromium();

describe.skipIf(!chromium)("säkerSvg i webbläsaren", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;

  beforeAll(async () => {
    rigg = await startaAppen();
  }, 90_000);
  afterAll(async () => rigg?.stäng());

  it("lämnar exportörernas och ramarnas bilder orörda", async () => {
    const skillnader = await rigg.page.evaluate(async () => {
      // Ett vanligt import() här skrivs om av vitest till dess egen laddare,
      // som inte finns i sidan – strängen lämnas i fred.
      const imp = new Function("p", "return import(p)") as (p: string) => Promise<any>;
      const { säkerSvg } = await imp("/src/render/saker-svg.ts");
      const { processSvg } = await imp("/src/tools/ramar/process-svg.ts");
      const { läggPåRam } = await imp("/src/tools/ramar/effekter.ts");
      const { renderAvskaladSvg, avskalaAp } = await imp("/src/tools/ramar/avskalad.ts");
      const { compileAp } = await imp("/src/core/affarsprocess.ts");
      const { apNodeSvg } = await imp("/src/tools/affarsprocess/former.ts");
      const { nyRam } = await imp("/src/core/ram.ts");
      const flöden = [
        (await imp("/innehallspaket/exempel/flows/ap-exempel-rekrytering.json")).default,
        (await imp("/innehallspaket/exempel/flows/exempel-bestall-behorighet.json")).default,
      ];

      const struktur = (svg: string): string[] => {
        const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
        const ut: string[] = [];
        const gå = (e: Element) => {
          const attr = Array.from(e.attributes)
            .filter((a) => !a.name.startsWith("xmlns"))
            .map((a) => `${a.name}=${a.value}`)
            .sort();
          ut.push(`${e.localName}[${attr.join(" ")}]`);
          for (const b of Array.from(e.children)) gå(b);
        };
        gå(doc.documentElement);
        return ut;
      };
      const fel: string[] = [];
      const jämför = (namn: string, före: string, efter: string) => {
        const a = struktur(före);
        const b = struktur(efter);
        if (a.length !== b.length) fel.push(`${namn}: ${a.length} element blev ${b.length}`);
        else a.forEach((x, i) => x !== b[i] && fel.push(`${namn}: ${x} blev ${b[i]}`));
      };

      for (const flöde of flöden) {
        const bas: string = processSvg(flöde);
        const rot = new DOMParser().parseFromString(bas, "image/svg+xml").documentElement;
        const nod = rot.querySelector("[data-ark-nod]")?.getAttribute("data-ark-nod");
        const kant = rot.querySelector("[data-ark-kant]")?.getAttribute("data-ark-kant");
        const markeringar = ["farg", "blink", "puls"].flatMap((verktyg) => [
          { mål: { typ: "nod", id: nod }, verktyg, färg: "#c2255c" },
          { mål: { typ: "kant", id: kant }, verktyg, färg: "#1c7ed6" },
        ]);
        const ram = { ...nyRam("R"), markeringar, strålkastare: true };
        for (const [namn, svg] of [
          [`${flöde.id} bas`, bas],
          [`${flöde.id} ram`, läggPåRam(bas, ram).svg],
          [`${flöde.id} redigering`, läggPåRam(bas, ram, { redigerar: true }).svg],
        ] as const) {
          jämför(namn, svg, säkerSvg(svg));
        }
        if (flöde.id.startsWith("ap-")) {
          const modell = compileAp(flöde.draft);
          const avsk = renderAvskaladSvg(avskalaAp(modell), { handtag: true });
          jämför(`${flöde.id} avskalad`, avsk, säkerSvg(avsk));
          const hel = (s: string) => `<svg xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
          for (const n of modell.nodes) {
            const inre = apNodeSvg(n, 0, 0, 120, 60, 1);
            jämför(`${flöde.id} ${n.id}`, hel(inre), hel(säkerSvg(inre, { fragment: true })));
          }
        }
        if (!nod || !kant) fel.push(`${flöde.id}: inga märkta objekt/kopplingar`);
      }

      const ond =
        `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script>` +
        `<path d="M0,0" onload="alert(2)"/><foreignObject><div>x</div></foreignObject>` +
        `<a href="javascript:alert(4)"><text>k</text></a><style>*{}</style>` +
        `<animate attributeName="href" values="javascript:alert(6)"/></svg>`;
      const sanerad: string = säkerSvg(ond);
      if (/script|onload|foreignObject|javascript|<style|<a\b/i.test(sanerad)) fel.push(`farligt kvar: ${sanerad}`);
      if (!/<svg/.test(sanerad) || !/<path/.test(sanerad)) fel.push(`för mycket borta: ${sanerad}`);
      return fel;
    });
    expect(skillnader).toEqual([]);
  }, 60_000);
});
