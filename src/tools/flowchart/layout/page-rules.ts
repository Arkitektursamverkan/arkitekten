/**
 * Regelgranskning av sidbrytningen – den mätbara sidan av
 * docs/sidbrytningsregler.md. Varje regel räknas på en FÄRDIG layout, så att
 * granskningen bedömer det som faktiskt ritas, inte det som var tänkt.
 *
 * Används av page-rules.test.ts (bryts en regel blir bygget rött) och av
 * scripts/granska-sidor.mts (rapport i klartext för produktägaren).
 */

import type { ProcessModel } from "@/core/model";
import { columnGeometry, computeRanks, scaledDims, type LayoutResult } from "./layout";

export interface Regelutfall {
  id: string;
  titel: string;
  ok: boolean;
  /** Konstaterade brott, i klartext. Tom när ok. */
  brott: string[];
  /** Uppmätta värden, för rapporten. */
  mätvärden: string[];
}

/** Minsta tillåtna fyllnadsgrad för en del som inte är den sista (R2). */
export const MIN_FYLLNAD = 0.55;
/** Största tillåtna tomrum under en banas innehåll (R6), i px vid skala 1. */
export const MAX_TOMLUFT = 60;

export function granskaSidor(model: ProcessModel, lo: LayoutResult): Regelutfall[] {
  /**
   * En TOM process har ingen sidindelning att bedöma.
   *
   * Regelverket handlar om var snitten läggs mellan objekt; utan objekt finns
   * varken snitt eller innehåll, och R1 slog larm om "del 1 är tom" för något
   * som bara var en process man ännu inte ritat i. Det blev verkligt när nya
   * processer började läggas in i biblioteket direkt när de skapas: en
   * nyskapad, tom process gjorde hela regelgranskningen röd.
   */
  if (lo.nodes.length === 0 && lo.dataStores.length === 0) return [];

  const ut: Regelutfall[] = [];
  const diag = lo.pageDiag;
  const delar = lo.pages.length;
  const sida = new Map(lo.nodes.map((n) => [n.node.id, n.page]));
  for (const ds of lo.dataStores) sida.set(ds.store.id, ds.page);

  // ---------- R1: dela bara när bredden kräver det ----------
  {
    const brott: string[] = [];
    const mät: string[] = [`${delar} del(ar)`];
    if (diag) {
      const rank = computeRanks(model);
      // Total kolumnbredd uppmätt ur den fria kolumngeometrin: bredaste
      // högerkant minus vänsterkant, per delarnas ursprungsintervall.
      const maxHöger = Math.max(0, ...lo.nodes.map((n) => n.x + n.w - n.dx));
      const minVänster = Math.min(...lo.nodes.map((n) => n.x - n.dx), Infinity);
      const totalBredd = maxHöger - Math.min(minVänster, maxHöger);
      const minsta = Math.max(1, Math.ceil(totalBredd / diag.contentW));
      mät.push(`total kolumnbredd ≈ ${Math.round(totalBredd)} px, innehållsbredd ${Math.round(diag.contentW)} px`);
      mät.push(`teoretiskt minimum ${minsta} del(ar), R3-motiverade extrasnitt: ${diag.tidigaSnitt}`);
      if (delar > minsta + diag.tidigaSnitt) {
        brott.push(`${delar} delar men ${minsta} + ${diag.tidigaSnitt} (R3) hade räckt.`);
      }
      void rank;
    }
    // En del utan ett enda objekt är alltid en del för mycket. Hände på riktigt
    // när användaren pinnade sista delens enda nod till en tidigare del: delen
    // blev kvar som en tom ruta med bara bantitlar.
    for (let i = 0; i < delar; i++) {
      const harInnehåll =
        lo.nodes.some((n) => n.page === i) || lo.dataStores.some((ds) => ds.page === i);
      if (!harInnehåll) brott.push(`del ${i + 1} är tom – inga objekt ligger på den.`);
    }
    ut.push({ id: "R1", titel: "Dela bara när bredden kräver det", ok: brott.length === 0, brott, mätvärden: mät });
  }

  // ---------- R2: packning ----------
  // Mäts på PLANERADE kolumner, inte ritade positioner: användaren får dra
  // objekt vart som helst (och krympa avstånden) utan att packningsregeln
  // felaktigt slår larm om "gles del".
  {
    const brott: string[] = [];
    const mät: string[] = [];
    if (diag && delar > 1) {
      const rank = computeRanks(model);
      const d = scaledDims(lo.scale);
      const { colX, colWidth } = columnGeometry(model, rank, d);
      // Kolumn → del via nodernas faktiska deltilldelning (pinnar exkluderade:
      // en pinnad nod säger inget om var kolumnen planerades).
      const kolDel = new Map<number, number>();
      for (const n of lo.nodes) {
        if (n.node.pagePin !== undefined) continue;
        const r = rank.get(n.node.id);
        if (r !== undefined && !kolDel.has(r)) kolDel.set(r, n.page);
      }
      for (let i = 0; i < delar; i++) {
        const kolumner = [...kolDel.entries()].filter(([, del]) => del === i).map(([r]) => r);
        if (!kolumner.length) continue;
        const vänster = Math.min(...kolumner.map((r) => colX[r]));
        const höger = Math.max(...kolumner.map((r) => colX[r] + colWidth[r]));
        const fyllnad = (höger - vänster) / diag.contentW;
        mät.push(`del ${i + 1}: fyllnad ${(fyllnad * 100).toFixed(0)} %`);
        if (i < delar - 1 && fyllnad < MIN_FYLLNAD && diag.tidigaSnitt === 0) {
          brott.push(`del ${i + 1} är bara ${(fyllnad * 100).toFixed(0)} % fylld utan R3-orsak.`);
        }
      }
    }
    ut.push({ id: "R2", titel: "Varje del är välfylld", ok: brott.length === 0, brott, mätvärden: mät });
  }

  // ---------- R3: gateway och NÄRMASTE grenhuvud hålls ihop ----------
  {
    const brott: string[] = [];
    const mät: string[] = [];
    if (diag && delar > 1) {
      const rank = computeRanks(model);
      for (const n of model.nodes) {
        if (n.type !== "decision") continue;
        const egenDel = sida.get(n.id);
        const rD = rank.get(n.id);
        if (egenDel === undefined || rD === undefined) continue;
        // Grenmål i kolumnen direkt intill gatewayn – de hör ihop med den.
        const nära = model.edges
          .filter((e) => e.source === n.id && rank.get(e.target) === rD + 1)
          .map((e) => e.target);
        for (const t of nära) {
          const målDel = sida.get(t);
          if (målDel === undefined || målDel === egenDel) continue;
          // Har användaren själv PINNAT någon av parterna till en annan del är
          // separationen ett medvetet val, inte motorns – regeln dömer bara
          // motorn (samma princip som R6:s undantag för flyttade objekt).
          if (n.pagePin !== undefined || model.nodes.find((x) => x.id === t)?.pagePin !== undefined)
            continue;
          const bredd = spannbredd(lo, [n.id, t]);
          mät.push(`"${n.label}" + intilliggande gren: ${Math.round(bredd)} px, innehållsbredd ${Math.round(diag.contentW)} px`);
          if (bredd <= diag.contentW) {
            brott.push(
              `"${n.label}" (del ${egenDel + 1}) skiljs från sitt närmaste grenhuvud (del ${målDel + 1}) trots att paret ryms.`,
            );
          }
        }
      }
    }
    ut.push({ id: "R3", titel: "Gateway skiljs inte från sin gren", ok: brott.length === 0, brott, mätvärden: mät });
  }

  // ---------- R4: flödet läser alltid framåt ----------
  {
    const brott: string[] = [];
    let korsande = 0;
    const pinnad = new Map(model.nodes.map((n) => [n.id, n.pagePin]));
    for (const e of model.edges) {
      const a = sida.get(e.source);
      const b = sida.get(e.target);
      if (a === undefined || b === undefined || a === b) continue;
      korsande++;
      // En bakåtpil som beror på att användaren PINNAT en ände till en annan
      // del är hans val – motorn ändrar aldrig deltillhörighet av ett drag,
      // men ett medvetet delbyte får peka hur användaren vill.
      if (pinnad.get(e.source) !== undefined || pinnad.get(e.target) !== undefined) continue;
      if (b < a) brott.push(`${e.source} (del ${a + 1}) → ${e.target} (del ${b + 1}) pekar BAKÅT.`);
    }
    ut.push({
      id: "R4",
      titel: "Flödet läser alltid framåt",
      ok: brott.length === 0,
      brott,
      mätvärden: [`${korsande} koppling(ar) korsar ett snitt`],
    });
  }

  // ---------- R5: läsbar skarv ----------
  {
    const brott: string[] = [];
    const refs = lo.pageRefs;
    const överlappar = (
      p: { x: number; y: number; w: number; h: number },
      q: { x: number; y: number; w: number; h: number },
    ) => p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y;
    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) {
        if (refs[i].page !== refs[j].page) continue;
        if (överlappar(refs[i], refs[j])) {
          brott.push(`märkena "${refs[i].text}" och "${refs[j].text}" överlappar på del ${refs[i].page + 1}.`);
        }
      }
      for (const n of lo.nodes) {
        if (n.page !== refs[i].page) continue;
        if (överlappar(refs[i], n)) {
          brott.push(`märket "${refs[i].text}" ligger ovanpå "${n.node.label}" (del ${n.page + 1}).`);
        }
      }
    }
    // Etikett i skarven: varje kapad kant med etikett ska ha den i något märke.
    for (const e of model.edges) {
      const a = sida.get(e.source);
      const b = sida.get(e.target);
      if (a === undefined || b === undefined || a === b || !e.label) continue;
      if (e.hideRefIn && e.hideRefOut) continue; // medvetet dolda
      const finns = refs.some(
        (r) => r.edgeSource === e.source && r.edgeTarget === e.target && r.text.includes(e.label!),
      );
      if (!finns) brott.push(`etiketten "${e.label}" på ${e.source}→${e.target} saknas i skarven.`);
    }
    ut.push({
      id: "R5",
      titel: "Hänvisningsmärken kolliderar inte",
      ok: brott.length === 0,
      brott,
      mätvärden: [`${refs.length} märken`],
    });
  }

  // ---------- R6: ingen tom luft ----------
  {
    const brott: string[] = [];
    const manuellaBanor = new Set(
      model.swimlanes.filter((l) => (l.height ?? 0) > 0).map((l) => l.id),
    );
    const perDel = new Map(model.swimlanes.map((l) => [l.id, l.pageHeights]));
    for (const l of lo.lanes) {
      if (manuellaBanor.has(l.id)) continue;
      // En PER-DEL-höjd är användarens val på just den delen – utanför regeln.
      if (perDel.get(l.id)?.[l.page] !== undefined) continue;
      const egna = [
        ...lo.nodes.filter((n) => n.node.laneId === l.id && n.page === l.page),
        ...lo.dataStores.filter((ds) => ds.store.laneId === l.id && ds.page === l.page),
      ];
      // Manuellt FLYTTADE objekt äger geometrin i sin bana på sin del: har
      // användaren dragit ihop innehållet på en egen rad är luften under ett
      // resultat av det valet, inte av motorns utlägg. Regeln dömer bara
      // motorn – samma princip som R2, som mäter planerade kolumner i stället
      // för dragna positioner.
      if (
        lo.nodes.some((n) => n.node.laneId === l.id && n.page === l.page && n.node.position) ||
        lo.dataStores.some((ds) => ds.store.laneId === l.id && ds.page === l.page && ds.store.position)
      ) {
        continue;
      }
      if (!egna.length) {
        if (l.h > l.headerH + 1) brott.push(`tom bana ${l.id} på del ${l.page + 1} är ${Math.round(l.h)} px hög.`);
        continue;
      }
      const botten = Math.max(...egna.map((o) => o.y + o.h));
      const tomrum = l.y + l.h - botten;
      if (tomrum > MAX_TOMLUFT * lo.scale + 1) {
        brott.push(`${l.id} på del ${l.page + 1} har ${Math.round(tomrum)} px tom luft under innehållet.`);
      }
    }
    ut.push({ id: "R6", titel: "Ingen tom luft i banorna", ok: brott.length === 0, brott, mätvärden: [] });
  }

  return ut;
}

/** Bredd (px) på det minsta x-intervall som omsluter noderna, i fria koordinater. */
function spannbredd(lo: LayoutResult, ids: string[]): number {
  const set = new Set(ids);
  const träffar = lo.nodes.filter((n) => set.has(n.node.id));
  if (!träffar.length) return 0;
  const vänster = Math.min(...träffar.map((n) => n.x - n.dx));
  const höger = Math.max(...träffar.map((n) => n.x + n.w - n.dx));
  return höger - vänster;
}

/** Klartextrapport för terminal och tester. */
export function rapportSomText(utfall: Regelutfall[]): string {
  return utfall
    .map((r) => {
      const rader = [`${r.ok ? "PASS" : "FAIL"}  ${r.id} – ${r.titel}`];
      for (const m of r.mätvärden) rader.push(`        ${m}`);
      for (const b of r.brott) rader.push(`   !!   ${b}`);
      return rader.join("\n");
    })
    .join("\n");
}
