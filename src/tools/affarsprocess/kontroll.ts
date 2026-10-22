/**
 * Affärsprocesskontrollen (fas 6) – motsvarigheten till flödesschemats BPMN-kontroll.
 *
 * Granskar ApModellen mot modelleringsreglerna och säger VAD som brister och
 * VAR, i klartext. Kontrollen är rådgivande: den hindrar aldrig ritning
 * eller export – precis som banhöjderna är diagrammet användarens, systemet
 * får bara påpeka.
 *
 * Reglerna:
 *  - varje aktivitet ska ha en roll eller intressent som UTFÖR (HUKI),
 *  - aktiviteter benämns verb + substantiv och bör ha en beskrivning,
 *  - en regel formuleras som en FRÅGA och svaren står på relationerna,
 *  - förädlingskedjan är VO → aktivitet → VO – två aktiviteter i direkt
 *    följd betyder att ett förädlingsresultat saknas.
 */

import type { ApModel } from "@/core/affarsprocess";
import type { ProcessDraft } from "@/core/draft";

export type ApAnmärkningsId =
  | "roll-saknas"
  | "beskrivning-saknas"
  | "regel-utan-fraga"
  | "svar-saknas"
  | "kedja-bruten"
  | "namn-utan-objekt"
  | "objekt-utan-ursprung"
  | "okopplad";

export interface ApAnmärkning {
  id: ApAnmärkningsId;
  /** Objektet anmärkningen gäller – klick i panelen markerar det på ytan. */
  nodId: string;
  text: string;
  /** varning = bryter mot modelleringsreglerna, info = rekommendation. */
  allvar: "varning" | "info";
}

