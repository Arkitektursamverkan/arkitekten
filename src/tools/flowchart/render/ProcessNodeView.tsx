/**
 * Anpassad React Flow-nod – renderad enligt BPMN 2.0:
 *   event (start = tunn cirkel, slut = tjock cirkel),
 *   task (rundad rekt med typ-ikon: User/Service/Send),
 *   gateway (romb med ✕ exklusiv / ✚ parallell),
 *   data store (cylinder).
 * Etikett redigeras via dubbelklick.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BPMN_SHAPE, eventKind, taskIcon, type ProcessNode } from "@/core/model";
import { decisionTextScale, nodeStyle, TYPE_LABEL, type ColorMode } from "../theme";
import { BpmnTaskGlyph } from "./BpmnIcons";

export interface ProcessNodeData extends Record<string, unknown> {
  model: ProcessNode;
  onLabelChange: (id: string, label: string) => void;
  /** Global storleksfaktor – skalar texten i samma takt som noden. */
  scale: number;
  colorMode?: ColorMode;
  /** Global textstorlek (bara texten, inte objekten). */
  textScale?: number;
  /**
   * Objektet är valt som KOPPLINGENS START i verktygsradens kopplingsläge.
   * Klassen sätts här och inte via React Flows `node.className` – den nådde
   * aldrig DOM:en, så markeringen syntes inte och man visste inte vad man valt.
   */
  kopplaVald?: boolean;
}

/** Flexstilar för manuell textplacering i nodkroppen. Saknas = centrerat. */
function placementStyle(p?: ProcessNode["textPlacement"]): CSSProperties {
  switch (p) {
    case "top": return { alignItems: "flex-start" };
    case "bottom": return { alignItems: "flex-end" };
    case "left": return { justifyContent: "flex-start", textAlign: "left" };
    case "right": return { justifyContent: "flex-end", textAlign: "right" };
    default: return {};
  }
}

