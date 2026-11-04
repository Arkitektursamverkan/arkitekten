/**
 * Affärsprocess – processflödesmodellen (ApModel) och dess kompilering.
 *
 * Stilen följer modelleringsreglerna för affärsprocesser: processer ritas
 * som ETT vågrätt processflöde – ingen simbaneindelning. Förädlingskedjan är
 * verksamhetsobjekt → aktivitet → verksamhetsobjekt → … (relationen Flöde),
 * regler (och/eller) formuleras som frågor med svaren på relationerna, och
 * satelliter hänger på aktiviteterna: roller/intressenter (HUKI) och
 * IT-stöd under, krav och tid (Adresserar) över.
 *
 * ARKITEKTUR: kompileringen är en TRANSFORMATION av `compileDraft`-utdatan.
 * All grenlogik, borttagna/extra kopplingar, auto-slut och stabila id:n är
 * redan lösta där – att lösa om dem här vore att bygga en andra sanning
 * (mot invarianten "en regel, en plats"). Ap-lagret mappar bara om:
 *
 *   start/end            → verksamhetsobjekt (kedjans ändar)
 *   activity/system/...  → aktivitet
 *   decision             → regel (kantetiketterna blir svaren)
 *   datastore + assoc.   → applikation med "Samverkar med"
 *   messageFlow          → meddelande-VO ur aktiviteten
 *   steg.ap              → satelliter (roll, intressent, krav, tid, …)
 *
 * och SPRÄNGER IN verksamhetsobjekt mellan två aktiviteter (auto-förslag ur
 * aktivitetens verb+substantiv, omdöpbart via autoLabels, bortvalbart via
 * steg.ap.output = null).
 */

import { delaChecklista } from "./rutin";
import { compileDraft, type ApStegInfo, type Huki, type ProcessDraft } from "./draft";
import type { ProcessModel } from "./model";

/* ------------------------------------------------------------------ */
/* Modellen                                                            */
/* ------------------------------------------------------------------ */

/** Objekttyp i affärsprocessen. Styr form och färg (symbolstilen). */
export type ApNodeKind =
  | "process" // processobjekt "processfisken" (orange chevron) – delprocess
  | "aktivitet" // laxrosa rektangel, verb + substantiv
  | "vo" // verksamhetsobjekt (grå kvadrat) – kedjans input/output
  | "regel" // och/eller (orange romb), formuleras som fråga
  | "roll" // gul hatt
  | "intressent" // gul ellips
  | "applikation" // grå cylinder (IT-stöd)
  | "arkiv" // grå låda
  | "krav" // lila hexagon
  | "tid" // klocka
  | "forum" // pratbubbla
  | "plats" // nål
  | "problem" // "!"
  | "risk" // varningstriangel
  | "mojlighet" // "?"
  | "textobjekt"; // fri text

/** Variant av verksamhetsobjekt – styr ikonen (kvadrat/dokument/kuvert). */
export type VoVariant = "objekt" | "dokument" | "meddelande";

/** Relationstyp enligt modelleringsreglerna. */
export type ApRelationKind =
  | "flode" // förädlingskedjan VO → aktivitet → VO
  | "adresserar" // krav/tid → aktivitet
  | "huki" // roll/intressent → aktivitet, bokstaven på relationen
  | "samverkar" // aktivitet → applikation/arkiv/forum/plats
  | "styr"
  | "stodjer"
  | "bestar"; // "Består av"

export interface ApNode {
  id: string;
  kind: ApNodeKind;
  label: string;
  /** Bara för kind "vo". Saknas = "objekt". */
  voVariant?: VoVariant;
  /** true = auto-genererat förslag (insprängt VO) – kan döpas om/väljas bort. */
  auto?: boolean;
  /** "i"-ikonen: en beskrivning finns (stegets not). */
  harBeskrivning?: boolean;
  /** Själva beskrivningen – visas som hovertext på objektet. */
  beskrivning?: string;
  /** Rutinen bakom ett krav (se `ProcessDraft.apRutiner`) – ger rutin-ikonen. */
  rutin?: string;
  /** Pil-i-cirkel-ikonen: nedbruten delprocess. */
  nedbruten?: boolean;
  /** Spårbarhet – samma kontrakt som ProcessNode. −1 = notation/auto. */
  sourceIndex: number;
  sourceText?: string;
  /**
   * Aktiviteten en SATELLIT hör till – layouten placerar den över/under sin
   * aktivitet. Saknas för objekt i själva kedjan.
   */
  anchorId?: string;
  /** Manuellt satt position (affärsprocessvyns egna koordinater). null = auto. */
  position?: { x: number; y: number } | null;
  textSize?: number;
}

