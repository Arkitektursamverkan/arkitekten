/**
 * Mallen: en ifyllbar tabell som blir ett flöde.
 *
 * Fritexten går genom regelmotorn, som GISSAR bana och typ ur orden. Det
 * fungerar bra för en snabb skiss men går inte att styra: skriver man något
 * reglerna inte känner igen hamnar steget i fel bana. Mallen är motsatsen –
 * varje rad säger uttryckligen vilken bana och vilken typ som gäller, och
 * ingenting härleds.
 *
 * Modulen är ren: rader in, ProcessDraft ut. Ingen React, inga sidoeffekter.
 * Det gör att reglerna för vad som är en giltig mall kan testas för sig.
 */

import { emptyDraft, makeLane, type DraftStep, type ProcessDraft } from "./draft";
import { portalbana } from "./organisation";
import type { GatewayKind, NodeType, Swimlane } from "./model";

/**
 * FÖRSLAG på banor – inte en fast lista.
 *
 * Simbanorna är olika från flöde till flöde: de är de deltagare och system som
 * just det här flödet handlar om. Att låsa dem till en uppsättning vore att
 * påstå att alla processer ser likadana ut. Förslagen finns bara för att man
 * inte ska behöva skriva de vanligaste för hand varje gång.
 */
export const banförslag = (): string[] => [
  "Användare",
  portalbana(),
  "SharePoint",
  "Power Automate",
  "Integrationer",
  "Kommunikationsmedel",
  "Handläggare",
  "Ekonomi",
  "Leverantör",
];

/** Typerna mallen erbjuder, med förklaring – det är förklaringen som gör rätt lätt. */
export const MALL_TYPER: { typ: NodeType; namn: string; hjälp: string }[] = [
  { typ: "start", namn: "Start", hjälp: "Det som sätter igång flödet" },
  { typ: "activity", namn: "Aktivitet", hjälp: "Något en människa gör" },
  { typ: "system", namn: "System", hjälp: "Något ett system gör automatiskt" },
  { typ: "decision", namn: "Beslut", hjälp: "En fråga med två svar – ger grenar" },
  { typ: "notification", namn: "Notifiering", hjälp: "Ett meddelande som skickas till någon" },
  { typ: "integration", namn: "Integration", hjälp: "Anrop till ett annat system, API" },
  { typ: "datastore", namn: "Datalager", hjälp: "Något som lagras – lista, post, logg" },
  { typ: "end", namn: "Slut", hjälp: "Flödet är klart" },
];

/** En rad i mallen. */
export interface MallRad {
  id: string;
  text: string;
  bana: string;
  typ: NodeType;
  /**
   * Mottagare för en notifiering, t.ex. "handläggaren". Ger ett
   * meddelandeflöde ut till en egen deltagare i diagrammet.
   */
  mottagare?: string;
  /**
   * Grenar under ett beslut. Bara meningsfullt när typ = "decision".
   * Varje gren har en etikett ("Ja"/"Nej") och sina egna rader.
   */
  grenar?: MallGren[];
}

export interface MallGren {
  id: string;
  etikett: string;
  rader: MallRad[];
}

export interface Mall {
  titel: string;
  underrubrik: string;
  /** Flödets egna simbanor, i ordning uppifrån och ned. */
  banor: string[];
  rader: MallRad[];
}

export function tomMall(): Mall {
  // Två banor från början: en tom mall utan banor gör radernas val meningslösa,
  // och namnen är uppenbart utbytbara.
  const banor = ["Användare", "System"];
  return {
    titel: "",
    underrubrik: "",
    banor,
    rader: [nyRad("r1", "start", banor[0]), nyRad("r2", "activity", banor[0])],
  };
}

export function nyRad(id: string, typ: NodeType = "activity", bana = ""): MallRad {
  return { id, text: "", bana, typ };
}

/**
 * Byter namn på en bana och tar med sig raderna som använder den.
 * Utan det pekar raderna på ett namn som inte längre finns.
 */
export function döpOmBana(mall: Mall, från: string, till: string): Mall {
  const gå = (rader: MallRad[]): MallRad[] =>
    rader.map((r) => ({
      ...r,
      bana: r.bana === från ? till : r.bana,
      grenar: r.grenar?.map((g) => ({ ...g, rader: gå(g.rader) })),
    }));
  return {
    ...mall,
    banor: mall.banor.map((b) => (b === från ? till : b)),
    rader: gå(mall.rader),
  };
}

/** Tar bort en bana och flyttar dess rader till den första kvarvarande. */
export function taBortBana(mall: Mall, namn: string): Mall {
  const kvar = mall.banor.filter((b) => b !== namn);
  if (!kvar.length) return mall; // minst en bana måste finnas
  const gå = (rader: MallRad[]): MallRad[] =>
    rader.map((r) => ({
      ...r,
      bana: r.bana === namn ? kvar[0] : r.bana,
      grenar: r.grenar?.map((g) => ({ ...g, rader: gå(g.rader) })),
    }));
  return { ...mall, banor: kvar, rader: gå(mall.rader) };
}

