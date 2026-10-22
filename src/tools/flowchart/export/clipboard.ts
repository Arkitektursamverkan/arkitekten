/**
 * Kopiera en figur till urklipp som PNG – för inklistring i Word.
 *
 * Varför PNG och inte SVG: Word kan visserligen läsa SVG-FILER, men urklipps-
 * formatet `image/svg+xml` känner det inte igen. Ett Ctrl+V med SVG i urklipp
 * ger antingen ingenting eller rå XML-text. PNG klistras in överallt.
 *
 * Bilden rastreras med en överupplösning (`PIXEL_RATIO`) så att den håller när
 * Word skalar ned den till spaltbredden och rapporten sedan skrivs ut.
 */

/** Rastrera i 3× logisk storlek – räcker för 300 dpi-utskrift av en 16 cm-figur. */
const PIXEL_RATIO = 3;

/** Gör en PNG-blob av en SVG-sträng med kända mått. */
export async function svgToPngBlob(svg: string, width: number, height: number): Promise<Blob> {
  const bild = new Image();
  bild.decoding = "sync";
  // encodeURIComponent i stället för btoa: btoa klarar inte å/ä/ö, och
  // bantitlarna är på svenska.
  bild.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await bild.decode();

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * PIXEL_RATIO));
  canvas.height = Math.max(1, Math.round(height * PIXEL_RATIO));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kunde inte skapa en 2d-kontext för rastreringen.");
  // Vit botten: utan den blir figuren genomskinlig, och en genomskinlig PNG
  // ser svart ut i vissa Word-teman.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bild, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Rastreringen gav ingen bild."))), "image/png");
  });
}

/** Lägger en SVG som PNG i urklipp. Kastar om webbläsaren nekar. */
export async function copySvgAsPng(svg: string, width: number, height: number): Promise<void> {
  const blob = await svgToPngBlob(svg, width, height);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
