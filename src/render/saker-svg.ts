/**
 * SANERINGEN av SVG som läggs i sidan med `dangerouslySetInnerHTML` – EN plats.
 *
 * Bilderna byggs som strängar av exportörerna (svg-affarsprocess.ts,
 * export/svg.ts, ramarna), och allt i dem som kommer ur data escapas där. Men
 * en enda glömd interpolation räcker för lagrad XSS hos alla som öppnar
 * processen (HUKI-bokstaven i markörens id var en sådan). Därför passerar
 * varje data-härledd SVG också DOMPurify innan den når DOM:en: skript,
 * `<style>`, `<foreignObject>`, länkar och händelseattribut tas bort, vad
 * exportören än råkat skriva.
 *
 * Ramarnas animationer är SMIL. `<animate>` står inte i DOMPurifys
 * standardlista (det kan animera `href`), så det släpps in här – men en
 * animation som riktar sig mot ett href-attribut tas bort.
 */

import DOMPurify from "dompurify";

const SVG_NS = "http://www.w3.org/2000/svg";

const VAL = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ["animate"],
  ADD_ATTR: [
    "attributeName",
    "values",
    "keyTimes",
    "dur",
    "begin",
    "repeatCount",
    "from",
    "to",
    "path",
    "dominant-baseline",
  ],
  FORBID_TAGS: ["style", "script", "foreignObject", "a", "set"],
  FORBID_ATTR: ["href", "xlink:href"],
};

let krokSatt = false;
function sättKrok(): void {
  if (krokSatt) return;
  krokSatt = true;
  DOMPurify.addHook("uponSanitizeElement", (nod, data) => {
    const tagg = data.tagName?.toLowerCase();
    if (tagg !== "animate" && tagg !== "animatemotion" && tagg !== "animatetransform") return;
    const el = nod as Element;
    const mål = el.getAttribute?.("attributeName") ?? "";
    if (/href/i.test(mål)) el.parentNode?.removeChild(el);
  });
}

/**
 * Sanerar SVG för `dangerouslySetInnerHTML`.
 *
 * `fragment: true` för INNEHÅLLET i en `<svg>` (ApCanvas ritar varje objekt i
 * en egen `<svg>` och lägger bara inre markup): det läses då inuti en
 * svg-rot, så att elementen hamnar i SVG-namnrymden och inte tolkas som HTML.
 */
export function säkerSvg(svg: string, opts: { fragment?: boolean } = {}): string {
  if (!svg) return "";
  sättKrok();
  if (!opts.fragment) return DOMPurify.sanitize(svg, VAL) as unknown as string;
  const rot = DOMPurify.sanitize(`<svg xmlns="${SVG_NS}">${svg}</svg>`, {
    ...VAL,
    RETURN_DOM_FRAGMENT: true,
  }) as unknown as DocumentFragment;
  // Omslaget är det enda elementet i fragmentet; dess innehåll är det sanerade.
  // (En miljö som tappat omslaget – happy-dom i testerna – ger barnen direkt.)
  const svgEl = rot.firstElementChild;
  if (svgEl && rot.childNodes.length === 1 && svgEl.localName === "svg") return svgEl.innerHTML;
  const behållare = document.createElement("div");
  behållare.appendChild(rot);
  return behållare.innerHTML;
}
