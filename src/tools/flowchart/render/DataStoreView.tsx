/**
 * BPMN data store – ritas som ARTEFAKT, inte som flödesobjekt.
 *
 * Utseendet är medvetet identiskt med den cylinder som datalager tidigare
 * ritades med i `ProcessNodeView` (grenen `isCylinder`), så att diagrammet ser
 * likadant ut trots att datalagren flyttats ut ur sekvensflödet. Skillnaden är
 * att artefakten saknar typ-ikon. Den GÅR däremot att redigera och flytta som
 * vilket objekt som helst – att den flyttades ut ur sekvensflödet är en
 * modellfråga och ska inte göra den orörbar.
 */

import { useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { DataStore } from "@/core/model";
import { nodeStyle, type ColorMode } from "../theme";

export interface DataStoreNodeData extends Record<string, unknown> {
  store: DataStore;
  /** Global storleksfaktor – skalar texten i samma takt som formen. */
  scale: number;
  /** Global textstorlek (bara texten). */
  textScale?: number;
  /** Valt som kopplingens START i verktygsradens kopplingsläge. */
  kopplaVald?: boolean;
  colorMode?: ColorMode;
  onLabelChange?: (id: string, label: string) => void;
}

export function DataStoreView({ data, selected, isConnectable }: NodeProps) {
  const { store, scale, colorMode, onLabelChange, textScale = 1, kopplaVald } = data as DataStoreNodeData;
  const tScale = textScale * (store.textSize ?? 1);
  const style = nodeStyle("datastore", colorMode);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(store.label);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setValue(store.label), [store.label]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  /** Escape-vakt – se ProcessNodeView: utan den sparade avmonteringens blur ändå. */
  const avbruten = useRef(false);

  const commit = () => {
    setEditing(false);
    if (avbruten.current) {
      avbruten.current = false;
      setValue(store.label);
      return;
    }
    if (value.trim() && value !== store.label) onLabelChange?.(store.id, value.trim());
    else setValue(store.label);
  };

  return (
    <div
      className={`ark-node ark-datastore${kopplaVald ? " ark-koppla-från" : ""}`}
      style={{
        background: style.fill,
        borderColor: style.stroke,
        color: style.text,
        // Samma cylinderform som tidigare: elliptiska hörn ger "burk"-siluetten.
        borderRadius: "50% / 12px",
        fontSize: `${12 * scale * tScale}px`,
        boxShadow: selected ? `0 0 0 2px ${style.stroke}66` : "0 1px 2px rgba(16,24,40,0.06)",
      }}
      title={store.label}
      onDoubleClick={() => setEditing(true)}
    >
      {/*
       * Dataassociationen är streckad och riktad åt båda håll (read/write).
       * Handtagen är DRAGBARA – ett datalager är en giltig ände på en manuellt
       * dragen koppling (addManualEdge härleder sorten ur ändarna). De var
       * länge gömda och odragbara, och då gick det inte att dra en pil från
       * t.ex. "Loggpost skapas" alls. Samma par-upplägg som ProcessNodeView:
       * målhandtag kan bara vara SLUT, källhandtag bara START.
       */}
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
      <div className="ark-node-body">
        {editing ? (
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
                setValue(store.label);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span className="ark-node-label">{store.label}</span>
        )}
      </div>
    </div>
  );
}
