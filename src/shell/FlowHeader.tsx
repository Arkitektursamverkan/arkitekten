/**
 * Rubriken över ritytan: VILKET diagram som redigeras just nu.
 *
 * Namnet fanns bara i ett litet textfält långt ner i panelen, och biblioteket
 * kan innehålla många processer med snarlika namn ("kommentera ärendet …").
 * Man kunde alltså sitta och redigera utan att se vilken av dem det var.
 * Rubriken står därför överst i ritytan – samma ställe man tittar när man
 * ritar – och säger också om det finns osparade ändringar.
 *
 * Komponenten äger inget tillstånd; verktyget skickar in det. Både
 * Flödesschema och Affärsprocess använder den, så att svaret på "var är jag?" ser
 * likadant ut i hela appen.
 */

import type { ReactNode } from "react";
import { statusDef, type FlowStatus } from "@/core/status";
import { KopieraLänk } from "./KopieraLank";

export interface FlowHeaderProps {
  /** Verktygets namn, t.ex. "Flödesschema" – ger diagrammet sitt sammanhang. */
  verktyg: string;
  /** Flödets namn. */
  namn: string;
  /** true = ändrat sedan senaste sparningen. */
  osparat: boolean;
  /** Sparat flöde: false innan det finns en post i biblioteket. */
  sparat: boolean;
  /**
   * Processens id, när den är sparad – ger knappen "Kopiera länk". Rubriken
   * äger knappen så att den står på samma ställe i båda verktygen.
   */
  flödeId?: string | null;
  /** Senaste versionens beteckning ("2.1") och tidpunkt, när flödet är sparat. */
  version?: string;
  sparadTid?: string;
  /**
   * Statusen flödet står på. Rubriken är det första man tittar på, så frågan
   * "är det här ett arbetsmaterial eller det som gäller?" ska besvaras HÄR och
   * inte längst ner i panelen.
   */
  status?: FlowStatus;
  /** Beteckningen på senaste fastslagna versionen, när flödet inte är den. */
  fastslagenVersion?: string;
  /**
   * Ytan processen ligger i ("Gemensam katalog", "Mina processer" …) – vem som
   * ser och ändrar den. Saknas = osparad, eller öppen drift utan ytor.
   */
  yta?: { id: string; titel: string; beskrivning: string };
  /** Antal steg i mellanlagret – en snabb storlekskänsla. */
  steg: number;
  /**
   * Knappar längst till höger: spara och versioner.
   *
   * Sparningen låg tidigare mitt i den långa panelen, under beskrivningen och
   * ovanför sidformatet. Den hör ihop med FRÅGAN rubriken svarar på – vilket
   * diagram är det här, och finns det osparat i det – och ska därför stå på
   * samma rad som svaret.
   */
  åtgärder?: ReactNode;
}

export function FlowHeader({
  verktyg,
  namn,
  osparat,
  sparat,
  flödeId,
  version,
  sparadTid,
  status,
  fastslagenVersion,
  steg,
  åtgärder,
  yta,
}: FlowHeaderProps) {
  const def = status ? statusDef(status) : null;
  return (
    <header className="ark-flow-header">
      {yta && (
        <span className={`ark-flow-header-yta ark-kort-yta--${yta.id}`} title={yta.beskrivning}>
          {yta.titel}
        </span>
      )}
      <span className="ark-flow-header-verktyg">{verktyg}</span>
      <span className="ark-flow-header-pil">›</span>
      <span className="ark-flow-header-namn" title={namn}>
        {namn || "Namnlöst flöde"}
      </span>
      <span className="ark-flow-header-steg">{steg} steg</span>
      {sparat && def && (
        <span
          className={`ark-status-pill ${def.id}`}
          title={
            def.huvudversion
              ? `${def.beskrivning} Det här är den version som gäller.`
              : fastslagenVersion
                ? `${def.beskrivning} Senast fastslagen: ${fastslagenVersion}.`
                : `${def.beskrivning} Inget är fastslaget i det här flödet än.`
          }
        >
          {def.etikett} {version}
          {!def.huvudversion && fastslagenVersion && ` · fastslagen ${fastslagenVersion}`}
        </span>
      )}
      <span
        className={`ark-flow-header-status ${osparat ? "osparat" : sparat ? "sparat" : "nytt"}`}
        title={
          osparat
            ? "Ändringar som inte finns i biblioteket. Spara i panelen till vänster."
            : sparat
              ? "Allt är sparat i biblioteket."
              : "Flödet finns inte i biblioteket än."
        }
      >
        {/* Versionen står i statusmärket intill – här bara om och när. */}
        {osparat
          ? "● Osparade ändringar"
          : sparat
            ? `Sparat${sparadTid ? ` · ${formatDate(sparadTid)}` : ""}`
            : "Inte sparat än"}
      </span>
      {(åtgärder || flödeId) && (
        <div className="ark-flow-header-atgarder">
          <KopieraLänk flowId={flödeId ?? null} />
          {åtgärder}
        </div>
      )}
    </header>
  );
}

/** Kort, läsbar tidsstämpel: "idag 14:32" eller "2026-07-18 14:32". */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "okänt";
  const tid = d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString()
    ? `idag ${tid}`
    : `${d.toLocaleDateString("sv-SE")} ${tid}`;
}
