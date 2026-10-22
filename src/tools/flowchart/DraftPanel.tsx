/**
 * Mellanlagret – redigerbar steglista mellan tolkning och diagram.
 *
 * Här justerar användaren AI:ns (eller regelmotorns) tolkning innan något
 * ritas: byt objekttyp, skriv om texten, flytta steg, byt swimlane, ta bort.
 * Panelen redigerar ALDRIG grafen direkt – den redigerar draften, och
 * diagrammet kompileras om deterministiskt. Det är det som gör att man kan
 * experimentera fritt utan att flödet går sönder.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DraftStep, ProcessDraft } from "@/core/draft";
import {
  addStepAfter,
  allLanes,
  compileDraft,
  moveLane,
  moveStep,
  moveStepTo,
  normalizeOrder,
  removeStep,
  renameLane,
  setAutoLabel,
  setAutoLane,
  updateStep,
} from "@/core/draft";
import type { NodeType } from "@/core/model";

/** Nodtyper i den ordning de är rimliga att välja bland, med läsbara namn. */
const TYPE_LABELS: { value: NodeType; label: string; icon: string }[] = [
  { value: "start", label: "Start", icon: "⬤" },
  { value: "activity", label: "Aktivitet", icon: "▢" },
  { value: "decision", label: "Beslut", icon: "◆" },
  { value: "system", label: "System", icon: "⚙" },
  { value: "integration", label: "Integration", icon: "⇄" },
  { value: "notification", label: "Notifiering", icon: "✉" },
  { value: "datastore", label: "Datalager", icon: "⛁" },
  { value: "end", label: "Slut", icon: "⬤" },
];

const ICON = new Map(TYPE_LABELS.map((t) => [t.value, t.icon]));

export interface DraftPanelProps {
  draft: ProcessDraft;
  onChange: (draft: ProcessDraft) => void;
  onClose: () => void;
}

