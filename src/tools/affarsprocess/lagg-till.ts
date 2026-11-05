/**
 * Palettens placerings- och inknytningslogik.
 *
 * PLACERING: ett objekt från paletten blir ett FRITT objekt – det läggs var
 * som helst på ytan och får INGEN koppling alls. (Tidigare kedjades en ny
 * aktivitet in direkt, vilket ritade om flödet – det såg ut som att andra
 * objekt försvann.)
 *
 * INKNYTNING: först när användaren drar en pil knyts objektet in – och då
 * KONVERTERAS det till sin riktiga form i mellanlagret:
 *   - fri roll/intressent/IT-stöd/krav/… + aktivitet → satellit i stegets
 *     ap-block (positionen följer med till det nya stabila id:t),
 *   - fritt VO:  steg → VO ger stegets UT-objekt, VO → steg ger IN-objekt,
 *   - fri aktivitet/regel + steg → ett riktigt kedjesteg intill steget,
 *   - allt annat (steg ↔ steg, fri ↔ fri) → en manuellt dragen koppling
 *     (extraEdges), precis som i flödesschemat.
 *
 * Rena funktioner över mellanlagret – allt kompileras, granskas, sparas och
 * ångras som vanligt.
 */

import {
  satellitId,
  setStepAp,
  sättInobjekt,
  sättUtobjekt,
  voId,
  voInId,
  type ApNodeKind,
} from "@/core/affarsprocess";
import {
  addManualEdge,
  addStepAfter,
  nextStepId,
  setAutoPosition,
  setStepPosition,
  laneDefaultPerspectives,
  normalizeOrder,
  removeEdge,
  removeStep,
  type ApStegInfo,
  type Huki,
  type ProcessDraft,
} from "@/core/draft";

export interface TillagtObjekt {
  draft: ProcessDraft;
  /** Nod-id för det nya objektet – markeras så inspektören öppnas för namnbyte. */
  nodId: string | null;
}

/** Standardnamn per objekttyp – döps om direkt i inspektören. */
const NAMN: Partial<Record<ApNodeKind, string>> = {
  aktivitet: "Ny aktivitet",
  regel: "Ny fråga?",
  vo: "Nytt objekt",
  roll: "Ny roll",
  intressent: "Ny intressent",
  applikation: "Nytt IT-stöd",
  arkiv: "Nytt arkiv",
  krav: "Nytt krav",
  tid: "Ny tid",
  forum: "Nytt forum",
  plats: "Ny plats",
  problem: "Nytt problem",
  risk: "Ny risk",
  mojlighet: "Ny möjlighet",
};