export function ProcessNodeView({ data, selected, isConnectable }: NodeProps) {
  const { model, onLabelChange, scale, colorMode, textScale = 1, kopplaVald } = data as ProcessNodeData;
  /** Textens totala faktor: global textstorlek × objektets egen. */
  const tScale = textScale * (model.textSize ?? 1);
  const style = nodeStyle(model.type, colorMode);
  const bshape = BPMN_SHAPE[model.type];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(model.label);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setValue(model.label), [model.label]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  /**
   * Escape-vakt: när fältet avmonteras efter Escape avfyras ändå en blur, och
   * dess commit såg det GAMLA värdet – Escape betedde sig som Enter och
   * ändringen sparades fast man ångrade sig. Flaggan gör avbrottet bindande.
   */
  const avbruten = useRef(false);

  const commit = () => {
    setEditing(false);
    if (avbruten.current) {
      avbruten.current = false;
      setValue(model.label);
      return;
    }
    if (value.trim() && value !== model.label) onLabelChange(model.id, value.trim());
    else setValue(model.label);
  };

  const label = editing ? (
    <textarea
      ref={inputRef}
      className="ark-node-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          avbruten.current = true;
          setValue(model.label);
          setEditing(false);
        }
      }}
    />
  ) : (
    <span className="ark-node-label">{model.label}</span>
  );

  /**
   * Handtag på alla fyra sidor, i par (mål + källa) på samma punkt.
   *
   * Paren ligger exakt ovanpå varandra, vilket gör att bara det översta kan
   * träffas av muspekaren. Därför begränsas de: målhandtag kan bara vara SLUT
   * på en koppling, källhandtag bara START. Då vet React Flow vilket handtag
   * som är giltigt när man drar en pilände hit, och rätt handtag träffas även
   * om de överlappar. Utan detta gick kopplingspunkter inte att ändra alls.
   */
  const valdKlass = kopplaVald ? " ark-koppla-från" : "";
  const handles = (
    <>
      {/* `isConnectable` MÅSTE skickas vidare till varje handtag.
          React Flows Handle har `isConnectable = true` som STANDARD, och
          nodens egen flagga (`nodesConnectable` / `node.connectable`) når den
          bara via den här propen. Utan den gick det att dra nya kopplingar på
          en LÅST rityta – i läsläge, där ingenting ska gå att ändra. */}
      <Handle id="t-top" type="target" position={Position.Top} className="ark-handle" isConnectable={isConnectable} isConnectableStart={false} />
      <Handle id="t-left" type="target" position={Position.Left} className="ark-handle" isConnectable={isConnectable} isConnectableStart={false} />
      <Handle id="t-right" type="target" position={Position.Right} className="ark-handle" isConnectable={isConnectable} isConnectableStart={false} />
      <Handle id="t-bottom" type="target" position={Position.Bottom} className="ark-handle" isConnectable={isConnectable} isConnectableStart={false} />
      <Handle id="s-top" type="source" position={Position.Top} className="ark-handle" isConnectable={isConnectable} isConnectableEnd={false} />
      <Handle id="s-left" type="source" position={Position.Left} className="ark-handle" isConnectable={isConnectable} isConnectableEnd={false} />
      <Handle id="s-right" type="source" position={Position.Right} className="ark-handle" isConnectable={isConnectable} isConnectableEnd={false} />
      <Handle id="s-bottom" type="source" position={Position.Bottom} className="ark-handle" isConnectable={isConnectable} isConnectableEnd={false} />
    </>
  );

  // --- Event: cirkel med tunn (start) / tjock (slut) ring ---
  if (bshape === "event") {
    const ek = eventKind(model.type);
    const ring = (ek === "end" ? 4.5 : 2.5) * scale;
    return (
      <div
        className={`ark-node ark-node--event ark-node--${model.type}${valdKlass}`}
        style={{
          background: style.fill,
          borderColor: style.stroke,
          color: style.text,
          borderWidth: ring,
          borderRadius: "50%",
          fontSize: `${10.5 * scale * tScale}px`,
          boxShadow: selected ? `0 0 0 2px ${style.stroke}66` : "0 1px 2px rgba(16,24,40,0.06)",
        }}
        onDoubleClick={() => setEditing(true)}
        title={model.sourceText}
      >
        {handles}
        <div className="ark-node-body" style={placementStyle(model.textPlacement)}>{label}</div>
      </div>
    );
  }

  // --- Gateway: romb med BPMN-symbol (✕ exklusiv / ✚ parallell) ---
  if (bshape === "gateway") {
    const sym = model.gateway === "parallel" ? "✚" : "✕";
    return (
      <div
        className={`ark-node ark-node--diamond ark-node--decision${valdKlass}`}
        style={{
          background: style.fill,
          borderColor: style.stroke,
          color: style.text,
          fontSize: `${11 * scale * tScale}px`,
          boxShadow: selected ? `0 0 0 2px ${style.stroke}66` : "0 1px 2px rgba(16,24,40,0.06)",
        }}
        onDoubleClick={() => setEditing(true)}
        title={model.sourceText}
      >
        {handles}
        <span
          className="ark-gw-symbol"
          style={{ color: style.stroke, fontSize: `${12 * scale}px` }}
          title={model.gateway === "parallel" ? "Parallell gateway (AND)" : "Exklusiv gateway (XOR)"}
        >
          {sym}
        </span>
        {/* Lång fråga krymps så den ryms i romben – samma regel som exporten. */}
        <div
          className="ark-node-diamond-inner"
          style={{ fontSize: `${11 * scale * tScale * decisionTextScale(model.label)}px` }}
        >
          {label}
        </div>
      </div>
    );
  }

  // --- Task / Data store: rundad rekt / cylinder med typ-ikon ---
  const isCylinder = bshape === "dataStore";
  const icon = taskIcon(model);
  return (
    <div
      className={`ark-node ark-node--${model.type}${valdKlass}`}
      style={{
        background: style.fill,
        borderColor: style.stroke,
        color: style.text,
        borderRadius: isCylinder ? "50% / 12px" : 12,
        fontSize: `${12 * scale * tScale}px`,
        boxShadow: selected ? `0 0 0 2px ${style.stroke}66` : "0 1px 2px rgba(16,24,40,0.06)",
      }}
      onDoubleClick={() => setEditing(true)}
      title={model.sourceText}
    >
      {handles}
      {icon !== "none" && (
        <span className="ark-node-icon" title={TYPE_LABEL[model.type]}>
          <BpmnTaskGlyph icon={icon} size={12 * scale} color={style.stroke} />
        </span>
      )}
      {/* Ikonen bor i övre vänstra hörnet – texten börjar under ikonraden så
          att en lång etikett aldrig hamnar bakom kuvertet/kugghjulet. */}
      <div
        className="ark-node-body"
        style={{
          ...placementStyle(model.textPlacement),
          ...(icon !== "none" ? { paddingTop: `${14 * scale}px` } : {}),
        }}
      >
        {label}
      </div>
    </div>
  );
}