export interface ApRelation {
  id: string;
  source: string;
  target: string;
  kind: ApRelationKind;
  /** Regelsvar ("Ja"/"Nej") – ritas på relationen. */
  label?: string;
  /** HUKI-bokstav (bara kind "huki"). */
  huki?: Huki;
  /**
   * Kanten i MELLANLAGRET relationen ritar – den som en etikett skrivs på.
   *
   * Inte alltid relationens egna ändar: mellan två aktiviteter sprängs ett
   * verksamhetsobjekt in, och pilen man dubbelklickar på går då ur objektet
   * (`vo_s3 → s4`) medan kanten heter `s3 → s4`. Saknas för det som inte är
   * en kant i mellanlagret (satelliter, in-objekt).
   */
  kant?: { source: string; target: string; label?: string };
}

export interface ApModel {
  title: string;
  subtitle?: string;
  nodes: ApNode[];
  relations: ApRelation[];
  meta: {
    sourceText: string;
    sourceFragments: string[];
    warnings: string[];
  };
}

/* ------------------------------------------------------------------ */
/* Auto-VO: particip ur aktivitetens verb + substantiv                  */
/* ------------------------------------------------------------------ */

interface Particip {
  utrum: string; // "registrerad" (en ansökan)
  neutrum: string; // "registrerat" (ett urval)
  plural: string; // "registrerade" (flera ansökningar)
}

/** Regelbundet particip: -a-verb ger -ad/-at/-ade, stamform -d/-t/-da. */
function regelbundet(stam: string): Particip {
  return { utrum: `${stam}d`, neutrum: `${stam}t`, plural: `${stam}de` };
}

/**
 * Oregelbundna verb och partikelverb (nyckel = gemener, IMPERATIV stam).
 * Infinitiven slås upp genom att -a:et fälls bort ("hålla" → "håll"), så
 * varje verb behöver bara stå här en gång.
 */
const PARTICIP: Record<string, Particip> = {
  "ta emot": { utrum: "mottagen", neutrum: "mottaget", plural: "mottagna" },
  "tar emot": { utrum: "mottagen", neutrum: "mottaget", plural: "mottagna" },
  "följ upp": { utrum: "uppföljd", neutrum: "uppföljt", plural: "uppföljda" },
  "lägg till": { utrum: "tillagd", neutrum: "tillagt", plural: "tillagda" },
  "skicka ut": { utrum: "utskickad", neutrum: "utskickat", plural: "utskickade" },
  "skicka in": { utrum: "inskickad", neutrum: "inskickat", plural: "inskickade" },
  "sätt samman": { utrum: "sammansatt", neutrum: "sammansatt", plural: "sammansatta" },
  "sätt ihop": { utrum: "ihopsatt", neutrum: "ihopsatt", plural: "ihopsatta" },
  "gå igenom": { utrum: "genomgången", neutrum: "genomgånget", plural: "genomgångna" },
  gör: { utrum: "gjord", neutrum: "gjort", plural: "gjorda" },
  ta: { utrum: "tagen", neutrum: "taget", plural: "tagna" },
  skriv: { utrum: "skriven", neutrum: "skrivet", plural: "skrivna" },
  välj: { utrum: "vald", neutrum: "valt", plural: "valda" },
  besluta: { utrum: "beslutad", neutrum: "beslutat", plural: "beslutade" },
  godkänn: { utrum: "godkänd", neutrum: "godkänt", plural: "godkända" },
  sänd: { utrum: "sänd", neutrum: "sänt", plural: "sända" },
  utse: { utrum: "utsedd", neutrum: "utsett", plural: "utsedda" },
  se: { utrum: "sedd", neutrum: "sett", plural: "sedda" },
  ge: { utrum: "given", neutrum: "givet", plural: "givna" },
  håll: { utrum: "hållen", neutrum: "hållet", plural: "hållna" },
  lägg: { utrum: "lagd", neutrum: "lagt", plural: "lagda" },
  sätt: { utrum: "satt", neutrum: "satt", plural: "satta" },
  dra: { utrum: "dragen", neutrum: "draget", plural: "dragna" },
  bjud: { utrum: "bjuden", neutrum: "bjudet", plural: "bjudna" },
  finn: { utrum: "funnen", neutrum: "funnet", plural: "funna" },
};

/** Obestämd artikel och determinerare framför objektet: "Skapa EN presentation". */
const ARTIKLAR = new Set(["en", "ett", "den", "det", "de"]);

/**
 * Prepositioner som binder objektet till verbet: "Öva PÅ föredraget",
 * "Justera UTIFRÅN föreläsningens tid". De hör till verbet, inte till
 * objektets namn – utan bortfallet blev huvudordet prepositionen och
 * förslaget "På föredraget övad".
 */
const PREPOSITIONER = new Set([
  "på", "i", "av", "med", "för", "till", "om", "från", "ur", "vid",
  "över", "under", "utifrån", "genom", "inför", "efter", "mot",
]);

