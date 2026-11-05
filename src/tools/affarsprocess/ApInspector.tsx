/**
 * Inspektörspanel för affärsprocessytan (fas 5): klicka på ett objekt och redigera det
 * direkt – namn, beskrivning ("i"-ikonen), in/ut-objekt och alla satelliter
 * (roller/intressenter med HUKI, IT-stöd, arkiv, krav, tid, forum, plats).
 *
 * Panelen jobbar ALLTID mot mellanlagret via de spridningsägda hjälparna
 * (updateStep, setStepAp, renameSatellit, sättUt/Inobjekt, setAutoLabel) –
 * aldrig direkt mot modellen. Klick på en satellit öppnar dess AKTIVITETS
 * panel, så allt kring en aktivitet redigeras på ett ställe.
 */

import { harChecklista } from "@/core/rutin";
import { useRef, useState } from "react";
import {
  renameSatellit,
  satellitId,
  setStepAp,
  sättInobjekt,
  sättUtobjekt,
  voId,
  voInId,
  type ApModel,
} from "@/core/affarsprocess";
import {
  setAutoLabel,
  setTextSize,
  textSizeFor,
  updateStep,
  type ApStegInfo,
  type Huki,
  type ProcessDraft,
} from "@/core/draft";
import { AP_TYPE_LABEL, HUKI_LABEL } from "./former";
import { bytFriNamn, läggTillAktivitetEfter, taBortFri, taBortObjekt } from "./lagg-till";

// Bokstavens betydelse bor i former (samma text som hovertexten på
// kopplingen) – annars kan väljaren och ritytan säga olika saker.
const HUKI_VAL: { värde: Huki; namn: string }[] = (["H", "U", "K", "I"] as Huki[]).map((v) => ({
  värde: v,
  namn: `${v} – ${HUKI_LABEL[v]}`,
}));

/**
 * Textfält som committar på blur/Enter och AVBRYTER på Escape. Escape måste
 * gå via en ref – avmonteringens blur committar annars ändå (samma fälla som
 * flödesschemats etikettredigering gick i).
 */
function TextFält({
  värde,
  onCommit,
  placeholder,
  bred,
}: {
  värde: string;
  onCommit: (nytt: string) => void;
  placeholder?: string;
  bred?: boolean;
}) {
  const avbruten = useRef(false);
  return (
    <input
      className={`ark-input ${bred ? "ark-ap-falt--bred" : ""}`}
      key={värde} // nytt draft-värde → nollställ fältet
      defaultValue={värde}
      placeholder={placeholder}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          avbruten.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
      onBlur={(e) => {
        if (avbruten.current) {
          avbruten.current = false;
          return;
        }
        if (e.target.value !== värde) onCommit(e.target.value);
      }}
    />
  );
}

/** Redigerbar namnlista (IT-stöd, arkiv, krav). */
function NamnLista({
  rubrik,
  namn,
  onRename,
  onRemove,
  onAdd,
  läggTillText,
}: {
  rubrik: string;
  namn: string[];
  onRename: (gammalt: string, nytt: string) => void;
  onRemove: (namn: string) => void;
  onAdd: (namn: string) => void;
  läggTillText: string;
}) {
  return (
    <div className="ark-ap-satgrupp">
      <div className="ark-section-title">{rubrik}</div>
      {namn.map((n) => (
        <div key={n} className="ark-ap-satrad">
          <TextFält bred värde={n} onCommit={(nytt) => onRename(n, nytt)} />
          <button className="ark-btn ark-btn--icon" title="Ta bort" onClick={() => onRemove(n)}>
            ×
          </button>
        </div>
      ))}
      <NyRad placeholder={läggTillText} onAdd={onAdd} />
    </div>
  );
}