export function nyGren(id: string, etikett: string): MallGren {
  return { id, etikett, rader: [nyRad(`${id}s1`)] };
}

/* -------------------------------------------------------------------- */
/* Validering                                                           */
/* -------------------------------------------------------------------- */

export interface MallProblem {
  /** Radens id, eller null när problemet gäller mallen som helhet. */
  radId: string | null;
  text: string;
}

/**
 * Vad som saknas för att mallen ska gå att rita.
 *
 * Meddelandena säger vad man ska GÖRA, inte vad som är fel. "Ge steget en
 * text" är användbart; "text saknas" är det inte.
 */
export function granskaMall(mall: Mall): MallProblem[] {
  const problem: MallProblem[] = [];
  if (!mall.titel.trim()) problem.push({ radId: null, text: "Ge flödet en titel." });

  const banor = mall.banor.map((b) => b.trim()).filter(Boolean);
  if (!banor.length) problem.push({ radId: null, text: "Lägg till minst en simbana." });
  if (new Set(banor).size !== banor.length) {
    problem.push({ radId: null, text: "Två simbanor har samma namn." });
  }
  if (mall.banor.some((b) => !b.trim())) {
    problem.push({ radId: null, text: "En simbana saknar namn." });
  }

  const alla = allaRader(mall);
  if (!alla.length) problem.push({ radId: null, text: "Lägg till minst ett steg." });
  for (const r of alla) {
    if (!r.text.trim()) problem.push({ radId: r.id, text: "Skriv vad som händer i steget." });
    if (!banor.includes(r.bana)) {
      problem.push({ radId: r.id, text: "Välj vilken simbana steget hör till." });
    }
    if (r.typ === "notification" && !r.mottagare?.trim()) {
      problem.push({ radId: r.id, text: "Ange vem notifieringen går till." });
    }
    if (r.typ === "decision") {
      const grenar = r.grenar ?? [];
      if (grenar.length < 2) {
        problem.push({ radId: r.id, text: "Ett beslut behöver två grenar – t.ex. Ja och Nej." });
      }
      for (const g of grenar) {
        if (!g.etikett.trim()) problem.push({ radId: r.id, text: "Ge varje gren en etikett." });
        if (!g.rader.length) problem.push({ radId: r.id, text: `Grenen "${g.etikett}" är tom.` });
      }
    }
  }
  if (!alla.some((r) => r.typ === "start")) {
    problem.push({ radId: null, text: "Markera vilket steg som startar flödet." });
  }
  return problem;
}

/** Alla rader, även de som ligger i grenar. */
export function allaRader(mall: Mall): MallRad[] {
  const ut: MallRad[] = [];
  const gå = (rader: MallRad[]) => {
    for (const r of rader) {
      ut.push(r);
      for (const g of r.grenar ?? []) gå(g.rader);
    }
  };
  gå(mall.rader);
  return ut;
}

/* -------------------------------------------------------------------- */
/* Mall -> mellanlager                                                  */
/* -------------------------------------------------------------------- */

/** En beslutsrad blir en exklusiv gateway; övriga typer har ingen gateway. */
function gateway(typ: NodeType): GatewayKind | undefined {
  return typ === "decision" ? "exclusive" : undefined;
}

/**
 * Bygger ett mellanlager ur mallen.
 *
 * Stegen får `sourceIndex: -1` – de kommer inte ur någon källtext, och
 * spårbarhets-inspektören ska inte påstå något annat. `sourceText` sätts till
 * radens egen text så att inspektören ändå kan visa varifrån steget kom.
 */
export function mallTillDraft(mall: Mall): ProcessDraft {
  const draft = emptyDraft();
  draft.title = mall.titel.trim();
  draft.subtitle = mall.underrubrik.trim() || undefined;
  draft.meta.origin = "manual";
  draft.meta.sourceText = mallSomText(mall);

  // Banordningen är den som satts i mallen – inte den ordning de råkar
  // användas i. Det är mallens författare som bestämmer vem som ligger överst.
  const banor = new Map<string, Swimlane>();
  for (const namn of mall.banor.map((b) => b.trim()).filter(Boolean)) {
    if (!banor.has(namn)) banor.set(namn, makeLane(namn, banor.size));
  }
  const stegFör = (r: MallRad, branchOf?: DraftStep["branchOf"]): DraftStep => {
    if (!banor.has(r.bana)) banor.set(r.bana, makeLane(r.bana, banor.size));
    return {
      id: r.id,
      type: r.typ,
      text: r.text.trim(),
      laneId: r.bana,
      gateway: gateway(r.typ),
      branchOf,
      sourceIndex: -1,
      sourceText: r.text.trim(),
      recipient: r.typ === "notification" ? r.mottagare?.trim() || undefined : undefined,
      messageDirection: r.typ === "notification" ? "send" : undefined,
    };
  };

  const steps: DraftStep[] = [];
  for (const r of mall.rader) {
    steps.push(stegFör(r));
    // Grenstegen läggs EFTER sitt beslut och pekar tillbaka på det. Det är så
    // compileDraft hittar dem – ordningen i listan är inte grafen.
    for (const g of r.grenar ?? []) {
      for (const gr of g.rader) {
        steps.push(stegFör(gr, { stepId: r.id, label: g.etikett.trim() }));
      }
    }
  }

  draft.steps = steps;
  draft.lanes = [...banor.values()];
  return draft;
}

