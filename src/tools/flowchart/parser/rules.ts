/**
 * Regelmotorns klassificeringsregler.
 *
 * All tolkning sker här via explicita, testbara regler – inte via AI. Det är
 * kärnan i "maximera regelstyrd transformation". Varje regel är en ren funktion
 * så att den kan enhetstestas isolerat och så att spårbarhets-inspektören kan
 * visa exakt VARFÖR ett fragment klassades som det gjorde.
 */

import type { GatewayKind, NodeType, Perspective } from "@/core/model";
import { portalbana } from "@/core/organisation";

/** Resultatet av att klassificera ett textfragment. */
export interface Classification {
  type: NodeType | "actor" | "ignore";
  /** Vilken swimlane fragmentet hör till (kan förfinas av kontext). */
  lane: string;
  /** Vilka regler som matchade – visas i spårbarhets-inspektören. */
  reasons: string[];
}

/**
 * Kanoniska swimlane-namn (KRAV 2). Portalbanan är installationens eget
 * namn på sitt portalsystem (core/organisation.ts) och läses vid varje
 * användning – därför en getter.
 */
export const LANE = {
  USER: "Användare",
  get PORTAL(): string {
    return portalbana();
  },
  SHAREPOINT: "SharePoint",
  POWER_AUTOMATE: "Power Automate",
  COMMS: "Kommunikationsmedel",
  INTEGRATIONS: "Integrationer",
};

/** Kända aktörer – lösa aktörsnamn blir swimlane-kontext, inte egna noder. */
const ACTORS = ["medarbetare", "användare", "handläggare", "kund", "anställd", "beställare"];

/**
 * Nyckelordsregler. Ordningen spelar roll: första matchande vinner för typ.
 * Varje regel har ett stabilt id som syns i spårbarheten.
 */
interface Rule {
  id: string;
  /** Testar (gemener, trimmad) fras. */
  test: (t: string) => boolean;
  type: NodeType;
  lane: string;
  /** Perspektiv noden hör till. */
  perspectives: Perspective[];
}

const RULES: Rule[] = [
  // Datalagring (Regel 4) – SP-listor och Service Request är egna datalager.
  {
    id: "datastore/sp-lista",
    test: (t) => /sp[- ]?list|sharepoint[- ]?list|service request|\bincident\b/.test(t),
    type: "datastore",
    lane: LANE.SHAREPOINT,
    perspectives: ["system"],
  },
  // Integrationer – Azure Function, API.
  {
    id: "integration/azure-api",
    test: (t) => /azure function|\bapi\b|\bapi:er\b|integration/.test(t),
    type: "integration",
    lane: LANE.INTEGRATIONS,
    perspectives: ["system"],
  },
  // Notifieringar (Regel 3) – mejl, e-post, Teams-chatt, notis. Egna objekt.
  {
    id: "notification/comms",
    test: (t) =>
      /\bmejl\b|\bmail\b|e-?post|epost|bekräftelse.*(skicka|via)|\bnotis\b|chattmeddelande|teamschatt|teams-?meddelande|chat(t)?meddelande|skickas till (använd|handlägg)/.test(
        t,
      ),
    type: "notification",
    lane: LANE.COMMS,
    perspectives: ["system"],
  },
  // System/plattform – Power Automate-flöden, portalen som system.
  {
    id: "system/power-automate",
    test: (t) => /power automate|\bflödet\b|triggas|triggar flöde/.test(t),
    type: "system",
    lane: LANE.POWER_AUTOMATE,
    perspectives: ["system"],
  },
  // Automatiska steg utförs av automatiseringen, inte av personen som råkade
  // nämnas före. "Handläggare utses automatiskt" är Power Automates arbete.
  {
    id: "system/automatiskt",
    test: (t) => /\bautomatiskt\b|per automatik|automatiseras/.test(t),
    type: "system",
    lane: LANE.POWER_AUTOMATE,
    perspectives: ["system"],
  },
  // Loggpost – datalagring i systemperspektiv.
  {
    id: "datastore/logg",
    test: (t) => /loggpost|logg(en)?\b|skriva till logg|händelse.*loggas/.test(t),
    type: "datastore",
    lane: LANE.SHAREPOINT,
    perspectives: ["system"],
  },
  // Kvittenssida – PORTALEN visar den. Användaren "kommer till" en sida, men
  // det är inget hen utför: systemet renderar kvittensen. Tidigare klassades
  // den som slut-event och degraderades till en User Task, vilket läste som
  // att användaren utförde ett arbetsmoment.
  {
    id: "system/kvittens",
    test: (t) => /tack för ditt ärende|sida med tack|kvittens/.test(t),
    type: "system",
    get lane() {
      return LANE.PORTAL;
    },
    perspectives: ["business", "system"],
  },
  // Portal-aktiviteter – "startar portalen", "väljer ... från startsidan", formulär.
  {
    id: "activity/portal",
    test: (t) => /portalen|startsida|formulär|fyller i|väljer (ny|skicka)|skicka in/.test(t),
    type: "activity",
    get lane() {
      return LANE.PORTAL;
    },
    perspectives: ["business", "system"],
  },
];

