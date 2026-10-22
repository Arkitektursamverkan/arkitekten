/**
 * Migrering av sparade flöden till den BPMN-korrekta strukturen.
 *
 * Varför inte bara tolka om råtexten: sparade flöden innehåller handarbete –
 * manuella positioner, valda kopplingspunkter, omskrivna etiketter, ändrade
 * typer. En omtolkning kastar bort allt det. Migreringen rättar därför bara de
 * strukturella felen och lämnar resten orört.
 *
 * Den är medvetet konservativ: den flyttar ett beslut bara när både steget före
 * och grenstegen säger emot beslutets bana. En gissning som flyttar rätt objekt
 * till fel plats är värre än att låta det ligga.
 */

import { normalizeOrder, syncStepTypes, type DraftStep, type ProcessDraft } from "./draft";

export interface MigrationResult {
  draft: ProcessDraft;
  /** Vad som ändrades, i klartext – visas för användaren innan det sparas. */
  changes: string[];
}

/** Kanalbanor som inte är aktörer och därför inte duger som swimlane. */
const KANALBANOR = ["Kommunikationsmedel", "Mejl", "E-post", "Kommunikation"];

/**
 * Härleder mottagare ur textfrasen. Samma regel som parsern använder, men
 * duplicerad här för att `core` inte ska bero på `tools/flowchart/parser`.
 */
function mottagareUrText(raw: string): string | undefined {
  const t = raw.toLowerCase();
  if (/handläggar/.test(t)) return "Handläggare";
  if (/\banv[äa]ndar/.test(t)) return "Användare";
  if (/kommunikat[öo]r|kommunikationsavdelning/.test(t)) return "Kommunikatörer";
  if (/\bit\b/.test(t)) return "IT";
  if (/\bkund\b/.test(t)) return "Kund";
  return undefined;
}

/** Vanligast förekommande värde, eller undefined vid oavgjort/tomt. */
function vanligast(v: string[]): string | undefined {
  if (v.length === 0) return undefined;
  const antal = new Map<string, number>();
  for (const x of v) antal.set(x, (antal.get(x) ?? 0) + 1);
  const sorterad = [...antal.entries()].sort((a, b) => b[1] - a[1]);
  if (sorterad.length > 1 && sorterad[0][1] === sorterad[1][1]) return undefined;
  return sorterad[0][0];
}

export function migrateDraft(input: ProcessDraft): MigrationResult {
  const changes: string[] = [];
  const ordnad = normalizeOrder(input);
  let steps: DraftStep[] = [...ordnad.steps];
  const bytteBana = new Set<string>();

  /**
   * Utföraren = närmaste föregående steg som faktiskt UTFÖR något. Kanalbanor
   * hoppas över (en kanal är ingen aktör) och datalager likaså – en
   * SharePoint-lista skickar inga mejl. Utan det hamnade bekräftelsemejlen i
   * SharePoint, bara för att loggposten råkade stå närmast före dem.
   */
  const utförareFöre = (i: number): string | undefined => {
    for (let j = i - 1; j >= 0; j--) {
      const k = steps[j];
      if (k.type === "datastore" || KANALBANOR.includes(k.laneId)) continue;
      return k.laneId;
    }
    return undefined;
  };

  // ---- 1. Beslut i fel bana. Måste göras FÖRE notifieringarna: de ärver sin
  // bana från steget före, och ett felplacerat beslut smittar hela grenen.
  steps = steps.map((s, i) => {
    if (s.type !== "decision") return s;
    const föregående = utförareFöre(i);
    // Grensteg som ligger i en kanalbana ska ändå flyttas – de säger inget om
    // var beslutet hör hemma.
    const grenBanor = steps
      .filter((x) => x.branchOf?.stepId === s.id && !KANALBANOR.includes(x.laneId))
      .map((x) => x.laneId);
    const grenBana = vanligast(grenBanor);
    const enigt = grenBanor.length === 0 || grenBana === föregående;
    if (!föregående || !enigt || föregående === s.laneId) return s;
    bytteBana.add(s.id);
    changes.push(`Gateway "${s.text}" flyttad från ${s.laneId} till ${föregående}`);
    return { ...s, laneId: föregående };
  });

  // ---- 2. Notifieringar ut ur kanalbanor, till utföraren.
  steps = steps.map((s, i) => {
    if (s.type !== "notification" || !KANALBANOR.includes(s.laneId)) return s;
    const utförare = utförareFöre(i);
    if (!utförare || utförare === s.laneId) return s;
    bytteBana.add(s.id);
    changes.push(`"${s.text}" flyttad från ${s.laneId} till ${utförare}`);
    return { ...s, laneId: utförare };
  });

  // ---- 3. Mottagare på notifieringar → ger meddelandeflöde ut ur poolen.
  steps = steps.map((s) => {
    if (s.type !== "notification" || s.recipient) return s;
    const mottagare = mottagareUrText(s.sourceText ?? s.text);
    if (!mottagare) return s;
    changes.push(`"${s.text}" fick mottagare ${mottagare}`);
    return { ...s, recipient: mottagare };
  });

  // ---- 4. Manuella positioner.
  //
  // Har någon bana ändrats har hela layoutens referensram ändrats: banorna
  // ligger på nya y-lägen och diagrammet får en annan bredd. Gamla positioner
  // pekar då på lägen som inte finns – objekt hamnar utanför sidan eller ovanpå
  // varandra. Då är auto-layout ärligare än bevarat halvarbete. Den gamla
  // versionen finns kvar i historiken om positionerna behövs.
  if (bytteBana.size > 0) {
    const medPosition = steps.filter((s) => s.position).length;
    if (medPosition > 0) {
      changes.push(
        `${medPosition} manuella positioner rensade – banbytet flyttar hela referensramen`,
      );
      steps = steps.map((s) => (s.position ? { ...s, position: null } : s));
    }
  }

  // ---- 5. Tomma kanalbanor bort ur banlistan.
  const användaBanor = new Set(steps.map((s) => s.laneId));
  const lanes = (input.lanes ?? []).filter((l) => {
    if (användaBanor.has(l.id)) return true;
    if (KANALBANOR.includes(l.id)) {
      changes.push(`Tom kanalbana "${l.id}" borttagen`);
      return false;
    }
    return true;
  });

  // ---- 6. Stegens typer ska stämma med vad diagrammet ritar.
  const migrerad = syncStepTypes({ ...ordnad, steps, lanes });
  if (migrerad.steps.some((s, i) => s.type !== steps[i].type)) {
    changes.push("Stegtyper synkade mot diagrammet");
  }

  return { draft: migrerad, changes };
}