/* -------------------------------------------------------------------- */
/* Mellanlager -> mall: fortsätta där man slutade                       */
/* -------------------------------------------------------------------- */

/**
 * Mallen som den skulle ha sett ut för det här flödet.
 *
 * Mallen SPARAS INTE – den räknas fram ur mellanlagret varje gång den öppnas.
 * Då kan den aldrig bli osann: har ett steg döpts om på ritytan står det nya
 * namnet i mallen, och ett flöde som sparades innan det här fanns går att
 * fortsätta på precis som ett nytt. Radernas id är stegens (invariant 2), så
 * det som körs tillbaka genom `fortsättMedMall` hittar sina steg igen.
 *
 * Ett grensteg hänger under sitt beslut, i grenen med samma etikett. Ligger
 * beslutet självt i en gren (mallen har bara en nivå) står steget kvar som en
 * vanlig rad – hellre det än att det försvinner ur mallen.
 */
export function draftTillMall(draft: ProcessDraft): Mall {
  const rader: MallRad[] = [];
  const radAv = new Map<string, MallRad>();
  const rad = (s: DraftStep): MallRad => ({
    id: s.id,
    text: s.text,
    bana: s.laneId,
    typ: s.type,
    ...(s.recipient ? { mottagare: s.recipient } : {}),
  });
  for (const s of draft.steps) {
    const beslut = s.branchOf ? radAv.get(s.branchOf.stepId) : undefined;
    const r = rad(s);
    if (!beslut || !s.branchOf) {
      rader.push(r);
      radAv.set(s.id, r); // bara rader på översta nivån kan bära grenar
      continue;
    }
    const grenar = (beslut.grenar ??= []);
    let gren = grenar.find((g) => g.etikett === s.branchOf!.label);
    if (!gren) {
      // Härlett ur beslutet och etiketten – samma gren får samma id varje gång.
      gren = { id: `${beslut.id}_${s.branchOf.label}`, etikett: s.branchOf.label, rader: [] };
      grenar.push(gren);
    }
    gren.rader.push(r);
  }
  return {
    titel: draft.title,
    underrubrik: draft.subtitle ?? "",
    banor: [...draft.lanes].sort((a, b) => a.order - b.order).map((l) => l.id),
    rader,
  };
}

/**
 * Kör mallen på ett flöde som redan finns – utan att kasta det som gjorts på
 * ritytan. Steg som står kvar i mallen behåller allt mallen inte äger
 * (placering, textstil, affärsprocessens annoteringar), och draftens övriga fält sprids
 * vidare (invariant 4). Delar mallen inga steg med flödet är den ett NYTT
 * flöde, och då byggs det från början som förut.
 */
export function fortsättMedMall(draft: ProcessDraft, mall: Mall): ProcessDraft {
  const ny = mallTillDraft(mall);
  const gamla = new Map(draft.steps.map((s) => [s.id, s]));
  if (!ny.steps.some((s) => gamla.has(s.id))) return ny;
  const banor = new Map(draft.lanes.map((l) => [l.id, l]));
  return {
    ...draft,
    title: ny.title,
    subtitle: ny.subtitle,
    lanes: ny.lanes.map((l) => ({ ...(banor.get(l.id) ?? l), order: l.order })),
    steps: ny.steps.map((s) => {
      const g = gamla.get(s.id);
      if (!g) return s;
      // Texten orörd = stegets spårning till källtexten gäller fortfarande.
      const spår = g.text === s.text ? { sourceIndex: g.sourceIndex, sourceText: g.sourceText } : {};
      return { ...g, ...s, ...spår };
    }),
    meta: { ...draft.meta, origin: "manual", sourceText: ny.meta.sourceText },
  };
}

/**
 * Mallen som pilformatstext.
 *
 * Inte för att tolkas igen – mallen är källan – utan för att beskrivningsrutan
 * och spårbarheten ska kunna visa flödet i samma form som allt annat.
 */
export function mallSomText(mall: Mall): string {
  const rad = (r: MallRad): string => {
    const grenar = (r.grenar ?? [])
      .filter((g) => g.rader.length)
      .map((g) => `↓ Om ${g.etikett} → ${g.rader.map((x) => x.text.trim()).join(" → ")}`)
      .join("; ");
    return grenar ? `${r.text.trim()} (${grenar})` : r.text.trim();
  };
  const kropp = mall.rader.map(rad).filter(Boolean).join(" → ");
  return [mall.titel.trim(), kropp].filter(Boolean).join("\n");
}
