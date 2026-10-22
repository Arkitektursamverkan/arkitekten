/**
 * En uppladdad bakgrundsbild → data-URL med mått.
 *
 * Bilden sparas INNE i ramserien (en fil är en serie, precis som ett flöde är
 * en fil), så den krymps först: en telefonbild på 5 MB blir en JPEG på några
 * hundra kB, vilket räcker gott för en bakgrund på 1600 punkter.
 */

const MAX_BREDD = 2400;
const BEHÅLL_UNDER = 900_000;

export interface LästBild {
  data: string;
  bredd: number;
  höjd: number;
}

export async function läsBild(fil: File): Promise<LästBild> {
  const url = await new Promise<string>((ok, fel) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    r.onerror = () => fel(r.error);
    r.readAsDataURL(fil);
  });
  const img = await new Promise<HTMLImageElement>((ok, fel) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => fel(new Error("Filen gick inte att läsa som bild."));
    i.src = url;
  });
  // En SVG utan egna mått rapporterar 0 – då gäller scenens format.
  const bredd = img.naturalWidth || 1600;
  const höjd = img.naturalHeight || 900;
  if (fil.size < BEHÅLL_UNDER && bredd <= MAX_BREDD) return { data: url, bredd, höjd };
  const k = Math.min(1, MAX_BREDD / bredd);
  const c = document.createElement("canvas");
  c.width = Math.round(bredd * k);
  c.height = Math.round(höjd * k);
  const ctx = c.getContext("2d");
  if (!ctx) return { data: url, bredd, höjd };
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { data: c.toDataURL("image/jpeg", 0.85), bredd: c.width, höjd: c.height };
}