/**
 * Är frasen en MOTTAGNING i stället för ett utskick?
 *
 * BPMN skiljer på Send Task (någon skickar) och Receive Task (någon tar emot).
 * Skillnaden avgör vem steget hör till: ett utskick utförs av avsändaren, en
 * mottagning av mottagaren. Utan den åtskillnaden hamnade "Får via mejl
 * bekräftelse" hos portalen som råkade stå före, i stället för hos användaren
 * som faktiskt får mejlet.
 */
export function isReceivePhrase(raw: string): boolean {
  const t = raw.toLowerCase();
  return /\bfår\b|\btar emot\b|\bmottas\b|\bmottar\b|\berhåller\b|\binkommer till\b/.test(t);
}

/**
 * Vem tar emot meddelandet? Ett meddelandeflöde går alltid till en annan
 * DELTAGARE – aldrig till en kanal. "Mejl" och "Teams" är kanaler, inte
 * mottagare; det är användaren respektive handläggaren som tar emot.
 * null = ingen identifierbar mottagare (då ritas inget meddelandeflöde).
 */
export function messageRecipient(raw: string): string | null {
  const t = raw.toLowerCase();
  if (/handläggar/.test(t)) return "Handläggare";
  if (/\banv[äa]ndar/.test(t)) return "Användare";
  if (/kommunikat[öo]r|kommunikationsavdelning/.test(t)) return "Kommunikatörer";
  if (/\bit\b/.test(t)) return "IT";
  if (/\bkund\b/.test(t)) return "Kund";
  return null;
}

/** Startindikatorer (KRAV: startpunkt). */
export function isStartPhrase(t: string): boolean {
  return /uppkommer|uppstår|\bbehov\b|initieras|påbörjas/.test(t);
}

/**
 * Beslutsindikatorer (KRAV 3).
 *
 * Medvetet snäva: ett beslut känns igen på "om …", "annars", en likhet
 * ("= hög prioritet") eller ett avslutande frågetecken. Ett tidigare bart
 * `prioritet` gjorde varje aktivitet som NÄMNDE ordet till en gateway –
 * "Handläggaren sätter prioritet på ärendet" blev ett beslut med grenar.
 * Substantiv i en mening är aldrig ett tillräckligt beslutstecken.
 */
export function isDecisionPhrase(t: string): boolean {
  return /^\s*om\b|\bannars\b|\bif\b|\belse\b|=\s*hög prioritet|\butses\b.*eller|\?\s*$/.test(
    t.toLowerCase(),
  );
}

/**
 * BPMN-gateway-typ för en beslutsfras. Parallell (AND) när stegen sker
 * samtidigt; annars exklusiv (XOR – en väg väljs). Exklusiv är standard.
 */
export function gatewayKind(raw: string): GatewayKind {
  const t = raw.toLowerCase();
  if (/parallellt|samtidigt|\bbåde\b.*\boch\b|samtliga/.test(t)) return "parallel";
  return "exclusive";
}

