/**
 * PUBLICERINGEN – var i EA-portalen en process visas, och med vilka uppgifter.
 *
 * Två mål, samma post: en AFFÄRSPROCESS publiceras på en process i
 * portalens processkarta, en SYSTEMPROCESS (flödesschemat) på en applikation,
 * där den visas under fliken Systemprocesser. Portalen skiljer dem åt på
 * flödets familj; `eaNodId` pekar ut noden i båda fallen.
 *
 * Portalen har ingen egen processmodell: en process där är en nod i ett träd
 * som portalens synk bygger och SKRIVER ÖVER vid varje körning. Allt vi skrev på en
 * sådan nod vore alltså borta inom två timmar. Publiceringen bor därför HÄR, på
 * flödet, och följer med ut genom flödestjänsten och integrationsplattformen
 * (`server/flodestjanst.mts` → plattformens arkitekten-connector → portalens
 * `arkflows`). Portalen kopplar flödet till noden på `eaNodId`; numret i
 * namnet ("4.4.3 …") är bara reserv för flöden som speglades före publiceringen.
 *
 * Publiceringen är, liksom placeringen i katalogen, en uppgift OM processen –
 * inte en del av dess innehåll. Den skrivs därför av `sättPublicering` i
 * flow-store, som SPRIDER posten och inte lägger någon version till
 * historiken (invariant 11, undantaget för placering och publicering).
 *
 * VILKEN version som visas är inte en uppgift här: portalen visar alltid
 * senaste FASTSLAGNA versionen (`?version=fastslagen` i flödestjänsten), så en
 * publicering som sparade sin egen beteckning hade kunnat säga emot historiken
 * (invariant 9).
 */

export interface Publicering {
  /** EA-portalens nod-id (UUID) – det portalen kopplar flödet till. */
  eaNodId: string;
  /** Nodens namn som det stod vid publiceringen. Bara för visning. */
  eaNodNamn: string;
  /** Nodens processnummer ("4.4.3"), om den har något. */
  eaPrefix?: string;
  /**
   * true = noden SKAPADES av publiceringen (fanns inte i den synkade
   * processkartan). Bara då är den vår att uppdatera; en synkad nod skrivs
   * över av synken och rörs aldrig.
   */
  egenNod?: boolean;
  /** Processägaren – obligatorisk. */
  ägare: string;
  /** Vad processen gör och varför – obligatorisk. */
  beskrivning: string;
  /** ISO-tidpunkt för senaste publiceringen. */
  publiceradAt: string;
  /** Vem som publicerade (samma signatur som på versionerna). */
  publiceradAv?: string;
}

/** Det användaren fyller i rutan – innan noden finns. */
export interface PubliceringsUtkast {
  läge: "befintlig" | "ny";
  /** Vald nod (läge "befintlig") eller vald FÖRÄLDER (läge "ny"). */
  nodId: string | null;
  /** Den nya processens namn, utan nummer (läge "ny"). */
  nyttNamn: string;
  /** Den nya processens nummer (läge "ny"). Frivilligt men förvalt. */
  nyttPrefix: string;
  ägare: string;
  beskrivning: string;
}

/**
 * Vad som saknas innan man får publicera. Tom lista = klart.
 *
 * Processägare och beskrivning är obligatoriska (beslut 2026-10-08) – portalen
 * själv kräver bara ett namn, men en process utan ägare i en processkarta är
 * ingen process man kan fråga någon om.
 */
export function saknasFörPublicering(u: PubliceringsUtkast): string[] {
  const fel: string[] = [];
  if (!u.nodId)
    fel.push(u.läge === "ny" ? "Välj var i strukturen den nya processen ska ligga." : "Välj en process i strukturen.");
  if (u.läge === "ny" && !u.nyttNamn.trim()) fel.push("Ange den nya processens namn.");
  if (u.läge === "ny" && u.nyttPrefix.trim() && !PREFIX.test(u.nyttPrefix.trim()))
    fel.push("Numret ska ha formen 4.4.5.");
  if (!u.ägare.trim()) fel.push("Ange processägare.");
  if (!u.beskrivning.trim()) fel.push("Ange en beskrivning av processen.");
  return fel;
}

/** Processnumrering: siffror åtskilda av punkter. */
export const PREFIX = /^\d+(?:\.\d+)*$/;

/** "1.2.3 Beställ behörighet" → { prefix: "1.2.3", namn: "Beställ behörighet" }. */
export function delaNamn(namn: string): { prefix?: string; namn: string } {
  const m = /^(\d+(?:\.\d+)*)\s+(.*)$/.exec(namn.trim());
  return m ? { prefix: m[1], namn: m[2].trim() } : { namn: namn.trim() };
}

/** En process i EA-portalens träd, i den form rutan behöver. */
export interface EaProcess {
  id: string;
  namn: string;
  /** Processnumreringen ("4.4.3"), om noden har någon. */
  prefix?: string;
  /** Förälderns nod-id. Saknas = rot. */
  förälderId?: string;
  /** Rubrik/kapitel snarare än en arbetsprocess. */
  struktur: boolean;
  /** Nodens källa i portalen ("NONE" = skapad i portalen) – en synkad nod skrivs över av portalens synk. */
  källa: string;
}

/** En applikation i EA-portalen – målet när en Systemprocess publiceras. */
export interface EaApplikation {
  id: string;
  namn: string;
  /** Livscykelstatus som portalen visar ("I drift", "Avvecklat" …), om någon. */
  status?: string;
}

/** Det användaren fyller i när en Systemprocess publiceras. */
export interface ApplikationsUtkast {
  /** Vald applikation. */
  nodId: string | null;
  ägare: string;
  beskrivning: string;
}

/**
 * Vad som saknas innan en Systemprocess får publiceras. Samma krav som för en
 * affärsprocess: utan ägare finns ingen att fråga om flödet.
 */
export function saknasFörApplikation(u: ApplikationsUtkast): string[] {
  const fel: string[] = [];
  if (!u.nodId) fel.push("Välj vilken applikation systemprocessen hör till.");
  if (!u.ägare.trim()) fel.push("Ange ägare.");
  if (!u.beskrivning.trim()) fel.push("Ange en beskrivning av systemprocessen.");
  return fel;
}

/**
 * Applikationerna sorterade och filtrerade på söktexten. Avvecklade hamnar
 * sist – de går att välja, men är sällan det man letar efter.
 */
export function sökApplikationer(appar: EaApplikation[], sök: string): EaApplikation[] {
  const q = sök.trim().toLowerCase();
  const avvecklad = (a: EaApplikation) => (a.status?.toLowerCase() === "avvecklat" ? 1 : 0);
  return appar
    .filter((a) => !q || a.namn.toLowerCase().includes(q))
    .sort((a, b) => avvecklad(a) - avvecklad(b) || a.namn.localeCompare(b.namn, "sv"));
}
