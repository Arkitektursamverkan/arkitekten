/**
 * Validering – Regel 2: "Inga aktiviteter får tappas bort."
 *
 * Ger 100% spårbarhet mellan text och diagram genom att jämföra antalet
 * meningsbärande fragment i källtexten med antalet noder i modellen, och
 * genom att lista exakt vad varje fragment blev.
 */

import type { NodeType, ProcessModel } from "@/core/model";
import { messageRecipient } from "./rules";

export interface TraceRow {
  index: number;
  fragment: string;
  /** Vad fragmentet blev: en nodtyp, "aktör" eller "obehandlat". */
  outcome: string;
  nodeId?: string;
  nodeLabel?: string;
}

/** En BPMN-well-formedness-avvikelse. */
export interface BpmnIssue {
  level: "error" | "warn";
  message: string;
}

/** En post i flödets följd (topologisk ordning). */
export interface FlowStep {
  id: string;
  label: string;
  type: NodeType;
  /** true om ordningen inte kunde bestämmas entydigt (cykel). */
  ambiguous?: boolean;
}

export interface ValidationReport {
  ok: boolean;
  fragmentCount: number;
  nodeCount: number;
  /** Fragment som varken blev nod eller tolkades som aktör. */
  unaccounted: string[];
  rows: TraceRow[];
  warnings: string[];
  /** BPMN 2.0-kontroller (start/slut, nåbarhet, hängande noder, gateways). */
  bpmn: BpmnIssue[];
  /** Noderna i flödesordning (för att kontrollera följden). */
  flow: FlowStep[];
}


/** Bygger en spårbarhetsrapport för en modell. */
export function validateModel(model: ProcessModel): ValidationReport {
  const rows: TraceRow[] = [];
  const unaccounted: string[] = [];

  // Indexera på källtext för matchning. Artefakter (datalager) bär samma
  // spårbarhetskontrakt som noderna – de kommer också ur texten och måste
  // kunna bevisas mot den, annars påstår rapporten att aktiviteter tappats.
  const byText = new Map<string, { id: string; label: string; type: string }>();
  for (const n of model.nodes) {
    if (n.sourceText) byText.set(n.sourceText, { id: n.id, label: n.label, type: n.type });
  }
  for (const ds of model.dataStores) {
    if (ds.sourceText) {
      byText.set(ds.sourceText, { id: ds.id, label: ds.label, type: "datalager (artefakt)" });
    }
  }

  model.meta.sourceFragments.forEach((frag, i) => {
    const hit = byText.get(frag);
    if (hit) {
      rows.push({
        index: i,
        fragment: frag,
        outcome: hit.type,
        nodeId: hit.id,
        nodeLabel: hit.label,
      });
    } else if (isActorFragment(frag)) {
      rows.push({ index: i, fragment: frag, outcome: "aktör → swimlane" });
    } else {
      rows.push({ index: i, fragment: frag, outcome: "obehandlat" });
      unaccounted.push(frag);
    }
  });

  return {
    ok: unaccounted.length === 0,
    fragmentCount: model.meta.sourceFragments.length,
    // Räkna bara textburna objekt (auto-event har sourceIndex −1). Artefakter
    // räknas med – de motsvarar också fragment i källtexten.
    nodeCount:
      model.nodes.filter((n) => n.sourceIndex >= 0).length +
      model.dataStores.filter((d) => d.sourceIndex >= 0).length,
    unaccounted,
    rows,
    warnings: model.meta.warnings,
    bpmn: checkBpmn(model),
    flow: flowOrder(model),
  };
}

/**
 * Noderna i flödesordning via topologisk sortering (Kahn), med läsordning
 * (sourceIndex) som tie-break. Låter användaren kontrollera följden och se att
 * slut-eventet hamnar sist.
 */
