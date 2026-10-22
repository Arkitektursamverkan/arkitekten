/**
 * Delade texthjälpare för SVG-generering. Brutna ur export/svg.ts när
 * affärsprocessens former (former.ts) behövde exakt samma radbrytning och escapning –
 * en regel, en plats: bryter texten olika i två moduler ser samma etikett
 * olika ut i flödesschemat och i affärsprocessvyn.
 */

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Delar en etikett i rader för läsbarhet i boxen.
 *
 * `brytVidBindestreck` låter brytningen ske EFTER ett bindestreck inuti ett
 * ord ("Kund-medarbetare" → "Kund-" / "medarbetare"). Utan det blev vårt
 * rollnamn en enda 16 teckens rad som tvingade hela symbolen bredare än den
 * behövde vara. Flödesschemat skickar inte flaggan – dess
 * fasta rutor har en annan brytregel som husstilstesterna låser.
 */
export function wrap(label: string, max = 18, maxRader = 3, brytVidBindestreck = false): string[] {
  const words = brytVidBindestreck
    ? label.split(/\s+/).flatMap((o) => o.split(/(?<=-)(?=.)/))
    : label.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    // Efter ett bindestreck fogas nästa bit ihop utan mellanslag – annars blev
    // "Kund- medarbetare" av ett namn som hör ihop.
    const fog = cur && !(brytVidBindestreck && cur.endsWith("-")) ? " " : "";
    if ((cur + fog + w).length > max && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur + fog + w;
    }
  }
  if (cur) lines.push(cur);
  // Taket finns för flödesschemats FASTA nodrutor: mer text än så får ändå
  // inte plats. Affärsprocessens former växer med sin etikett och skickar därför ett
  // högre tak – annars försvann sista ordet tyst ("Forum (aktivtet alltid ett
  // möte)" ritades som "…alltid ett").
  return lines.slice(0, maxRader);
}