export function DraftPanel({ draft, onChange, onClose }: DraftPanelProps) {
  /** Id på steget som dras, och index där det skulle landa. */
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const ordered = useMemo(() => normalizeOrder(draft), [draft]);
  const banor = allLanes(ordered);
  const lanes = banor.map((l) => l.id);

  /**
   * Automatiska slut-event finns bara i den kompilerade modellen, inte som steg.
   * De listas här så att de går att redigera direkt – döpa om och byta bana –
   * utan att först "materialiseras". Annars satt de fast i den bana de råkade
   * hamna i.
   *
   * Memoiserad: utan det kompilerades HELA modellen om vid varje render – alltså
   * vid varje tangenttryckning i panelen, utöver FlowchartTools egen kompilering.
   */
  const autoSlut = useMemo(() => {
    const model = compileDraft(ordered);
    // Auto-noder känns igen på att de INTE finns som steg. sourceIndex duger
    // inte – manuellt tillagda steg har också −1.
    const stegIds = new Set(ordered.steps.map((s) => s.id));
    return model.nodes.filter((n) => n.type === "end" && !stegIds.has(n.id));
  }, [ordered]);

  /** Löpande numrering: huvudflödet 1,2,3 – grensteg 3a, 3b … */
  const numbers = numberSteps(ordered.steps);

  const set = (id: string, patch: Partial<DraftStep>) => onChange(updateStep(ordered, id, patch));

  /**
   * Dragningen använder pointer-events, inte HTML5:s drag-and-drop.
   *
   * HTML5-varianten är känslig för allt som händer i DOM:en mitt i ett drag –
   * en re-render av raden man håller i kan tysta hela dragget, och beteendet
   * skiljer sig mellan webbläsare. Pointer-events är rå musposition: vi vet
   * alltid var pekaren är, och vi räknar själva ut vilken rad den svävar över.
   * Mer kod här, men förutsägbart överallt.
   */
  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());

  /** Vilket index pekaren pekar ut, utifrån radernas verkliga positioner. */
  const indexAt = useCallback(
    (clientY: number): number => {
      const steps = ordered.steps;
      for (let i = 0; i < steps.length; i++) {
        const el = rowRefs.current.get(steps[i].id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (clientY < r.top) return i; // ovanför första raden i vyn
        // Övre halvan = före raden, nedre halvan = efter den. Utan det går
        // det inte att lägga ett steg allra sist, eller sist i en gren.
        if (clientY <= r.bottom) return clientY - r.top > r.height / 2 ? i + 1 : i;
      }
      return steps.length; // under sista raden
    },
    [ordered.steps],
  );

  const startDrag = (e: React.PointerEvent, stepId: string) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragId(stepId);
    setDropIndex(indexAt(e.clientY));
  };

  const moveDrag = (e: React.PointerEvent) => {
    if (!dragId) return;
    setDropIndex(indexAt(e.clientY));
  };

  const endDrag = () => {
    if (dragId && dropIndex !== null) {
      const next = moveStepTo(ordered, dragId, dropIndex);
      // Släpp på samma plats ger tillbaka samma objekt – rapportera inte det
      // som en ändring, annars ser flödet ut att vara osparat i onödan.
      if (next !== ordered) onChange(next);
    }
    setDragId(null);
    setDropIndex(null);
  };

  // Markera inte text i hela panelen medan man drar.
  useEffect(() => {
    if (!dragId) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [dragId]);

  return (
    <div className="ark-draft">
      <div className="ark-draft-head">
        <strong>Mellanlager</strong>
        <span className="ark-draft-origin">{originLabel(ordered.meta.origin)}</span>
        <span className="ark-pill ok">{ordered.steps.length} steg</span>
        <button className="ark-x" onClick={onClose} title="Stäng">
          ✕
        </button>
      </div>

      <p className="ark-draft-hint">
        Datalager blir <strong>artefakter</strong> vid sidan av flödet (BPMN), och notifieringar
        får ett <strong>meddelandeflöde</strong> till den mottagare du anger. Justera tolkningen här – diagrammet ritas om direkt. Ändringar påverkar inte din
        ursprungstext. <strong>Dra i siffran</strong> för att flytta ett steg; släpper du det under
        ett grensteg blir det en del av grenen. Beslut flyttas med sina grenar.
      </p>

      <div className="ark-lane-order">
        <div className="ark-lane-order-title">Simbanor – ordning uppifrån och ned</div>
        {banor.map((l, i) => (
          <div key={l.id} className="ark-lane-row">
            <input
              className="ark-draft-text"
              value={l.title}
              onChange={(e) => onChange(renameLane(ordered, l.id, e.target.value))}
              title="Byt namn på banan (stegen följer med)"
            />
            <div className="ark-draft-actions">
              <button
                className="ark-iconbtn"
                onClick={() => onChange(moveLane(ordered, l.id, -1))}
                disabled={i === 0}
                title="Flytta banan uppåt"
              >
                ↑
              </button>
              <button
                className="ark-iconbtn"
                onClick={() => onChange(moveLane(ordered, l.id, 1))}
                disabled={i === banor.length - 1}
                title="Flytta banan nedåt"
              >
                ↓
              </button>
            </div>
          </div>
        ))}
      </div>

      {autoSlut.length > 0 && (
        <div className="ark-auto-ends">
          {autoSlut.map((a) => (
            <div key={a.id} className="ark-auto-end">
              <span className="ark-auto-end-tag" title="Automatiskt slut-event (notation)">
                ⬤ Slut
              </span>
              <input
                className="ark-draft-text"
                value={a.label}
                onChange={(e) => onChange(setAutoLabel(ordered, a.id, e.target.value))}
                placeholder="Klart"
                title="Namn på slut-eventet"
              />
              <input
                className="ark-draft-lane"
                list="ark-lane-list"
                value={a.laneId}
                onChange={(e) => onChange(setAutoLane(ordered, a.id, e.target.value))}
                title="Simbana – välj en annan för att flytta slutet dit"
              />
            </div>
          ))}
        </div>
      )}

      <div className="ark-draft-rows" onPointerMove={moveDrag} onPointerUp={endDrag}>
        {ordered.steps.map((step, i) => (
          <div
            key={step.id}
            ref={(el) => rowRefs.current.set(step.id, el)}
            className={[
              "ark-draft-row",
              step.branchOf ? "branch" : "",
              dragId === step.id ? "dragging" : "",
              // Indikatorn ritas som linje ÖVER raden man landar före; bara
              // sista raden får en linje under sig (släpp allra sist).
              dropIndex === i ? "drop-before" : "",
              dropIndex === i + 1 && i === ordered.steps.length - 1 ? "drop-after" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {/*
              Bara siffran är dragghandtag, inte hela raden – annars går det
              inte att markera text i fälten.
            */}
            {/*
              Bara pointerdown ligger på handtaget. Pointer capture gör att
              move/up ändå dispatchas hit och bubblar upp till behållaren, som
              äger dem – låg de på båda ställena kördes släppet två gånger.
            */}
            <span
              className="ark-draft-n"
              onPointerDown={(e) => startDrag(e, step.id)}
              title={step.note || "Dra för att flytta steget"}
              aria-label="Dra för att flytta steget"
            >
              {numbers.get(step.id)}
            </span>

            {step.branchOf && (
              <span className="ark-draft-branch" title="Gren under föregående beslut">
                {step.branchOf.label} →
              </span>
            )}

            <select
              className="ark-draft-type"
              value={step.type}
              onChange={(e) => set(step.id, { type: e.target.value as NodeType })}
              title="Objekttyp"
            >
              {TYPE_LABELS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.icon} {t.label}
                </option>
              ))}
            </select>

            <input
              className="ark-draft-text"
              value={step.text}
              onChange={(e) => set(step.id, { text: e.target.value })}
              placeholder="Beskrivning av steget"
            />

            <input
              className="ark-draft-lane"
              list="ark-lane-list"
              value={step.laneId}
              onChange={(e) => set(step.id, { laneId: e.target.value })}
              title="Swimlane"
            />

            {step.type === "notification" && (
              <input
                className="ark-draft-lane ark-draft-recipient"
                value={step.recipient ?? ""}
                onChange={(e) => set(step.id, { recipient: e.target.value })}
                placeholder="Mottagare"
                title="Vem tar emot meddelandet? Ger ett meddelandeflöde ut till den deltagaren. Tomt = inget meddelandeflöde."
              />
            )}

            <div className="ark-draft-actions">
              <button
                className="ark-iconbtn"
                onClick={() => onChange(moveStep(ordered, step.id, -1))}
                disabled={i === 0}
                title="Flytta upp"
              >
                ↑
              </button>
              <button
                className="ark-iconbtn"
                onClick={() => onChange(moveStep(ordered, step.id, 1))}
                disabled={i === ordered.steps.length - 1}
                title="Flytta ned"
              >
                ↓
              </button>
              <button
                className="ark-iconbtn"
                onClick={() =>
                  onChange(
                    addStepAfter(ordered, step.id, {
                      type: "activity",
                      text: "Nytt steg",
                      laneId: step.laneId,
                      branchOf: step.branchOf,
                    }),
                  )
                }
                title="Lägg till steg efter detta"
              >
                +
              </button>
              <button
                className="ark-iconbtn danger"
                onClick={() => onChange(removeStep(ordered, step.id))}
                title="Ta bort steget"
              >
                🗑
              </button>
            </div>

            {step.note && <div className="ark-draft-note">{step.note}</div>}
          </div>
        ))}
      </div>

      <datalist id="ark-lane-list">
        {lanes.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>

      <div className="ark-draft-foot">
        <button
          className="ark-btn"
          onClick={() =>
            onChange(
              addStepAfter(ordered, null, {
                type: "activity",
                text: "Nytt steg",
                laneId: lanes[0] ?? "Användare",
              }),
            )
          }
        >
          + Lägg till steg sist
        </button>
      </div>
    </div>
  );
}

function originLabel(origin: ProcessDraft["meta"]["origin"]): string {
  if (origin === "ai") return "från AI-beskrivning";
  if (origin === "rules") return "från regeltolkning";
  return "justerat manuellt";
}

/**
 * Numrerar stegen läsbart: huvudflödet får 1, 2, 3 … och grensteg får
 * beslutets nummer med bokstavssuffix (3a, 3b) så det syns var de hör hemma.
 */
function numberSteps(steps: DraftStep[]): Map<string, string> {
  const out = new Map<string, string>();
  const branchCount = new Map<string, number>();
  let main = 0;
  for (const s of steps) {
    if (!s.branchOf) {
      out.set(s.id, String(++main));
      continue;
    }
    const parent = out.get(s.branchOf.stepId) ?? String(main);
    const n = (branchCount.get(s.branchOf.stepId) ?? 0) + 1;
    branchCount.set(s.branchOf.stepId, n);
    out.set(s.id, `${parent}${String.fromCharCode(96 + n)}`);
  }
  return out;
}

export { ICON as STEP_ICON };