/**
 * Ord som ALDRIG inleder ett verb + substantiv-namn. Reglerna kräver den
 * formen, och utan spärren blev adjektivet läst som verb: "Sista justeringar"
 * gav "Justeringar sistad". Ett uteblivet förslag är rätt svar – affärsprocesskontrollen
 * påpekar den brutna kedjan, och namnet är det som ska rättas.
 */
const EJ_VERB = new Set([
  "sista", "siste", "första", "andra", "ny", "nytt", "nya", "gammal", "gamla",
  "stor", "stora", "liten", "små", "all", "alla", "hel", "hela", "egen", "eget",
  "egna", "övrig", "övriga", "löpande", "fortsatt", "fortsatta", "eventuell",
  "eventuella", "diverse", "vissa",
]);

/** Substantiv som ser ut som plural men inte är det ("en order"). */
const SINGULAR_TROTS_ÄNDELSE = new Set([
  "order", "vinter", "sommar", "dotter", "moder", "fader", "syster", "broder",
  "mor", "far", "peter", "vatten", "socken",
]);

type Numerus = "utrum" | "neutrum" | "plural";

/**
 * Utrum, neutrum eller plural? Svensk genus går inte att härleda säkert, men
 * UTRUM är default (ca tre fjärdedelar av alla substantiv – "profil", "tjänst",
 * "faktura") och de vanliga NEUTRUM-orden i processpråk känns igen på
 * ändelserna: -ande/-ende ("erbjudande"), -um, -val ("urval"), -slut
 * ("beslut"), -slag ("avslag"), -tal ("avtal"), -ment ("dokument") m.fl.
 * Bestämd form -et avslöjar också neutrum ("föredraget") – utom i -het/-itet,
 * som är utrum ("möjligheten", "kvaliteten"). Plural känns igen på -ar/-er/-or
 * ("justeringar", "applåder"). Förslaget är omdöpbart, så en miss kostar bara
 * ett namnbyte.
 */
function numerusAv(substantiv: string): Numerus {
  const o = substantiv.toLowerCase();
  if (/(ar|er|or)$/.test(o) && !SINGULAR_TROTS_ÄNDELSE.has(o)) return "plural";
  if (
    /(ande|ende|um|val|slut|slag|tal|brev|kort|intyg|besked|ment|system|schema|formulär|mejl|ärende|material|paket)$/.test(
      o,
    )
  ) {
    return "neutrum";
  }
  // Bestämd form i neutrum: "föredraget", "ärendet". -het/-itet är utrum.
  if (/et$/.test(o) && !/(het|itet)$/.test(o)) return "neutrum";
  return "utrum";
}

/**
 * Particip av ett verb. Nyckeln är imperativ stam; infinitiven fälls ner till
 * den ("hålla" → "håll") så att både "Håll föredraget" och "Hålla föredraget"
 * ger "Föredraget hållet".
 */
function bildaParticip(verb: string): Particip {
  const v = verb.toLowerCase();
  const känt = PARTICIP[v] ?? (v.endsWith("a") ? PARTICIP[v.slice(0, -1)] : undefined);
  if (känt) return känt;
  return regelbundet(v);
}

/** Samma nedfällning för partikelverb: "sätta samman" → "sätt samman". */
function partikelParticip(fras: string): Particip | undefined {
  const f = fras.toLowerCase();
  if (PARTICIP[f]) return PARTICIP[f];
  const [verb, ...rest] = f.split(/\s+/);
  if (!verb.endsWith("a")) return undefined;
  return PARTICIP[[verb.slice(0, -1), ...rest].join(" ")];
}

/**
 * Föreslår ett output-verksamhetsobjekt ur ett aktivitetsnamn:
 * "Genomför urval" → "Urval genomfört", "Registrera ansökan" →
 * "Ansökan registrerad". Ett namn utan objekt ("Utred") ger inget förslag,
 * och inte heller ett namn som inte inleds med ett verb ("Sista justeringar").
 */
export function föreslåOutput(aktivitetsnamn: string): string | null {
  const trimmat = aktivitetsnamn.trim();
  // PASSIV form först: "Loggpost skapas", "Mejlbekräftelse skickas till
  // användaren", "Handläggare utses …". Subjektet står FÖRST och verbet slutar
  // på -as/-es. Utan specialfallet lästes subjektet som verb och förslaget
  // blev nonsens ("Skickas till användaren mejlbekräftelsed").
  const passiv = trimmat.match(/^(\S+)\s+(\S+?(?:as|es))(\s+.*)?$/);
  if (passiv) {
    const stam = passiv[2].slice(0, -1).toLowerCase(); // skickas→skicka, utses→utse
    return sättIhop(passiv[1], PARTICIP[stam] ?? bildaParticip(stam));
  }
  const första = trimmat.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (EJ_VERB.has(första)) return null; // adjektiv, inte verb – namnet ska rättas
  // Partikelverb (två ord) provas därefter: "Ta emot ansökan".
  const partikel = trimmat.match(/^(\S+\s+\S+)\s+(.+)$/);
  if (partikel) {
    const p = partikelParticip(partikel[1]);
    if (p) return sättIhop(partikel[2], p);
  }
  const m = trimmat.match(/^(\S+)\s+(.+)$/);
  if (!m) return null; // inget objekt att beskriva
  return sättIhop(m[2], bildaParticip(m[1]));
}