export function flowOrder(model: ProcessModel): FlowStep[] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of model.nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of model.edges) {
    if (!indeg.has(e.target) || !adj.has(e.source)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const srcIdx = (id: string) => byId.get(id)?.sourceIndex ?? 0;
  // Kö sorterad på läsordning för stabil, läsbar följd.
  const ready = model.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const out: FlowStep[] = [];
  const done = new Set<string>();
  while (ready.length) {
    ready.sort((a, b) => srcIdx(a) - srcIdx(b));
    const id = ready.shift()!;
    if (done.has(id)) continue;
    done.add(id);
    const n = byId.get(id)!;
    out.push({ id, label: n.label, type: n.type });
    for (const t of adj.get(id) ?? []) {
      indeg.set(t, (indeg.get(t) ?? 0) - 1);
      if ((indeg.get(t) ?? 0) <= 0 && !done.has(t)) ready.push(t);
    }
  }
  // Ev. kvarvarande noder (cykel) läggs sist, markerade som tvetydiga.
  for (const n of model.nodes) {
    if (!done.has(n.id)) out.push({ id: n.id, label: n.label, type: n.type, ambiguous: true });
  }
  return out;
}

function isActorFragment(t: string): boolean {
  return /^(medarbetare|användare|handläggare|kund|anställd|beställare)\b/i.test(t.trim());
}

/**
 * BPMN 2.0 well-formedness. Deterministiska strukturkontroller:
 *  - minst ett start- och ett slut-event,
 *  - alla noder nåbara från ett start,
 *  - inga hängande noder (utan utgång som inte är slut/datalager/notis),
 *  - gateways grenar (≥2 utgångar) eller sammanfogar (≥2 ingångar).
 */
export function checkBpmn(model: ProcessModel): BpmnIssue[] {
  const issues: BpmnIssue[] = [];
  // Utan noder finns inget flöde att kontrollera – men artefakterna kan ändå
  // vara felaktiga (t.ex. ett datalager utan associationer).
  if (model.nodes.length === 0) return checkArtifacts(model);

  const out = new Map<string, number>();
  const inc = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of model.nodes) {
    out.set(n.id, 0);
    inc.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of model.edges) {
    if (!out.has(e.source) || !inc.has(e.target)) continue;
    out.set(e.source, (out.get(e.source) ?? 0) + 1);
    inc.set(e.target, (inc.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }

  const starts = model.nodes.filter((n) => n.type === "start");
  const ends = model.nodes.filter((n) => n.type === "end");
  if (starts.length === 0) issues.push({ level: "error", message: "Saknar start-event." });
  if (ends.length === 0) issues.push({ level: "error", message: "Saknar slut-event." });

  // Nåbarhet från start(er). Om inget start finns, utgå från noder utan ingång.
  const roots = starts.length ? starts.map((n) => n.id) : model.nodes.filter((n) => (inc.get(n.id) ?? 0) === 0).map((n) => n.id);
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const t of adj.get(id) ?? []) stack.push(t);
  }
  for (const n of model.nodes) {
    if (!seen.has(n.id)) {
      issues.push({ level: "warn", message: `Onåbar från start: "${n.label}".` });
    }
  }

  // Hängande noder: ingen utgång och är inte ett giltigt slut (slut/notis).
  // "datastore" är borttaget: datalager är artefakter, inte noder – ett
  // datalager kan därför aldrig vara en legitim ände på ett sekvensflöde.
  const sinkOk = new Set(["end", "notification"]);
  for (const n of model.nodes) {
    if ((out.get(n.id) ?? 0) === 0 && !sinkOk.has(n.type)) {
      issues.push({ level: "warn", message: `Hängande nod (ingen utgång): "${n.label}".` });
    }
  }

  // Gateways ska grena eller sammanfoga.
  for (const n of model.nodes) {
    if (n.type === "decision" && (out.get(n.id) ?? 0) < 2 && (inc.get(n.id) ?? 0) < 2) {
      issues.push({ level: "warn", message: `Gateway "${n.label}" varken grenar eller sammanfogar.` });
    }
  }

  // Notifiering vars ETIKETT nämner en mottagare ("… till kommunikatörer")
  // men vars mottagarfält är tomt: då ritas inget meddelandeflöde, och det
  // ser ut som att kopplingen "glömts". Hänt på riktigt: en gammal tolkning
  // satte mottagare på tre av fyra utskick, och det fjärde stod utan pil.
  // Kontrollen TOLKAR inte (fältet ägs av mellanlagret) – den säger bara till.
  const harFlöde = new Set(model.messageFlows.map((f) => f.nodeId));
  for (const n of model.nodes) {
    if (n.type !== "notification" || n.messageDirection === "receive") continue;
    if (harFlöde.has(n.id)) continue;
    // Mottagaren ÄR angiven, men deltar i processen: då är kopplingen ett
    // sekvensflöde till mottagningssteget, inte ett meddelandeflöde. Att be om
    // en mottagare som redan är satt är ett falsklarm – kompileringen säger
    // själv till (meta.warnings) när mottagningssteget saknas.
    if (n.recipient) continue;
    const nämnd = messageRecipient(n.label);
    if (nämnd) {
      issues.push({
        level: "warn",
        message: `"${n.label}" nämner ${nämnd} men saknar mottagare – meddelandeflödet ritas inte. Sätt mottagaren i mellanlagret.`,
      });
    }
  }

  // Start får inte ha ingång; slut får inte ha utgång.
  for (const n of starts) {
    if ((inc.get(n.id) ?? 0) > 0) issues.push({ level: "warn", message: `Start-event "${n.label}" har inkommande flöde.` });
  }
  for (const n of ends) {
    if ((out.get(n.id) ?? 0) > 0) issues.push({ level: "warn", message: `Slut-event "${n.label}" har utgående flöde.` });
  }

  // Slut-event i en bana som ingen inkommande väg ligger i.
  //
  // Ett slut utför ingenting eget – det avslutar de vägar som når det, och hör
  // därför hemma i deras bana. Hänt i 24 av 28 flöden: tolkningen la "Klart" i
  // SharePoint eller Power Automate (där loggningen skedde), medan pilarna kom
  // från portalen. Pilen hoppade då en bana ner utan att något hände där.
  //
  // RÅDGIVANDE, aldrig en spärr: banan ägs av mellanlagret, och användaren ska
  // kunna dra ett slut vart hen vill. Kontrollen säger bara till.
  const ingångsBanor = new Map<string, Set<string>>();
  for (const e of model.edges) {
    const källa = model.nodes.find((n) => n.id === e.source);
    if (!källa) continue;
    if (!ingångsBanor.has(e.target)) ingångsBanor.set(e.target, new Set());
    ingångsBanor.get(e.target)!.add(källa.laneId);
  }
  for (const n of ends) {
    const banor = ingångsBanor.get(n.id);
    if (!banor || banor.size === 0 || banor.has(n.laneId)) continue;
    issues.push({
      level: "warn",
      message:
        `Slut-event "${n.label}" ligger i banan ${n.laneId}, men vägarna in kommer från ` +
        `${[...banor].join(" och ")}. Flytta slutet dit flödet faktiskt slutar.`,
    });
  }

  issues.push(...checkArtifacts(model));
  return issues;
}

