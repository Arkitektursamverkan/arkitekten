/**
 * Revisionsrutan i exporten – "vem, när, vilken version".
 *
 * En figur som klistras in i ett dokument lever vidare där: den läses av
 * någon annan, långt senare, utan appen bredvid. Teckenförklaringen säger vad
 * symbolerna betyder; den här rutan säger vad man tittar PÅ – vilken version,
 * när den justerades och av vem. Utan den går det inte att avgöra om bilden i
 * rapporten är den aktuella.
 *
 * Ritas av BÅDA exporterna (flödesschemat och affärsprocessen) ur samma funktion, så en
 * ändring av utseendet aldrig kan gälla bara den ena.
 */

import { esc } from "../render/text-util";
import {
  senasteFastslagna,
  statusDef,
  statusEtikett,
  versionsBeteckning,
  type FlowStatus,
  type HarStatus,
} from "@/core/status";

export interface Revision {
  /** Namnet den som sparade angav. Tomt = raden utelämnas. */
  ändradAv?: string;
  /** ISO-tidpunkt för sparningen. */
  datum?: string;
  /** Versionens beteckning i flödets historik, t.ex. "2.1". */
  version?: string;
  /**
   * Versionens status. Fastslagen = det som gäller; utkast = arbetsmaterial.
   * Rutan säger det RAKT UT, för en figur i ett styrdokument måste kunna
   * skiljas från ett arbetsmaterial utan appen bredvid.
   */
  status?: FlowStatus;
  /**
   * Senaste fastslagna huvudversionen, när bilden INTE är den. Utan raden ser
   * ett utkast ut som om ingenting vore fastslaget, och läsaren har ingen
   * chans att hitta den version som faktiskt gäller.
   */
  senastFastslagen?: { version?: string; datum?: string };
  /**
   * true när diagrammet ändrats efter den sparade versionen. Utan markeringen
   * påstår rutan en version som bilden inte längre är – och det är precis den
   * frågan rutan finns för att svara på.
   */
  osparat?: boolean;
}

/** Det `revisionAvVersion` behöver av ett flöde – inget mer. */
export interface FlödeMedHistorik {
  savedAt?: string;
  versions?: ReadonlyArray<HarStatus & { savedAt?: string; savedBy?: string }>;
}

/**
 * Bygger revisionen för EN version i ett sparat flöde.
 *
 * Både Flödesschema och Affärsprocess stämplar sina exporter härifrån. Regeln låg
 * tidigare kopierad i båda verktygen, och det är precis sådan duplicering som
 * gör att två diagram i samma rapport påstår olika saker.
 *
 * `index` = -1 betyder "senaste versionen".
 */
export function revisionAvVersion(
  flöde: FlödeMedHistorik | null | undefined,
  index: number,
  osparat: boolean,
): Revision | undefined {
  const versioner = flöde?.versions ?? [];
  if (versioner.length === 0) {
    // Ett flöde utan historik (sparat före versionerna fanns) har bara ett datum.
    return flöde?.savedAt ? { datum: flöde.savedAt, osparat } : undefined;
  }
  const i = index < 0 ? versioner.length - 1 : Math.min(index, versioner.length - 1);
  const v = versioner[i];
  const fast = senasteFastslagna(versioner);
  const ärFastslagen = statusDef(v.status).huvudversion;
  return {
    version: versionsBeteckning(versioner, i),
    datum: v.savedAt,
    ändradAv: v.savedBy,
    status: statusDef(v.status).id,
    // Bara när bilden inte SJÄLV är den fastslagna – annars vore raden en
    // upprepning av den första.
    senastFastslagen:
      !ärFastslagen && fast
        ? { version: fast.beteckning, datum: fast.version.savedAt }
        : undefined,
    osparat,
  };
}

const FONT = "Segoe UI, Arial, sans-serif";
const RAD_H = 12;
const PAD_X = 8;
const PAD_Y = 7;
/** Ungefärlig teckenbredd vid 9 px – samma metrik som teckenförklaringen. */
const TECKEN_PX = 4.9;

/**
 * Raderna rutan visar, i ordning. Tomma fält hoppas över.
 *
 * Statusen står FÖRST i toppraden i stället för ordet "Version": det första en
 * läsare behöver veta om en bild i ett dokument är om den gäller eller inte.
 * "Fastslagen 2.0 · 2026-07-12" säger båda sakerna på en rad.
 */
function rader(rev: Revision): string[] {
  const ut: string[] = [];
  const version = rev.version?.trim().replace(/^v/i, "");
  const datum = datumText(rev.datum);
  // Saknas statusen helt (ett flöde utan historik) står det "Version" som förr –
  // rutan ska aldrig påstå en status som inte är satt.
  const rubrik = rev.status ? statusEtikett(rev.status) : version ? "Version" : "";
  const första = [version ? `${rubrik} ${version}`.trim() : rubrik, datum]
    .filter(Boolean)
    .join(" · ");
  if (första) ut.push(rev.osparat ? `${första} · ändrad sedan dess` : första);
  const fast = rev.senastFastslagen;
  if (fast?.version) {
    const när = datumText(fast.datum);
    ut.push(`Senast fastslagen: ${fast.version}${när ? ` (${när})` : ""}`);
  }
  if (rev.ändradAv?.trim()) ut.push(`Justerad av ${rev.ändradAv.trim()}`);
  return ut;
}

/** ISO → ÅÅÅÅ-MM-DD. Ogiltigt datum ger tom sträng i stället för "Invalid Date". */
function datumText(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** Rutans mått – exporten reserverar plats innan den ritar. */
export function revisionsMått(rev: Revision | undefined): { w: number; h: number } {
  const r = rev ? rader(rev) : [];
  if (!r.length) return { w: 0, h: 0 };
  const bredast = Math.max(...r.map((t) => t.length));
  return {
    w: Math.ceil(bredast * TECKEN_PX + PAD_X * 2),
    h: r.length * RAD_H + PAD_Y * 2,
  };
}

/**
 * Ritar rutan med sitt ÖVRE VÄNSTRA hörn i (x, y). Tom sträng när det inte
 * finns något att visa – ett flöde som aldrig sparats har ingen revision, och
 * då ska exporten se ut precis som förut.
 */
export function revisionsRuta(x: number, y: number, rev: Revision | undefined): string {
  const r = rev ? rader(rev) : [];
  if (!r.length) return "";
  const { w, h } = revisionsMått(rev);
  const delar = [
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="${h}" rx="4" fill="#ffffff" stroke="#d7dce4" stroke-width="1"/>`,
  ];
  r.forEach((text, i) => {
    delar.push(
      `<text x="${(x + PAD_X).toFixed(1)}" y="${(y + PAD_Y + RAD_H * (i + 1) - 3).toFixed(1)}" font-family="${FONT}" font-size="9" fill="#6b7280">${esc(text)}</text>`,
    );
  });
  return delar.join("\n");
}