/** Nästa lediga fria id (fri_1, fri_2 …). Lagras vid skapandet – härleds aldrig om. */
function nästaFriaId(draft: ProcessDraft): string {
  let max = 0;
  for (const f of draft.apFria ?? []) {
    const m = f.id.match(/^fri_(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `fri_${max + 1}`;
}

/** Unikt namn inom en lista – två "Ny roll" på samma ankare ger samma id. */
function unikt(bas: string, upptagna: string[]): string {
  if (!upptagna.includes(bas)) return bas;
  let i = 2;
  while (upptagna.includes(`${bas} ${i}`)) i++;
  return `${bas} ${i}`;
}

/**
 * Placerar ett objekt från paletten som ett FRITT objekt på (x, y).
 * Ingen koppling, inget ankare – inknytning sker med en pil (knytIhop).
 */
export function läggTillObjekt(
  draft: ProcessDraft,
  kind: ApNodeKind,
  /** Placeringen i FRIA layoutens koordinater. */
  pos: { x: number; y: number },
): TillagtObjekt {
  const id = nästaFriaId(draft);
  const nästa: ProcessDraft = {
    ...draft,
    apFria: [...(draft.apFria ?? []), { id, kind, namn: NAMN[kind] ?? "Nytt objekt" }],
    meta: { ...draft.meta, origin: "manual" },
  };
  return { draft: setAutoPosition(nästa, id, pos), nodId: id };
}

/** Byter namn på ett fritt objekt. Id:t är lagrat, så inget migreras. */
export function bytFriNamn(draft: ProcessDraft, friId: string, namn: string): ProcessDraft {
  const trimmat = namn.trim();
  if (!trimmat) return draft;
  return {
    ...draft,
    apFria: (draft.apFria ?? []).map((f) => (f.id === friId ? { ...f, namn: trimmat } : f)),
    meta: { ...draft.meta, origin: "manual" },
  };
}

/** Tar bort ett fritt objekt (och dess sparade position). */
export function taBortFri(draft: ProcessDraft, friId: string): ProcessDraft {
  const autoPositions = { ...draft.autoPositions };
  delete autoPositions[friId];
  return {
    ...draft,
    apFria: (draft.apFria ?? []).filter((f) => f.id !== friId),
    autoPositions,
    meta: { ...draft.meta, origin: "manual" },
  };
}

/**
 * Tar bort objekt ur processen: fria objekt ur paletten och KEDJESTEG
 * (aktivitet, regel, forum, händelse) – även steg som AI:n eller regelparsern
 * tolkat fram. Ett kedjesteg tar med sig sina satelliter och verksamhetsobjekt
 * (de bor i stegets ap-block), och kedjan sluts över luckan: s2 → s3 → s4 blir
 * s2 → s4. Vill man BRYTA kedjan tar man bort pilen (`taBortKedjepil`).
 *
 * Andra id:n (satelliter, verksamhetsobjekt, auto-slut) rörs inte – de tas
 * bort i sin aktivitets panel. EN draft ut, så ångra tar allt i ett steg.
 */
export function taBortObjekt(draft: ProcessDraft, ids: readonly string[]): ProcessDraft {
  const fria = new Set((draft.apFria ?? []).map((f) => f.id));
  const steg = new Set(draft.steps.map((s) => s.id));
  let d = draft;
  for (const id of ids) {
    if (fria.has(id)) d = taBortFri(d, id);
    else if (steg.has(id)) d = taBortSteg(d, id);
  }
  return d;
}

/** Kan objektet tas bort med `taBortObjekt`? */
export function kanTaBort(draft: ProcessDraft, id: string): boolean {
  return (draft.apFria ?? []).some((f) => f.id === id) || draft.steps.some((s) => s.id === id);
}

function taBortSteg(draft: ProcessDraft, stegId: string): ProcessDraft {
  const utan = removeStep(draft, stegId);
  // Handritade pilar till steget eller dess verksamhetsobjekt pekar annars ut
  // i tomma luften – kompileringen hade fått en kant utan nod.
  const rör = (n: string) => n === stegId || n === voId(stegId) || n === voInId(stegId);
  const extra = (utan.extraEdges ?? []).filter((e) => !rör(e.source) && !rör(e.target));
  return {
    ...utan,
    extraEdges: extra.length ? extra : undefined,
    fria: utan.fria?.filter((id) => id !== stegId),
  };
}

/**
 * Bryter kedjan: tar bort pilen mellan två steg. En härledd kedjepil
 * undertrycks (`removedEdges`), en handritad raderas – samma regel som i
 * flödesschemat (`removeEdge`). Etiketten skiljer Ja från Nej (invariant 3).
 */
export function taBortKedjepil(
  draft: ProcessDraft,
  kant: { source: string; target: string; label?: string },
): ProcessDraft {
  return removeEdge(draft, kant.source, kant.target, kant.label);
}

/**
 * Lägger en ny aktivitet i kedjan DIREKT efter ett steg: s2 → s3 blir
 * s2 → ny → s3. Är steget en regel hamnar den nya aktiviteten efter regelns
 * grenar, alltså där flödet fortsätter. Samma bana och samma gren som steget.
 * Id:t är nästa lediga steg-id och lagras (invariant 2).
 */
export function läggTillAktivitetEfter(draft: ProcessDraft, stegId: string): TillagtObjekt {
  const ordnad = normalizeOrder(draft);
  const steg = ordnad.steps.find((s) => s.id === stegId);
  if (!steg) return { draft, nodId: null };
  // Hoppa förbi stegets grenar (och deras grenar) – de hör till steget.
  const block = new Set([stegId]);
  let sista = stegId;
  for (const s of ordnad.steps.slice(ordnad.steps.indexOf(steg) + 1)) {
    if (!s.branchOf || !block.has(s.branchOf.stepId)) break;
    block.add(s.id);
    sista = s.id;
  }
  const id = nextStepId(ordnad);
  const nästa = addStepAfter(ordnad, sista, {
    type: "activity",
    text: NAMN.aktivitet ?? "Ny aktivitet",
    laneId: steg.laneId,
    branchOf: steg.branchOf,
  });
  return { draft: nästa, nodId: id };
}

const SATELLITER: ReadonlySet<string> = new Set([
  "roll",
  "intressent",
  "applikation",
  "arkiv",
  "krav",
  "tid",
  "forum",
  "plats",
  "problem",
  "risk",
  "mojlighet",
]);

/**
 * Flyttar en sparad position från ett id till ett annat (om en finns) – och
 * kravets rutin, som är nycklad på samma id och annars blev kvar på det fria
 * objekt som inte längre finns.
 */
function flyttaPosition(draft: ProcessDraft, från: string, till: string): ProcessDraft {
  const sparad = draft.autoPositions?.[från];
  let nästa = setAutoPosition(draft, från, null);
  if (sparad) nästa = setAutoPosition(nästa, till, sparad);
  const rutin = nästa.apRutiner?.[från];
  if (rutin) {
    const apRutiner = { ...nästa.apRutiner, [till]: rutin };
    delete apRutiner[från];
    nästa = { ...nästa, apRutiner };
  }
  return nästa;
}

/**
 * Knyter ihop två objekt med en pil. Är någon ände ett FRITT objekt
 * konverteras det till sin riktiga form; annars blir det en manuell koppling.
 */
export function knytIhop(draft: ProcessDraft, source: string, target: string): ProcessDraft {
  const fria = new Map((draft.apFria ?? []).map((f) => [f.id, f]));
  const sFri = fria.get(source);
  const tFri = fria.get(target);
  const fri = sFri ?? tFri;
  const stegId = sFri ? target : source;
  const steg = draft.steps.find((s) => s.id === stegId);

  // Ingen fri ände, eller andra änden är inget steg (fri↔fri, steg↔VO osv):
  // en manuellt dragen koppling, precis som i flödesschemat.
  if (!fri || (sFri && tFri) || !steg) {
    return addManualEdge(draft, source, target);
  }

  const kind = fri.kind as ApNodeKind;

  // ---- Fri satellit + steg → in i stegets ap-block.
  if (SATELLITER.has(kind)) {
    const ap: ApStegInfo = { ...steg.ap };
    let namn = fri.namn;
    if (kind === "roll") ap.roller = [...(ap.roller ?? []), { namn: (namn = unikt(namn, (ap.roller ?? []).map((r) => r.namn))), huki: "U" as Huki }];
    else if (kind === "intressent") ap.intressenter = [...(ap.intressenter ?? []), { namn: (namn = unikt(namn, (ap.intressenter ?? []).map((r) => r.namn))), huki: "I" as Huki }];
    else if (kind === "applikation") ap.applikationer = [...(ap.applikationer ?? []), (namn = unikt(namn, ap.applikationer ?? []))];
    else if (kind === "arkiv") ap.arkiv = [...(ap.arkiv ?? []), (namn = unikt(namn, ap.arkiv ?? []))];
    else if (kind === "krav") ap.krav = [...(ap.krav ?? []), (namn = unikt(namn, ap.krav ?? []))];
    else if (kind === "problem") ap.problem = [...(ap.problem ?? []), (namn = unikt(namn, ap.problem ?? []))];
    else if (kind === "risk") ap.risker = [...(ap.risker ?? []), (namn = unikt(namn, ap.risker ?? []))];
    else if (kind === "mojlighet") ap.mojligheter = [...(ap.mojligheter ?? []), (namn = unikt(namn, ap.mojligheter ?? []))];
    else if (kind === "tid" || kind === "forum" || kind === "plats") {
      // Envärdesfält: upptaget → objektet förblir fritt med en vanlig koppling
      // (ingen tyst överskrivning av ett namn användaren valt).
      if (ap[kind]) return addManualEdge(draft, source, target);
      ap[kind] = namn;
    }
    const nyttId = satellitId(kind, steg.id, namn);
    let nästa = setStepAp(draft, steg.id, ap);
    nästa = flyttaPosition(nästa, fri.id, nyttId);
    return taBortFri(nästa, fri.id);
  }

  // ---- Fritt VO + steg: riktningen avgör – steg → VO blir stegets
  // UT-objekt, VO → steg dess IN-objekt. Ett auto-FÖRSLAG räknas som ledigt
  // (ingen användartext skrivs över); ett explicit namngivet objekt är
  // upptaget. Är den föredragna platsen upptagen provas den andra; är båda
  // upptagna blir det en vanlig koppling i stället för tyst överskrivning.
  if (kind === "vo") {
    const utLedig = typeof steg.ap?.output !== "string";
    const inLedig = !steg.ap?.input;
    const föredraUt = !sFri; // pilen ritades steg → VO
    const riktning = föredraUt
      ? utLedig
        ? "ut"
        : inLedig
          ? "in"
          : null
      : inLedig
        ? "in"
        : utLedig
          ? "ut"
          : null;
    if (!riktning) return addManualEdge(draft, source, target);
    const nyttId = riktning === "ut" ? voId(steg.id) : voInId(steg.id);
    let nästa =
      riktning === "ut"
        ? sättUtobjekt(draft, steg.id, fri.namn)
        : sättInobjekt(draft, steg.id, fri.namn);
    nästa = flyttaPosition(nästa, fri.id, nyttId);
    return taBortFri(nästa, fri.id);
  }

  // ---- Fri aktivitet/regel + steg → ett riktigt kedjesteg intill steget.
  // Pil FRÅN steget: nya steget läggs efter det. Pil TILL steget: före det.
  // Grenen ärvs så steget stannar i samma scope.
  if (kind === "aktivitet" || kind === "regel") {
    const id = nextStepId(draft);
    const index = draft.steps.findIndex((s) => s.id === steg.id);
    const efterId = sFri
      ? (draft.steps[index - 1]?.id ?? null) // fri → steg: sätt in FÖRE steget
      : steg.id; // steg → fri: sätt in efter
    let nästa = addStepAfter(draft, efterId, {
      type: kind === "regel" ? "decision" : "activity",
      text: fri.namn,
      laneId: steg.laneId,
      branchOf: steg.branchOf,
      perspectives: laneDefaultPerspectives(steg.laneId),
    });
    const sparad = draft.autoPositions?.[fri.id];
    if (sparad) nästa = setStepPosition(nästa, id, sparad);
    nästa = setAutoPosition(nästa, fri.id, null);
    return taBortFri(nästa, fri.id);
  }

  return addManualEdge(draft, source, target);
}