/** Rad för att lägga till en post – committar på Enter/blur, töms efteråt. */
function NyRad({ placeholder, onAdd }: { placeholder: string; onAdd: (namn: string) => void }) {
  const [värde, setVärde] = useState("");
  const lägg = () => {
    const t = värde.trim();
    if (t) onAdd(t);
    setVärde("");
  };
  return (
    <div className="ark-ap-satrad">
      <input
        className="ark-input ark-ap-falt--bred"
        value={värde}
        placeholder={placeholder}
        onChange={(e) => setVärde(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && lägg()}
        onBlur={lägg}
      />
    </div>
  );
}

export interface ApInspectorProps {
  draft: ProcessDraft;
  model: ApModel;
  /** Valt objekt-id på ytan. */
  nodeId: string;
  onChange: (nästa: ProcessDraft) => void;
  onClose: () => void;
  /** Öppnar rutinvyn för ett krav (skapa eller visa). Saknas = ingen rutinknapp. */
  onRutin?: (nodId: string) => void;
  /** Markerar ett annat objekt – en nyss tillagd aktivitet öppnas för namnbyte. */
  onVälj?: (nodId: string) => void;
}

export function ApInspector({ draft, model, nodeId, onChange, onClose, onRutin, onVälj }: ApInspectorProps) {
  const nod = model.nodes.find((n) => n.id === nodeId);
  if (!nod) return null;

  // Rutinen hör till det KLICKADE kravet, även när panelen visar aktiviteten.
  const rutin = nod.kind === "krav" && onRutin && (
    <div className="ark-ap-satgrupp">
      <div className="ark-section-title">Rutin · {nod.label}</div>
      <button className="ark-btn" onClick={() => onRutin(nodeId)}>
        {nod.rutin ? "Visa rutinen" : harChecklista(nod.label) ? "Skapa rutin ur checklistan" : "Skapa rutin"}
      </button>
      {!nod.rutin && harChecklista(nod.label) && (
        <p className="ark-hint">
          Kravet har en checklista i namnet. Den blir kravets rutin – ett moment per ruta – och
          kravet behåller namnet före rutorna.
        </p>
      )}
    </div>
  );

  // Fritt objekt (utplacerat från paletten, ännu inte inknutet): namn och
  // borttagning – kopplingen görs genom att dra en pil på ytan.
  const fri = draft.apFria?.find((f) => f.id === nodeId);
  if (fri) {
    return (
      <div className="ark-ap-inspektor">
        <Huvud titel={`${AP_TYPE_LABEL[nod.kind]} · fritt objekt`} onClose={onClose} />
        <div className="ark-ap-satgrupp">
          <div className="ark-section-title">Namn</div>
          <TextFält bred värde={fri.namn} onCommit={(nytt) => onChange(bytFriNamn(draft, fri.id, nytt))} />
        </div>
        <p className="ark-hint">
          Objektet är inte kopplat till något ännu. Dra en pil från eller till en aktivitet så
          knyts det in – en roll blir aktivitetens roll, ett verksamhetsobjekt dess ut- eller
          in-objekt, en aktivitet ett steg i kedjan.
        </p>
        {rutin}
        <Textstorlek draft={draft} nodeId={nodeId} onChange={onChange} />
        <button
          className="ark-linkbtn"
          onClick={() => {
            onChange(taBortFri(draft, fri.id));
            onClose();
          }}
        >
          Ta bort objektet
        </button>
      </div>
    );
  }

  // En satellit redigeras via sin AKTIVITETS panel; VO-objekt via sitt steg.
  const stegId = nod.anchorId ?? (nodeId.startsWith("vo_in_") ? nodeId.slice(6) : nodeId.startsWith("vo_") ? nodeId.slice(3) : nodeId);
  const steg = draft.steps.find((s) => s.id === stegId);

  // Auto-noder utan steg (auto-slut, gemensamt slut): bara namnbyte.
  if (!steg) {
    return (
      <div className="ark-ap-inspektor">
        <Huvud titel={AP_TYPE_LABEL[nod.kind]} onClose={onClose} />
        <div className="ark-ap-satgrupp">
          <div className="ark-section-title">Namn</div>
          <TextFält bred värde={nod.label} onCommit={(nytt) => onChange(setAutoLabel(draft, nodeId, nytt))} />
        </div>
        <Textstorlek draft={draft} nodeId={nodeId} onChange={onChange} />
      </div>
    );
  }

  const ap: ApStegInfo = steg.ap ?? {};
  const ärKedjenod = !nod.anchorId && !nodeId.startsWith("vo_");
  const utNod = model.nodes.find((n) => n.id === voId(stegId));

  const patchAp = (patch: Partial<ApStegInfo>) => onChange(setStepAp(draft, stegId, { ...ap, ...patch }));

  const rollLista = (
    rubrik: string,
    nyckel: "roller" | "intressenter",
    kind: "roll" | "intressent",
    standard: Huki,
    läggTillText: string,
  ) => {
    const lista = ap[nyckel] ?? [];
    return (
      <div className="ark-ap-satgrupp">
        <div className="ark-section-title">{rubrik}</div>
        {lista.map((r) => (
          <div key={satellitId(kind, stegId, r.namn)} className="ark-ap-satrad">
            <TextFält
              bred
              värde={r.namn}
              onCommit={(nytt) => onChange(renameSatellit(draft, stegId, kind, r.namn, nytt))}
            />
            <select
              className="ark-input ark-ap-huki"
              value={r.huki ?? standard}
              title="HUKI-ansvar"
              onChange={(e) =>
                patchAp({
                  [nyckel]: lista.map((x) =>
                    x.namn === r.namn ? { ...x, huki: e.target.value as Huki } : x,
                  ),
                })
              }
            >
              {HUKI_VAL.map((h) => (
                <option key={h.värde} value={h.värde}>
                  {h.värde}
                </option>
              ))}
            </select>
            <button
              className="ark-btn ark-btn--icon"
              title="Ta bort"
              onClick={() => patchAp({ [nyckel]: lista.filter((x) => x.namn !== r.namn) })}
            >
              ×
            </button>
          </div>
        ))}
        <NyRad
          placeholder={läggTillText}
          onAdd={(namn) => patchAp({ [nyckel]: [...lista, { namn, huki: standard }] })}
        />
      </div>
    );
  };

  return (
    <div className="ark-ap-inspektor">
      <Huvud
        titel={`${AP_TYPE_LABEL[nod.kind]}${nod.anchorId ? ` · ${steg.text}` : ""}`}
        onClose={onClose}
      />

      {rutin}

      {ärKedjenod && (
        <div className="ark-ap-satgrupp">
          <div className="ark-section-title">Namn</div>
          <TextFält
            bred
            värde={steg.text}
            onCommit={(nytt) => onChange(updateStep(draft, stegId, { text: nytt }))}
          />
          <div className="ark-section-title">Beskrivning (ger i-ikonen)</div>
          <TextFält
            bred
            värde={steg.note ?? ""}
            placeholder="Beskriv aktiviteten…"
            onCommit={(nytt) => onChange(updateStep(draft, stegId, { note: nytt.trim() || undefined }))}
          />
          {(nod.kind === "aktivitet" || nod.kind === "forum") && (
            <label
              className="ark-ap-etikett"
              title="Ett forum kan användas i stället för en aktivitet när den alltid genomförs i mötesform. Ritas som en pratbubbla i kedjan."
            >
              <input
                type="checkbox"
                checked={Boolean(ap.iMötesform)}
                onChange={(e) => patchAp({ iMötesform: e.target.checked || undefined })}
              />{" "}
              Genomförs alltid i mötesform (forum)
            </label>
          )}
        </div>
      )}

      <div className="ark-ap-satgrupp">
        <div className="ark-section-title">Förädlingskedjan</div>
        <label className="ark-ap-etikett">In-objekt</label>
        <TextFält
          bred
          värde={draft.autoLabels?.[voInId(stegId)] ?? ap.input ?? ""}
          placeholder="Inget in-objekt"
          onCommit={(nytt) => onChange(sättInobjekt(draft, stegId, nytt || undefined))}
        />
        <label className="ark-ap-etikett">Ut-objekt</label>
        {ap.output === null ? (
          <button className="ark-linkbtn" onClick={() => onChange(sättUtobjekt(draft, stegId, undefined))}>
            Bortvalt – slå på förslaget igen
          </button>
        ) : (
          <>
            <TextFält
              bred
              värde={utNod?.label ?? ""}
              placeholder="Föreslås automatiskt"
              onCommit={(nytt) => onChange(sättUtobjekt(draft, stegId, nytt || undefined))}
            />
            {utNod && (
              <button className="ark-linkbtn" onClick={() => onChange(sättUtobjekt(draft, stegId, null))}>
                Ta bort ut-objektet
              </button>
            )}
          </>
        )}
      </div>

      {/* Gäller det KLICKADE objektet: klickar man på en roll öppnas
          aktivitetens panel, men storleken ska ändå gälla rollen. */}
      <Textstorlek draft={draft} nodeId={nodeId} onChange={onChange} />

      {rollLista("Roller (HUKI)", "roller", "roll", "U", "Lägg till roll…")}
      {rollLista("Intressenter (HUKI)", "intressenter", "intressent", "I", "Lägg till intressent…")}

      <NamnLista
        rubrik="IT-stöd (Samverkar med)"
        namn={ap.applikationer ?? []}
        onRename={(g, n) => onChange(renameSatellit(draft, stegId, "applikation", g, n))}
        onRemove={(n) => patchAp({ applikationer: (ap.applikationer ?? []).filter((x) => x !== n) })}
        onAdd={(n) => patchAp({ applikationer: [...(ap.applikationer ?? []), n] })}
        läggTillText="Lägg till applikation…"
      />
      <NamnLista
        rubrik="Arkiv"
        namn={ap.arkiv ?? []}
        onRename={(g, n) => onChange(renameSatellit(draft, stegId, "arkiv", g, n))}
        onRemove={(n) => patchAp({ arkiv: (ap.arkiv ?? []).filter((x) => x !== n) })}
        onAdd={(n) => patchAp({ arkiv: [...(ap.arkiv ?? []), n] })}
        läggTillText="Lägg till arkiv…"
      />
      <NamnLista
        rubrik="Krav (Adresserar)"
        namn={ap.krav ?? []}
        onRename={(g, n) => onChange(renameSatellit(draft, stegId, "krav", g, n))}
        onRemove={(n) => patchAp({ krav: (ap.krav ?? []).filter((x) => x !== n) })}
        onAdd={(n) => patchAp({ krav: [...(ap.krav ?? []), n] })}
        läggTillText="Lägg till krav…"
      />

      <NamnLista
        rubrik="Problem · Risk · Möjlighet"
        namn={ap.problem ?? []}
        onRename={(g, n) => onChange(renameSatellit(draft, stegId, "problem", g, n))}
        onRemove={(n) => patchAp({ problem: (ap.problem ?? []).filter((x) => x !== n) })}
        onAdd={(n) => patchAp({ problem: [...(ap.problem ?? []), n] })}
        läggTillText="Lägg till problem…"
      />
      <NamnLista
        rubrik="Risker"
        namn={ap.risker ?? []}
        onRename={(g, n) => onChange(renameSatellit(draft, stegId, "risk", g, n))}
        onRemove={(n) => patchAp({ risker: (ap.risker ?? []).filter((x) => x !== n) })}
        onAdd={(n) => patchAp({ risker: [...(ap.risker ?? []), n] })}
        läggTillText="Lägg till risk…"
      />
      <NamnLista
        rubrik="Möjligheter"
        namn={ap.mojligheter ?? []}
        onRename={(g, n) => onChange(renameSatellit(draft, stegId, "mojlighet", g, n))}
        onRemove={(n) => patchAp({ mojligheter: (ap.mojligheter ?? []).filter((x) => x !== n) })}
        onAdd={(n) => patchAp({ mojligheter: [...(ap.mojligheter ?? []), n] })}
        läggTillText="Lägg till möjlighet…"
      />

      <div className="ark-ap-satgrupp">
        <div className="ark-section-title">Tid · Plats</div>
        <label className="ark-ap-etikett">Tid</label>
        <TextFält
          bred
          värde={ap.tid ?? ""}
          placeholder="T.ex. Inom 5 dagar"
          onCommit={(nytt) => patchAp({ tid: nytt.trim() || undefined })}
        />
        {/* Ett forum BREDVID aktiviteten har reglerna ingen motsvarighet till –
            där står forumet i aktivitetens ställe (rutan "Genomförs alltid i
            mötesform" ovan). Fältet visas bara för att kunna ta bort ett
            sådant ur äldre tolkningar. */}
        {ap.forum && (
          <>
            <label className="ark-ap-etikett">Forum bredvid aktiviteten</label>
            <p className="ark-hint">
              Ett forum står i aktivitetens ställe – använd rutan
              ”Genomförs alltid i mötesform” ovan och ta bort det här.
            </p>
            <TextFält
              bred
              värde={ap.forum}
              onCommit={(nytt) => patchAp({ forum: nytt.trim() || undefined })}
            />
            <button className="ark-linkbtn" onClick={() => patchAp({ forum: undefined })}>
              Ta bort forumet bredvid
            </button>
          </>
        )}
        <label className="ark-ap-etikett">Plats</label>
        <TextFält
          bred
          värde={ap.plats ?? ""}
          placeholder="T.ex. Huvudkontoret"
          onCommit={(nytt) => patchAp({ plats: nytt.trim() || undefined })}
        />
      </div>

      {/* Kedjan: lägga till efter och ta bort – även för steg som AI:n eller
          regelparsern tolkat fram. Ångra tar tillbaka. */}
      {ärKedjenod && (
        <div className="ark-ap-satgrupp">
          <div className="ark-section-title">Kedjan</div>
          <button
            className="ark-btn"
            onClick={() => {
              const { draft: nästa, nodId } = läggTillAktivitetEfter(draft, stegId);
              onChange(nästa);
              if (nodId) onVälj?.(nodId);
            }}
          >
            + Lägg till aktivitet efter
          </button>
          <button
            className="ark-linkbtn"
            onClick={() => {
              onChange(taBortObjekt(draft, [stegId]));
              onClose();
            }}
          >
            Ta bort ur kedjan
          </button>
          <p className="ark-hint">
            Borttagningen sluter kedjan runt luckan. Vill du i stället bryta kedjan: klicka på pilen
            och välj ”Bryt kedjan här” uppe till vänster. Ångra tar tillbaka båda.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Textstorlek för DET HÄR objektet (faktor på nodens etikett).
 *
 * Reglaget i panelen till vänster skalar all text i hela diagrammet; det här
 * gäller ett objekt. Ett långt rollnamn kan behöva krympas utan att resten av
 * bilden blir finstilt – det gick inte att göra alls förut.
 */
function Textstorlek({
  draft,
  nodeId,
  onChange,
}: {
  draft: ProcessDraft;
  nodeId: string;
  onChange: (nästa: ProcessDraft) => void;
}) {
  const nu = textSizeFor(draft, nodeId);
  const sätt = (v: number | null) => onChange(setTextSize(draft, nodeId, v));
  return (
    <div className="ark-ap-satgrupp">
      <div className="ark-section-title">Textstorlek</div>
      <div className="ark-ap-textstorlek">
        <button
          className="ark-btn ark-btn--icon"
          title="Mindre text på det här objektet"
          disabled={nu <= 0.5}
          onClick={() => sätt(Math.round((nu - 0.1) * 10) / 10)}
        >
          A−
        </button>
        <span className="ark-ap-textstorlek-varde">{Math.round(nu * 100)} %</span>
        <button
          className="ark-btn ark-btn--icon"
          title="Större text på det här objektet"
          disabled={nu >= 2}
          onClick={() => sätt(Math.round((nu + 0.1) * 10) / 10)}
        >
          A+
        </button>
        <button className="ark-linkbtn" disabled={nu === 1} onClick={() => sätt(null)}>
          Återställ
        </button>
      </div>
    </div>
  );
}

function Huvud({ titel, onClose }: { titel: string; onClose: () => void }) {
  return (
    <div className="ark-ap-inspektor-huvud">
      <strong>{titel}</strong>
      <button className="ark-btn ark-btn--icon" onClick={onClose} title="Stäng">
        ×
      </button>
    </div>
  );
}