/**
 * Sätter ihop objektet med participet i rätt form. Artikel och bindande
 * preposition faller bort, och genitiv pekar vidare till huvudordet
 * ("föreläsningens tid" böjs efter "tid").
 */
function sättIhop(objekt: string, p: Particip): string {
  let ord = objekt.trim().split(/\s+/);
  while (ord.length > 1 && (ARTIKLAR.has(ord[0].toLowerCase()) || PREPOSITIONER.has(ord[0].toLowerCase()))) {
    ord = ord.slice(1);
  }
  if (!ord.length) return objekt;
  // Huvudordet bär genus: hoppa förbi genitivled ("föreläsningens tid").
  const huvudord = ord.length > 1 && /s$/.test(ord[0]) ? ord[1] : ord[0];
  const form = p[numerusAv(huvudord)];
  const fras = ord.join(" ");
  return `${fras.charAt(0).toUpperCase()}${fras.slice(1)} ${form}`;
}

/* ------------------------------------------------------------------ */
/* Kompileringen                                                       */
/* ------------------------------------------------------------------ */

/** Stabilt id för det insprängda output-objektet efter en nod. */
export function voId(nodId: string): string {
  return `vo_${nodId}`;
}

/** Stabilt id för ett explicit input-objekt före ett steg. */
export function voInId(stegId: string): string {
  return `vo_in_${stegId}`;
}