/**
 * Artefakt- och deltagarkontroller. Fångar exakt de formella BPMN-fel som fanns
 * i tidigare version, där datalager låg mitt i sekvensflödet och meddelanden
 * ritades som streckade kanter inom samma pool.
 */
function checkArtifacts(model: ProcessModel): BpmnIssue[] {
  const issues: BpmnIssue[] = [];
  const storeById = new Map(model.dataStores.map((ds) => [ds.id, ds]));
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));

  // 1. Ett datalager får ALDRIG ingå i sekvensflödet – det är en artefakt.
  const iFlödet = new Set<string>();
  for (const e of model.edges) {
    if (storeById.has(e.source)) iFlödet.add(e.source);
    if (storeById.has(e.target)) iFlödet.add(e.target);
  }
  for (const id of iFlödet) {
    issues.push({
      level: "error",
      message: `Datalagret "${storeById.get(id)!.label}" ligger i sekvensflödet. Datalager är artefakter och kopplas med dataassociationer.`,
    });
  }

  // 2. Ett meddelandeflöde måste gå till en deltagare (svart-låda-pool) som finns.
  const poolById = new Map(model.pools.map((p) => [p.id, p]));
  for (const mf of model.messageFlows) {
    const avsändare = nodeById.get(mf.nodeId);
    const namn = avsändare?.label ?? mf.nodeId;
    const pool = poolById.get(mf.poolId);
    if (!pool) {
      issues.push({
        level: "error",
        message: `Meddelandeflöde från "${namn}" pekar på en okänd deltagare (${mf.poolId}).`,
      });
    } else if (!pool.blackBox) {
      issues.push({
        level: "error",
        message: `Meddelandeflöde från "${namn}" går till "${pool.title}" som inte är en mottagarpool (black box).`,
      });
    }
    // 3. Den som skickar ett meddelande bör modelleras som Send Task.
    if (avsändare && avsändare.type !== "notification") {
      issues.push({
        level: "warn",
        message: `"${avsändare.label}" skickar ett meddelande men är inte av typen notifiering (Send Task).`,
      });
    }
  }

  // 4. Ett datalager som ingen läser eller skriver till hänger löst.
  const använda = new Set(model.dataAssociations.map((a) => a.dataStoreId));
  for (const ds of model.dataStores) {
    if (!använda.has(ds.id)) {
      issues.push({
        level: "warn",
        message: `Datalagret "${ds.label}" har ingen dataassociation – ingen aktivitet läser eller skriver.`,
      });
    }
  }

  return issues;
}
