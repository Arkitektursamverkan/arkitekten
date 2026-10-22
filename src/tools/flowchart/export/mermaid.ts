/**
 * Mermaid-export (KRAV 8). Genereras deterministiskt ur modellen.
 * Swimlanes blir subgraphs; nodform styrs av typ.
 *
 * FÖRENKLING: Mermaids flowchart har inget BPMN-stöd – ingen pool, ingen
 * artefakt, ingen skillnad mellan sekvensflöde, dataassociation och
 * meddelandeflöde. Vi ritar därför datalager som vanliga `[( )]`-noder och
 * kopplar dem streckat (`-.->`) till sin aktivitet, och låter varje
 * mottagarpool bli en egen nod dit meddelandeflödet går. Det är en läsbar
 * approximation, inte formell BPMN – för det finns SVG- och draw.io-exporten.
 */

import type { ProcessModel, ProcessNode } from "@/core/model";

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function esc(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/\n/g, " ");
}

function nodeShape(n: ProcessNode): string {
  const id = safeId(n.id);
  const l = `"${esc(n.label)}"`;
  switch (n.type) {
    case "decision":
      // BPMN-gateway: markera exklusiv (✕) / parallell (✚) i etiketten.
      return `${id}{"${n.gateway === "parallel" ? "✚ " : "✕ "}${esc(n.label)}"}`;
    case "datastore":
      return `${id}[(${l})]`;
    case "start":
    case "end":
      // BPMN-event → cirkel.
      return `${id}((${l}))`;
    case "system":
    case "integration":
      return `${id}[[${l}]]`;
    default:
      return `${id}[${l}]`;
  }
}

export function toMermaid(model: ProcessModel): string {
  const dir = model.direction === "TB" ? "TD" : "LR";
  const lines: string[] = [`flowchart ${dir}`];

  // Deklarera noder – och datalager-artefakter – inom sin swimlane.
  for (const lane of model.swimlanes) {
    const laneNodes = model.nodes.filter((n) => n.laneId === lane.id);
    const laneStores = model.dataStores.filter((ds) => ds.laneId === lane.id);
    if (laneNodes.length === 0 && laneStores.length === 0) continue;
    lines.push(`  subgraph ${safeId(lane.id)}["${esc(lane.title)}"]`);
    for (const n of laneNodes) lines.push(`    ${nodeShape(n)}`);
    for (const ds of laneStores) lines.push(`    ${safeId(ds.id)}[("${esc(ds.label)}")]`);
    lines.push(`  end`);
  }

  // Mottagarpooler blir egna noder – Mermaid kan inte rita en svart låda.
  for (const p of model.pools.filter((p) => p.blackBox)) {
    lines.push(`  ${safeId(p.id)}["${esc(p.title)}"]`);
  }

  // Sekvensflöden – heldragna.
  for (const e of model.edges) {
    const s = safeId(e.source);
    const t = safeId(e.target);
    lines.push(e.label ? `  ${s} -->|${esc(e.label)}| ${t}` : `  ${s} --> ${t}`);
  }

  // Dataassociationer – streckade, riktade efter läs/skriv.
  for (const a of model.dataAssociations) {
    const n = safeId(a.nodeId);
    const ds = safeId(a.dataStoreId);
    lines.push(a.direction === "write" ? `  ${n} -.-> ${ds}` : `  ${ds} -.-> ${n}`);
  }

  // Meddelandeflöden – streckade ut till mottagaren.
  for (const mf of model.messageFlows) {
    lines.push(`  ${safeId(mf.nodeId)} -.->|${esc(mf.label ?? "meddelande")}| ${safeId(mf.poolId)}`);
  }

  // Klassfärger per typ.
  lines.push(`  classDef decision fill:#fff6e5,stroke:#d99a2b,color:#7c4a03;`);
  lines.push(`  classDef datastore fill:#f4f6f8,stroke:#6b7280,color:#111827;`);
  lines.push(`  classDef notification fill:#f3ecff,stroke:#8b5cf6,color:#4c1d95;`);
  for (const n of model.nodes) {
    if (n.type === "decision" || n.type === "datastore" || n.type === "notification") {
      lines.push(`  class ${safeId(n.id)} ${n.type};`);
    }
  }
  for (const ds of model.dataStores) lines.push(`  class ${safeId(ds.id)} datastore;`);

  return lines.join("\n");
}