export function granskaAp(model: ApModel, draft?: ProcessDraft): ApAnmärkning[] {
  const ut: ApAnmärkning[] = [];
  const nodAv = new Map(model.nodes.map((n) => [n.id, n]));

  // HUKI-relationer in per aktivitet (roll/intressent → aktiviteten).
  const harHuki = new Set(
    model.relations.filter((r) => r.kind === "huki").map((r) => r.target),
  );

  // Ett forum i kedjan ("i stället för en aktivitet") kräver också en
  // beskrivning – forum hör till objekten som ska ha en. Satellitforum rörs
  // inte: de ligger utanför kedjan.
  const iKedjan = new Set(
    model.relations.filter((r) => r.kind === "flode").flatMap((r) => [r.source, r.target]),
  );
  for (const n of model.nodes) {
    if (n.kind === "forum" && iKedjan.has(n.id) && !n.harBeskrivning) {
      ut.push({
        id: "beskrivning-saknas",
        nodId: n.id,
        text: `Forumet "${n.label}" saknar beskrivning ("i"-ikonen). Varje forum ska ha en beskrivning.`,
        allvar: "info",
      });
    }
    if (n.kind === "aktivitet") {
      if (!harHuki.has(n.id)) {
        ut.push({
          id: "roll-saknas",
          nodId: n.id,
          text: `"${n.label}" saknar roll eller intressent – vem utför aktiviteten? Lägg till med [Roll: … U] eller i panelen.`,
          allvar: "varning",
        });
      }
      if (!n.harBeskrivning) {
        ut.push({
          id: "beskrivning-saknas",
          nodId: n.id,
          text: `"${n.label}" saknar beskrivning ("i"-ikonen). Varje aktivitet ska ha en beskrivning.`,
          allvar: "info",
        });
      }
      // Verb + substantiv: ett ensamt ord har inget objekt ("Utred" → av vad?).
      if (!/\s/.test(n.label.trim())) {
        ut.push({
          id: "namn-utan-objekt",
          nodId: n.id,
          text: `"${n.label}" bör namnges verb + substantiv ("${n.label} ärende" e.d.) – då kan också ett förädlingsresultat föreslås.`,
          allvar: "info",
        });
      }
    }

    if (n.kind === "regel") {
      if (!n.label.trim().endsWith("?")) {
        ut.push({
          id: "regel-utan-fraga",
          nodId: n.id,
          text: `Regeln "${n.label}" är inte formulerad som en fråga. Skriv om den så att svaren på relationerna ger mening.`,
          allvar: "varning",
        });
      }
      for (const r of model.relations) {
        if (r.kind !== "flode" || r.source !== n.id) continue;
        if (!r.label?.trim()) {
          const mål = nodAv.get(r.target);
          ut.push({
            id: "svar-saknas",
            nodId: n.id,
            text: `Relationen från "${n.label}" till "${mål?.label ?? r.target}" saknar svar (t.ex. Ja/Nej).`,
            allvar: "varning",
          });
        }
      }
    }
  }

  // Förädlingskedjan: Flöde aktivitet → aktivitet utan VO emellan. Har
  // användaren UTTRYCKLIGEN valt bort ut-objektet (ap.output = null) är det
  // ett beslut, inte en brist – då tiger kontrollen (samma princip som
  // banhöjderna: systemet råder, användaren bestämmer).
  for (const r of model.relations) {
    if (r.kind !== "flode") continue;
    const a = nodAv.get(r.source);
    const b = nodAv.get(r.target);
    const utför = (k: string | undefined) => k === "aktivitet" || k === "forum";
    if (utför(a?.kind) && utför(b?.kind)) {
      const bortvalt = draft?.steps.find((s) => s.id === r.source)?.ap?.output === null;
      if (bortvalt) continue;
      ut.push({
        id: "kedja-bruten",
        nodId: r.source,
        text: `Inget verksamhetsobjekt mellan "${a.label}" och "${b.label}" – vad är förädlingsresultatet? Sätt ett ut-objekt i panelen eller [Ut: …] i texten.`,
        allvar: "info",
      });
    }
  }

  // Verksamhetsobjekt som uppstår ur tomma intet MITT i kedjan. Ett objekt
  // utan koppling in är helt i sin ordning när det är processens ingång eller
  // kommer utifrån – men får aktiviteten REDAN ett objekt ur kedjan är det
  // andra objektet nästan alltid ett [In: …] som borde ha varit ett [Ut: …]
  // på steget som skapar det. Rådet, inte spärren: kommer objektet verkligen
  // utifrån är texten som den ska och kontrollen har fel.
  {
    const inFlöden = model.relations.filter((r) => r.kind === "flode");
    const harIn = new Set(inFlöden.map((r) => r.target));
    for (const n of model.nodes) {
      if (n.kind !== "vo" || harIn.has(n.id)) continue;
      for (const r of inFlöden) {
        if (r.source !== n.id) continue;
        const mål = nodAv.get(r.target);
        if (!mål || mål.kind !== "aktivitet") continue;
        // Har målet fler inkommande objekt än det här?
        const andra = inFlöden.filter((x) => x.target === mål.id && x.source !== n.id);
        if (!andra.length) continue;
        ut.push({
          id: "objekt-utan-ursprung",
          nodId: n.id,
          text: `"${n.label}" har ingen koppling in, och "${mål.label}" får redan ett objekt ur kedjan. Kommer objektet utifrån processen är det rätt – annars sätt det som [Ut: …] på steget som skapar det.`,
          allvar: "info",
        });
        break;
      }
    }
  }

  // Fria objekt (utplacerade från paletten) som inte knutits in med en pil.
  const kopplade = new Set(model.relations.flatMap((r) => [r.source, r.target]));
  for (const f of draft?.apFria ?? []) {
    if (kopplade.has(f.id)) continue;
    const nod = model.nodes.find((n) => n.id === f.id);
    ut.push({
      id: "okopplad",
      nodId: f.id,
      text: `"${nod?.label ?? f.namn}" är inte kopplad till något – dra en pil till en aktivitet för att knyta in objektet.`,
      allvar: "info",
    });
  }

  return ut;
}

/** Kort sammanfattning för kontrollknappen. */
export function sammanfattaKontroll(anmärkningar: ApAnmärkning[]): string {
  const varningar = anmärkningar.filter((a) => a.allvar === "varning").length;
  const infon = anmärkningar.length - varningar;
  if (anmärkningar.length === 0) return "Affärsprocesskontroll: OK";
  const delar: string[] = [];
  if (varningar) delar.push(`${varningar} varning${varningar === 1 ? "" : "ar"}`);
  if (infon) delar.push(`${infon} råd`);
  return `Affärsprocesskontroll: ${delar.join(" · ")}`;
}