/** Är fragmentet ett löst aktörsnamn (→ swimlane-kontext, ej egen nod)? */
export function isActorOnly(t: string): boolean {
  const w = t.toLowerCase().trim().replace(/[.:]$/, "");
  return ACTORS.includes(w);
}

/** Vilken swimlane hör en känd aktör till? */
export function actorLane(t: string): string {
  const w = t.toLowerCase().trim();
  if (/handlägg/.test(w)) return LANE.PORTAL; // handläggare agerar i portalen
  return LANE.USER;
}

/**
 * KRAV 3: normalisera en beslutsfras till en fråga.
 *   "Om kommunikationsinsats väljs"     -> "Kommunikationsinsats vald?"
 *   "Om en beställningsvara har valts"   -> "Beställningsvara vald?"
 *   "Om klassificering = Hög prioritet"  -> "Hög prioritet?"
 */
export function decisionLabel(raw: string): string {
  let t = raw.trim().replace(/^↓\s*/, "");
  // "X = Y" -> "Y?"
  const eq = t.match(/=\s*(.+)$/);
  if (eq) return capitalize(cleanTail(eq[1])) + "?";
  // "Om ... väljs / har valts / valts" -> "<subjekt> vald(t)?"
  let m = t.match(/^om\s+(?:en\s+|ett\s+|den\s+|det\s+)?(.+?)\s+(?:väljs|har valts|valts|väljes)\b/i);
  if (m) {
    const subj = cleanTail(m[1]);
    return capitalize(subj) + " vald?";
  }
  // "Om <villkor>" -> "<villkor>?"
  m = t.match(/^om\s+(.+)$/i);
  if (m) return capitalize(cleanTail(m[1])) + "?";
  // Fallback: säkerställ frågetecken.
  return capitalize(cleanTail(t)) + (t.endsWith("?") ? "" : "?");
}

/**
 * Huvudklassificering av ett (icke-besluts-)fragment.
 * Beslut och aktörer hanteras separat i parsern innan denna anropas.
 */
export function classify(raw: string, isFirst: boolean): Classification {
  const t = raw.toLowerCase();
  const reasons: string[] = [];

  if (isFirst && isStartPhrase(t)) {
    return { type: "start", lane: LANE.USER, reasons: ["start/first+indikator"] };
  }

  for (const r of RULES) {
    if (r.test(t)) {
      reasons.push(`regel:${r.id}`);
      return { type: r.type, lane: r.lane, reasons };
    }
  }

  // Standard: aktivitet. Swimlane gissas från verb/kontext, förfinas av parsern.
  return { type: "activity", lane: LANE.USER, reasons: ["default:activity"] };
}

/** Städa svansen på en fras: ta bort avslutande skräp, korta ned. */
export function cleanTail(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/["'"]/g, "")
    .replace(/\s*[.,:;]+\s*$/, "")
    .trim();
}

function capitalize(s: string): string {
  const t = s.trim();
  return t.length ? t[0].toUpperCase() + t.slice(1) : t;
}

/**
 * Gör en kort, boxvänlig etikett av en lång fras.
 * "Väljer ny felanmälan från startsidan" -> "Väljer ny felanmälan"
 * Behåller hela frasen om den redan är kort.
 */
export function shortLabel(raw: string): string {
  const t = cleanTail(raw.replace(/^↓\s*/, ""));
  if (t.length <= 40) return capitalize(t);
  // Klipp vid ett tidigt bindeord om ett finns (ger en naturlig fras).
  const cut = t.match(/^(.{16,40}?)\s+(?:från|för|på|med|utifrån|som|i|om|till|av)\b/i);
  if (cut) return capitalize(cut[1].trim());
  // Annars: behåll hela ord upp till ~40 tecken och lägg till ellips.
  const words = t.split(/\s+/);
  let out = "";
  for (const w of words) {
    if ((out + " " + w).trim().length > 40) break;
    out = (out + " " + w).trim();
  }
  return capitalize(out || words[0]) + " …";
}
