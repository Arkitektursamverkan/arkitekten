/**
 * Spårbarhets-inspektör (Regel 2). Visar exakt vad varje textfragment blev –
 * beviset för "100% spårbarhet mellan beskrivning och diagram".
 */

import { TYPE_LABEL } from "./theme";
import type { ValidationReport } from "./parser/validate";

export function TracePanel({
  report,
  onClose,
}: {
  report: ValidationReport;
  onClose: () => void;
}) {
  return (
    <div className="ark-trace">
      <div className="ark-trace-head">
        <strong>Spårbarhet & BPMN</strong>
        <span className={report.ok ? "ark-pill ok" : "ark-pill warn"}>
          {report.nodeCount} noder ↔ {report.fragmentCount} fragment
        </span>
        <button className="ark-x" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="ark-flow-check">
        <div className="ark-bpmn-title">Följd i flödet</div>
        <ol className="ark-flow-list">
          {report.flow.map((step, i) => (
            <li key={step.id} className={`t-${step.type}`}>
              <span className="ark-flow-n">{i + 1}</span>
              <span className="ark-flow-label">{step.label}</span>
              <span className="ark-flow-type">
                {TYPE_LABEL[step.type]}
                {step.ambiguous ? " · ordning oklar" : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="ark-bpmn-check">
        <div className="ark-bpmn-title">
          BPMN 2.0-kontroll{" "}
          <span className={report.bpmn.length === 0 ? "ark-pill ok" : "ark-pill warn"}>
            {report.bpmn.length === 0 ? "inga avvikelser" : `${report.bpmn.length} avvikelser`}
          </span>
        </div>
        {report.bpmn.length > 0 && (
          <ul className="ark-bpmn-list">
            {report.bpmn.map((iss, i) => (
              <li key={i} className={iss.level === "error" ? "err" : "warn"}>
                {iss.level === "error" ? "✕" : "!"} {iss.message}
              </li>
            ))}
          </ul>
        )}
      </div>
      <table className="ark-trace-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Fragment</th>
            <th>Blev</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r) => (
            <tr key={r.index} className={r.outcome === "obehandlat" ? "row-warn" : ""}>
              <td>{r.index + 1}</td>
              <td title={r.fragment}>{r.fragment}</td>
              <td>
                {r.outcome}
                {r.nodeLabel ? ` – "${r.nodeLabel}"` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