/** Stabilt satellit-id: sort + ankare + namn (ALDRIG en räknare – jfr end_<nodId>). */
export function satellitId(kind: ApNodeKind, anchorId: string, namn: string): string {
  const slug = namn
    .toLowerCase()
    .replace(/[^a-z0-9åäö]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${kind}_${anchorId}_${slug}`;
}

/**
 * Kompilerar mellanlagret till en ApModel, deterministiskt, via compileDraft.
 * Spårbarhetskontraktet gäller oförändrat: varje kedjenod bär sitt
 * sourceIndex; auto-genererade objekt har −1.
 */
export function compileAp(draft: ProcessDraft): ApModel {
  const pm = compileDraft(draft);
  return transformToAp(pm, draft);
}

/** Transformationen ProcessModel → ApModel. Exporterad för testbarhet. */
export function transformToAp(pm: ProcessModel, draft: ProcessDraft): ApModel {
  const ap: ApModel = {
    title: pm.title,
    subtitle: pm.subtitle,
    nodes: [],
    relations: [],
    meta: {
      sourceText: pm.meta.sourceText,
      sourceFragments: [...pm.meta.sourceFragments],
      warnings: [...pm.meta.warnings],
    },
  };
  const steg = new Map(draft.steps.map((s) => [s.id, s]));
  const auto = draft.autoLabels ?? {};
  // Manuella positioner: steg bär sina egna; auto-objekt (VO, satelliter,
  // auto-slut) nycklas på nod-id i autoPositions – samma mekanism som
  // flödesschemats auto-slut. Fria layoutens koordinater (invariant 5).
  const pos = (id: string) => draft.autoPositions?.[id] ?? null;
  /**
   * Textstorlek per objekt. Steg bär sin egen; allt annat på ytan (satelliter,
   * insprängda VO, auto-slut, meddelanden) nycklas på sitt härledda id – samma
   * mekanism som namn och lägen. Utan detta gick storleken bara att ändra på
   * kedjans steg, och inte på det som faktiskt skulle gå att ändra: rollerna och
   * objekten.
   */
  const txt = (id: string) => draft.autoTextSizes?.[id];
  let relN = 0;
  const rel = (
    source: string,
    target: string,
    kind: ApRelationKind,
    label?: string,
    huki?: Huki,
    kant?: ApRelation["kant"],
  ) => {
    ap.relations.push({ id: `r${++relN}`, source, target, kind, label, huki, ...(kant ? { kant } : {}) });
  };

  /**
   * Namnet på ett AUTOMATISKT slut-event, när steget före har ett uttryckligt
   * ut-objekt.
   *
   * Ett `[Ut: Tackmejl]` på SISTA steget ritades aldrig: förädlingsobjekt
   * sprängs in mellan två aktiviteter, och sista steget har ingen aktivitet
   * efter sig – bara ett automatiskt slut-event. Objektet försvann tyst.
   * I affärsprocessen finns inga slut-event; kedjan slutar i ett verksamhetsobjekt, och
   * det automatiska slutet ÄR det objektet. Alltså bär det användarens namn.
   * Har användaren döpt om slutet själv (autoLabels) vinner det namnet.
   */
  const slutNamn = (id: string): string | undefined => {
    if (!id.startsWith("end_") || draft.autoLabels?.[id]) return undefined;
    return steg.get(id.slice(4))?.ap?.output ?? undefined;
  };

  // ---- Kedjenoder: varje ProcessNode blir exakt EN ap-nod med samma id.
  const kindAv = new Map<string, ApNodeKind>();
  for (const n of pm.nodes) {
    const s = steg.get(n.id);
    const kind: ApNodeKind =
      n.type === "start" || n.type === "end"
        ? "vo"
        : n.type === "decision"
          ? "regel"
          : s?.ap?.delprocess
            ? "process"
            : s?.ap?.iMötesform
              ? "forum"
              : "aktivitet";
    kindAv.set(n.id, kind);
    ap.nodes.push({
      id: n.id,
      kind,
      label: (n.type === "end" ? slutNamn(n.id) : undefined) ?? n.label,
      voVariant: kind === "vo" ? "objekt" : undefined,
      harBeskrivning: Boolean(s?.note) || undefined,
      beskrivning: s?.note,
      sourceIndex: n.sourceIndex,
      sourceText: n.sourceText,
      // Steg bär sin egen position; auto-noder (t.ex. auto-slut) sina via
      // autoPositions – jfr flödesschemat.
      position: s?.position ?? pos(n.id),
      textSize: n.textSize ?? txt(n.id),
    });
  }

  // ---- Fria objekt (utplacerade från paletten, ännu inte inknutna). De blir
  // noder UTAN relationer; en pil användaren dragit (extraEdges) ansluter dem
  // med relationstyp efter objektets sort.
  const fria = new Map((draft.apFria ?? []).map((f) => [f.id, f]));
  for (const f of draft.apFria ?? []) {
    const kind = f.kind as ApNodeKind;
    kindAv.set(f.id, kind);
    ap.nodes.push({
      id: f.id,
      kind,
      label: auto[f.id] ?? f.namn,
      voVariant: kind === "vo" ? ((f.variant as VoVariant) ?? "objekt") : undefined,
      rutin: kind === "krav" ? draft.apRutiner?.[f.id]?.text : undefined,
      sourceIndex: -1,
      position: pos(f.id),
      textSize: txt(f.id),
    });
  }
  /**
   * Relationstyp för en pil till/från ett FRITT objekt.
   *
   * Roller och krav är alltid satelliter, oavsett vad de kopplas till. Men
   * IT-stöd, arkiv, forum och plats kan vara BÅDA: ett forum kan stå mitt i
   * förädlingskedjan (aktiviteten är alltid ett möte), med verksamhetsobjekt på
   * var sida. Därför avgör den ANDRA änden:
   * hänger objektet på en aktivitet är det en satellit (Samverkar med), ligger
   * det mellan objekt i kedjan är pilen ett Flöde. Utan den regeln typades
   * forumets båda pilar som satellitpilar, kedjan bröts itu och layouten la
   * halvorna på var sin rad.
   */
  const friRelation = (kind: ApNodeKind, andraÄnden: ApNodeKind | undefined): ApRelationKind => {
    if (kind === "roll" || kind === "intressent") return "huki";
    if (kind === "krav" || kind === "tid" || kind === "problem" || kind === "risk" || kind === "mojlighet") {
      return "adresserar";
    }
    if (kind === "applikation" || kind === "arkiv" || kind === "forum" || kind === "plats") {
      const påSteg =
        andraÄnden === "aktivitet" || andraÄnden === "process" || andraÄnden === "regel";
      return påSteg ? "samverkar" : "flode";
    }
    return "flode";
  };

  // ---- Sekvensflöden → Flöde-relationer, med VO insprängt mellan två
  // aktiviteter. Ett gemensamt output-objekt per källnod (id vo_<nodId>) så
  // att en aktivitet med flera utgångar får ETT objekt, inte ett per pil.
  const voSkapade = new Set<string>();
  const utAv = new Map<string, number>();
  for (const e of pm.edges) utAv.set(e.source, (utAv.get(e.source) ?? 0) + 1);
  for (const e of pm.edges) {
    const kant = { source: e.source, target: e.target, ...(e.label ? { label: e.label } : {}) };
    const srcKind = kindAv.get(e.source);
    const tgtKind = kindAv.get(e.target);
    const src = steg.get(e.source);
    const explicitOutput = src?.ap?.output;

    // Pil till/från ett FRITT objekt: relationstypen följer objektets sort,
    // och inget VO sprängs in (förslag ur "Ny aktivitet" vore nonsens).
    const friÄnde = fria.get(e.source) ?? fria.get(e.target);
    if (friÄnde) {
      const andra = friÄnde.id === e.source ? tgtKind : srcKind;
      const sort = friRelation(friÄnde.kind as ApNodeKind, andra);
      rel(e.source, e.target, sort, e.label, undefined, sort === "flode" ? kant : undefined);
      continue;
    }

    // Ett forum i kedjan står i en aktivitets ställe och förädlar
    // lika mycket – objektet emellan behövs där också.
    const utför = (k: ApNodeKind | undefined) => k === "aktivitet" || k === "forum";
    const skaHaVo =
      utför(srcKind) &&
      utför(tgtKind) &&
      explicitOutput !== null && // uttryckligen bortvalt
      (explicitOutput !== undefined || föreslåOutput(labelAv(pm, e.source)) !== null);

    if (!skaHaVo) {
      rel(e.source, e.target, "flode", e.label, undefined, kant);
      continue;
    }

    const id = voId(e.source);
    if (!voSkapade.has(id)) {
      voSkapade.add(id);
      ap.nodes.push({
        id,
        kind: "vo",
        voVariant: "objekt",
        // Omdöpning sparas i autoLabels på det stabila id:t – samma mekanism
        // som auto-slut ("Klart") använder i flödesschemat.
        label: auto[id] ?? explicitOutput ?? föreslåOutput(labelAv(pm, e.source))!,
        auto: explicitOutput === undefined ? true : undefined,
        sourceIndex: -1,
        position: pos(id),
        textSize: txt(id),
      });
      // Objektet produceras ovillkorligt av aktiviteten – benet dit är
      // omärkt. En eventuell etikett skiljer MÅLEN åt och sitter på
      // VO → mål-benet.
      // Benet in i objektet hör till kanten bara när aktiviteten har EN väg ut
      // – med flera delar de på objektet, och benet är ingen av dem.
      rel(e.source, id, "flode", undefined, undefined, utAv.get(e.source) === 1 ? kant : undefined);
    }
    rel(id, e.target, "flode", e.label, undefined, kant);
  }

  // ---- Explicit input-VO före ett steg: [VO] →Flöde→ (aktivitet).
  for (const s of draft.steps) {
    const input = s.ap?.input?.trim();
    if (!input || !kindAv.has(s.id)) continue;
    const id = voInId(s.id);
    ap.nodes.push({
      id,
      kind: "vo",
      voVariant: "objekt",
      label: auto[id] ?? input,
      sourceIndex: s.sourceIndex,
      position: pos(id),
      textSize: txt(id),
    });
    rel(id, s.id, "flode");
  }

  // ---- Datalager → applikation, "Samverkar med" från varje kopplad aktivitet.
  for (const ds of pm.dataStores) {
    // Ankare = första skrivande aktiviteten (layouten hänger cylindern där).
    const första = pm.dataAssociations.find((a) => a.dataStoreId === ds.id);
    ap.nodes.push({
      id: ds.id,
      kind: "applikation",
      label: ds.label,
      sourceIndex: ds.sourceIndex,
      sourceText: ds.sourceText,
      anchorId: första?.nodeId,
      position: ds.position ?? pos(ds.id),
      textSize: ds.textSize ?? txt(ds.id),
    });
  }
  for (const a of pm.dataAssociations) {
    rel(a.nodeId, a.dataStoreId, "samverkar");
  }

  // ---- Meddelandeflöden → meddelande-VO (kuvert) ur aktiviteten.
  for (const mf of pm.messageFlows) {
    const pool = pm.pools.find((p) => p.id === mf.poolId);
    const id = `msg_${mf.nodeId}_${mf.poolId}`;
    ap.nodes.push({
      id,
      kind: "vo",
      voVariant: "meddelande",
      label: auto[id] ?? (mf.label || `Till ${pool?.title ?? mf.poolId}`),
      sourceIndex: -1,
      anchorId: mf.nodeId,
      position: pos(id),
      textSize: txt(id),
    });
    rel(mf.nodeId, id, "flode");
  }

  // ---- Satelliter ur stegets ap-block.
  for (const s of draft.steps) {
    const info = s.ap;
    if (!info || !kindAv.has(s.id)) continue;
    const lägg = (
      kind: ApNodeKind,
      namn: string,
      relKind: ApRelationKind,
      huki?: Huki,
    ) => {
      const id = satellitId(kind, s.id, namn);
      ap.nodes.push({
        id,
        kind,
        label: auto[id] ?? namn,
        rutin: kind === "krav" ? draft.apRutiner?.[id]?.text : undefined,
        sourceIndex: s.sourceIndex,
        anchorId: s.id,
        position: pos(id),
        textSize: txt(id),
      });
      // HUKI går roll → aktivitet (rollen utför), Adresserar krav → aktivitet,
      // Samverkar aktivitet → IT-stödet.
      if (relKind === "samverkar") rel(s.id, id, relKind);
      else rel(id, s.id, relKind, huki, huki);
    };
    for (const r of info.roller ?? []) lägg("roll", r.namn, "huki", r.huki ?? "U");
    for (const r of info.intressenter ?? []) lägg("intressent", r.namn, "huki", r.huki ?? "I");
    for (const namn of info.applikationer ?? []) lägg("applikation", namn, "samverkar");
    for (const namn of info.arkiv ?? []) lägg("arkiv", namn, "samverkar");
    for (const namn of info.krav ?? []) lägg("krav", namn, "adresserar");
    if (info.tid) lägg("tid", info.tid, "adresserar");
    if (info.forum) lägg("forum", info.forum, "samverkar");
    if (info.plats) lägg("plats", info.plats, "samverkar");
    for (const namn of info.problem ?? []) lägg("problem", namn, "adresserar");
    for (const namn of info.risker ?? []) lägg("risk", namn, "adresserar");
    for (const namn of info.mojligheter ?? []) lägg("mojlighet", namn, "adresserar");
  }

  return ap;
}

function labelAv(pm: ProcessModel, nodId: string): string {
  return pm.nodes.find((n) => n.id === nodId)?.label ?? "";
}

/* ------------------------------------------------------------------ */
/* Redigeringshjälpare för ap-blocket (spridningsägda – invariant 4)    */
/* ------------------------------------------------------------------ */

/** Uppdaterar ett stegs ap-block i sin helhet. */
export function setStepAp(
  draft: ProcessDraft,
  stepId: string,
  ap: ApStegInfo | undefined,
): ProcessDraft {
  return {
    ...draft,
    steps: draft.steps.map((s) => (s.id === stepId ? { ...s, ap } : s)),
    meta: { ...draft.meta, origin: "manual" },
  };
}

/**
 * Sätter stegets ut-objekt: sträng = explicit namn, null = inget objekt alls,
 * undefined = tillbaka till auto-förslaget. Rensar samtidigt en eventuell
 * gammal omdöpning på vo-id:t – autoLabels vinner i kompileringen och skulle
 * annars skugga det nya namnet.
 */
export function sättUtobjekt(
  draft: ProcessDraft,
  stepId: string,
  namn: string | null | undefined,
): ProcessDraft {
  const steg = draft.steps.find((s) => s.id === stepId);
  if (!steg) return draft;
  const ap = { ...steg.ap };
  if (namn === undefined) delete ap.output;
  else ap.output = typeof namn === "string" ? namn.trim() : namn;
  const autoLabels = { ...draft.autoLabels };
  delete autoLabels[voId(stepId)];
  return { ...setStepAp(draft, stepId, ap), autoLabels };
}

/** Sätter stegets in-objekt (undefined tar bort det). Se sättUtobjekt. */
export function sättInobjekt(
  draft: ProcessDraft,
  stepId: string,
  namn: string | undefined,
): ProcessDraft {
  const steg = draft.steps.find((s) => s.id === stepId);
  if (!steg) return draft;
  const ap = { ...steg.ap };
  const trimmat = namn?.trim();
  if (trimmat) ap.input = trimmat;
  else delete ap.input;
  const autoLabels = { ...draft.autoLabels };
  delete autoLabels[voInId(stepId)];
  return { ...setStepAp(draft, stepId, ap), autoLabels };
}

/**
 * Döper om en satellit. Satellit-id:t härleds ur namnet (stabilt tills namnet
 * ändras – och DÅ måste sparad position och omdöpningsrest flyttas med till
 * det nya id:t, annars tappar objektet sitt läge av ett namnbyte).
 */
export function renameSatellit(
  draft: ProcessDraft,
  stepId: string,
  kind: ApNodeKind,
  gammalt: string,
  nytt: string,
): ProcessDraft {
  const trimmat = nytt.trim();
  const steg = draft.steps.find((s) => s.id === stepId);
  if (!steg?.ap || !trimmat || trimmat === gammalt) return draft;

  const ap = { ...steg.ap };
  const bytRoll = (list?: { namn: string; huki?: Huki }[]) =>
    list?.map((r) => (r.namn === gammalt ? { ...r, namn: trimmat } : r));
  const bytNamn = (list?: string[]) => list?.map((n) => (n === gammalt ? trimmat : n));
  if (kind === "roll") ap.roller = bytRoll(ap.roller);
  else if (kind === "intressent") ap.intressenter = bytRoll(ap.intressenter);
  else if (kind === "applikation") ap.applikationer = bytNamn(ap.applikationer);
  else if (kind === "arkiv") ap.arkiv = bytNamn(ap.arkiv);
  else if (kind === "krav") ap.krav = bytNamn(ap.krav);
  else if (kind === "tid") ap.tid = trimmat;
  else if (kind === "forum") ap.forum = trimmat;
  else if (kind === "plats") ap.plats = trimmat;
  else if (kind === "problem") ap.problem = bytNamn(ap.problem);
  else if (kind === "risk") ap.risker = bytNamn(ap.risker);
  else if (kind === "mojlighet") ap.mojligheter = bytNamn(ap.mojligheter);
  else return draft;

  const gammaltId = satellitId(kind, stepId, gammalt);
  const nyttId = satellitId(kind, stepId, trimmat);
  const autoPositions = { ...draft.autoPositions };
  const sparad = autoPositions[gammaltId];
  delete autoPositions[gammaltId];
  if (sparad) autoPositions[nyttId] = sparad;
  const autoLabels = { ...draft.autoLabels };
  delete autoLabels[gammaltId];
  // Rutinen hör till kravet, inte till namnet – den följer med till nya id:t.
  const rutin = draft.apRutiner?.[gammaltId];
  let apRutiner = draft.apRutiner;
  if (rutin) {
    apRutiner = { ...draft.apRutiner, [nyttId]: rutin };
    delete apRutiner[gammaltId];
  }

  return {
    ...draft,
    steps: draft.steps.map((s) => (s.id === stepId ? { ...s, ap } : s)),
    autoPositions,
    autoLabels,
    ...(apRutiner ? { apRutiner } : {}),
    meta: { ...draft.meta, origin: "manual" },
  };
}

/**
 * Sätter (eller tar bort, med tom text/undefined) rutinen bakom ett krav.
 * `nodId` är kravets nod-id på ytan.
 */
export function sättRutin(
  draft: ProcessDraft,
  nodId: string,
  text: string | undefined,
): ProcessDraft {
  const apRutiner = { ...draft.apRutiner };
  if (text?.trim()) apRutiner[nodId] = { ...apRutiner[nodId], text: text.replace(/\s+$/, "") };
  else delete apRutiner[nodId];
  return { ...draft, apRutiner, meta: { ...draft.meta, origin: "manual" } };
}

/**
 * Gör ett kravs inskrivna CHECKLISTA till kravets rutin.
 *
 * "[Krav: Rutin uppdatering brandväggar – ☐ Ladda ner firmware ☐ Ta backup]"
 * är hur man (och AI:n) skriver en rutin i löptexten. Utan lyftet blev hela
 * raden kravets namn och ingen rutin skapades (patchningsprocessen,
 * 2026-11-04). Här får kravet namnet före rutorna och rutinen ett moment per
 * ruta – samma lagring som byggaren i rutinvyn (`apRutiner`, nycklad på
 * kravets id). Sparad position och omdöpning flyttas med till det nya id:t,
 * som vid ett namnbyte. En rutin som redan står på det nya id:t skrivs
 * ALDRIG över: den kan vara skriven för hand.
 *
 * `nodId` = ett visst krav; utan det lyfts alla krav i flödet. Returnerar
 * draften oförändrad (samma objekt) när det inte finns något att lyfta.
 */
export function lyftUtChecklistor(draft: ProcessDraft, nodId?: string): ProcessDraft {
  let nästa = draft;
  for (const steg of draft.steps) {
    for (const krav of steg.ap?.krav ?? []) {
      const delad = delaChecklista(krav);
      if (!delad) continue;
      const gammaltId = satellitId("krav", steg.id, krav);
      if (nodId && nodId !== gammaltId) continue;
      const nyttId = satellitId("krav", steg.id, delad.namn);
      const ap = { ...nästa.steps.find((s) => s.id === steg.id)!.ap };
      // Två krav kan inte heta likadant på samma aktivitet – de vore samma nod.
      ap.krav = (ap.krav ?? []).flatMap((k) =>
        k === krav ? (ap.krav!.includes(delad.namn) ? [] : [delad.namn]) : [k],
      );
      const flytta = <T,>(rec: Record<string, T> | undefined) => {
        if (!rec || !(gammaltId in rec)) return rec;
        const ny = { ...rec };
        if (!(nyttId in ny)) ny[nyttId] = ny[gammaltId];
        delete ny[gammaltId];
        return ny;
      };
      const autoPositions = flytta(nästa.autoPositions);
      const autoLabels = flytta(nästa.autoLabels);
      const apRutiner = flytta(nästa.apRutiner) ?? {};
      nästa = {
        ...nästa,
        steps: nästa.steps.map((s) => (s.id === steg.id ? { ...s, ap } : s)),
        ...(autoPositions ? { autoPositions } : {}),
        ...(autoLabels ? { autoLabels } : {}),
        apRutiner: apRutiner[nyttId]?.text?.trim()
          ? apRutiner
          : delad.rutin
            ? { ...apRutiner, [nyttId]: { text: delad.rutin } }
            : apRutiner,
      };
    }
  }
  return nästa;
}

/** Id:t ett krav med checklista får efter `lyftUtChecklistor` (null = ingen checklista). */
export function idEfterLyft(draft: ProcessDraft, nodId: string): string | null {
  for (const steg of draft.steps)
    for (const krav of steg.ap?.krav ?? []) {
      if (satellitId("krav", steg.id, krav) !== nodId) continue;
      const delad = delaChecklista(krav);
      return delad ? satellitId("krav", steg.id, delad.namn) : null;
    }
  return null;
}
