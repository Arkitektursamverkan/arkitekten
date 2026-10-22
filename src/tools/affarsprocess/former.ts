/**
 * Affärsprocessens FORMER – EN modul som genererar SVG-markup för varje
 * objekttyp. Används av BÅDE canvasen (inline-SVG i nodvyerna), SVG-exporten
 * och scenen till portalen, så skärm, fil och portal aldrig glider isär
 * (invarianten "en regel, en plats").
 *
 * Geometrin står här. Färger, typsnitt, aktörssymbol, skugga och hörnradie är
 * installationens val och läses ur den aktiva symbolstilen (`symbolstil.ts`).
 */

import type { ApNode, ApNodeKind, ApRelation, ApRelationKind } from "@/core/affarsprocess";
import type { Huki } from "@/core/draft";
import { esc, wrap } from "../flowchart/render/text-util";
import { symbolstil, type Formstil } from "./symbolstil";

/** Formens färger i den aktiva stilen. */
export const formstil = (kind: ApNodeKind): Formstil => symbolstil().former[kind];

export const AP_TYPE_LABEL: Record<ApNodeKind, string> = {
  process: "Process",
  aktivitet: "Aktivitet",
  vo: "Verksamhetsobjekt",
  regel: "Regel (och/eller)",
  roll: "Roll",
  intressent: "Intressent",
  applikation: "Applikation",
  arkiv: "Arkiv",
  krav: "Krav",
  tid: "Tid",
  forum: "Forum",
  plats: "Plats",
  problem: "Problem",
  risk: "Risk",
  mojlighet: "Möjlighet",
  textobjekt: "Text",
};

/**
 * Vad en symbol BETYDER – en mening per form, EN PLATS.
 *
 * Läses av objektpaletten (verktygstipset) och av figurförteckningen
 * (faktarutan som säger vad bilden består av). Meningen beskriver SYMBOLEN,
 * aldrig hur man placerar den – paletten lägger själv på sin gestinstruktion
 * ("dra en pil hit och objektet knyts in"), för den hör till redigerandet och
 * har ingenting i en läsares teckenförklaring att göra.
 */
export const AP_TYPE_BETYDELSE: Record<ApNodeKind, string> = {
  process: "Delprocess – en process som körs på annat håll. Ritas som en pil.",
  aktivitet: "Aktivitet – något som utförs i processen.",
  regel: "Regel (och/eller) – en fråga som delar flödet. Svaren skrivs på pilarna ut ur regeln.",
  vo: "Verksamhetsobjekt – förädlingsresultatet mellan två aktiviteter.",
  roll: "Roll – den som utför. Pilen till aktiviteten bär HUKI-ansvaret.",
  intressent: "Intressent – någon utanför processen som berörs. Pilen bär HUKI-ansvaret.",
  applikation: "Applikation – IT-stödet aktiviteten samverkar med.",
  arkiv: "Arkiv – där något förvaras. Aktiviteten samverkar med det.",
  krav: "Krav – vad aktiviteten måste uppfylla. Ritas i bandet ovanför aktiviteten.",
  tid: "Tid – ledtid eller tidsgräns. Ritas i bandet ovanför aktiviteten.",
  forum: "Forum – mötet eller kanalen där aktiviteten sker.",
  plats: "Plats – var aktiviteten utförs.",
  problem: "Problem – något som hindrar eller stör i aktiviteten.",
  risk: "Risk – något som kan gå fel.",
  mojlighet: "Möjlighet – ett förbättringsuppslag.",
  textobjekt: "Fri text – en anteckning på ytan, utan koppling till flödet.",
};

/* ---- Relationernas innebörd (hovertexten på en koppling) ---- */

/**
 * HUKI-bokstavens namn – EN plats. Både inspektörens väljare och hovertexten
 * på kopplingen läser härifrån, så bokstaven aldrig kan betyda olika saker på
 * två ställen i appen.
 */
export const HUKI_LABEL: Record<Huki, string> = {
  H: "Huvudansvar",
  U: "Utför",
  K: "Konsulteras",
  I: "Informeras",
};

/**
 * Meningen bakom bokstaven, med aktörens och aktivitetens namn insatta.
 *
 * Exporterad för figurförteckningens skull: faktarutan skriver samma mening i
 * allmän form ("Aktören utför aktiviteten"), och skulle den ha en egen
 * formulering kunde bokstaven komma att betyda två olika saker i samma app.
 */
export const HUKI_MENING: Record<Huki, (aktör: string, aktivitet: string) => string> = {
  H: (a, b) => `${a} har huvudansvaret för ${b}`,
  U: (a, b) => `${a} utför ${b}`,
  K: (a, b) => `${a} konsulteras i ${b}`,
  I: (a, b) => `${a} informeras om ${b}`,
};

/**
 * Relationernas färger – EN plats, läses av både canvasen och SVG-exporten.
 *
 * Sorterna skiljs med färg i stället för att bara strecka dem: förädlings-
 * kedjan, ansvaret (en färg per HUKI-bokstav) och IT-stödet. Med en enda grå
 * ton smälte allt ihop till ett grått nystan så fort en aktivitet hade både
 * roll och system under sig. Färgerna står i symbolstilen.
 */
export const hukiFärg = (h: Huki): string => symbolstil().huki[h];
export const relationsFärg = (kind: ApRelationKind): string => symbolstil().relationer[kind];

/**
 * HÖRNRADIEN på en relations väg, i OSKALADE pixlar – multipliceras med
 * layoutens skala, precis som teckengrader och mått, annars blir bågen en
 * droppe i en utzoomad vy och ett knappt märkbart hack i en förstorad. Radien
 * kapas dessutom mot segmenten den sitter mellan (se `pointsToPath`), så trånga
 * kluster ger mindre bågar i stället för trasiga vägar. 0 = räta vinklar.
 */
export const apHörnradie = (): number => symbolstil().hörnradie;

/**
 * Pilspetsarna som relationernas `marker-end` pekar på – en fylld för flödet
 * och en öppen för annoteringarna, i varje relationsfärg.
 *
 * EN REGEL, EN PLATS. Markörerna byggdes förut inne i `renderApSvg`, så var och
 * en som ville rita samma kanter någon annanstans (scenen som lämnar huset)
 * fick skriva av dem. Två uppsättningar id:n som ska stämma överens är en
 * glidning som väntar på att hända – nu finns de här och importeras.
 *
 * `orient="auto"`, inte SVG 2:s `auto-start-reverse`: ingen kant bär
 * `marker-start`, så webbläsaren ritar likadant – men exportens läsare
 * (resvg i PNG-förhandsvisningen, äldre SVG-verktyg) kan inte den nyare
 * formen och läste den som 0°. Då pekade VARJE spets åt höger, och på de
 * lodräta strecken upp i aktiviteten syntes bara en flik i sidled.
 */
export function apMarkerDefs(): string {
  const fylld = (id: string, färg: string) =>
    `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="${färg}"/></marker>`;
  const stil = symbolstil();
  return [
    ...Object.entries(stil.relationer).map(([kind, färg]) => fylld(`ap-arrow-${kind}`, färg)),
    // Ansvarstyperna har var sin färg och därmed var sin pilspets.
    ...Object.entries(stil.huki).map(([h, färg]) => fylld(`ap-arrow-huki-${h}`, färg)),
  ].join("\n");
}

/**
 * Relationens färg. HUKI läses per bokstav, allt annat per sort.
 */
export function apRelationFärg(rel: ApRelation): string {
  if (rel.kind === "huki") return hukiFärg(rel.huki ?? "U");
  return relationsFärg(rel.kind) ?? relationsFärg("flode");
}

/**
 * Markören relationen pekar på. ALLA pilspetsar är FYLLDA.
 *
 * Satelliternas var öppna (en tunn V-form) för att skilja dem från flödet.
 * Tunn färgad linje plus tunn öppen spets blev nästan osynlig – i portalen
 * såg det ut som att IT-stödets pilar saknades helt (beslut 2026-09-07).
 * Sorterna skiljs med FÄRG, inte med spetsens form.
 */
export function apMarkerId(rel: ApRelation): string {
  return rel.kind === "huki"
    ? `ap-arrow-huki-${rel.huki ?? "U"}`
    : `ap-arrow-${rel.kind}`;
}

/** Relationstypens namn. */
export const AP_RELATION_LABEL: Record<ApRelationKind, string> = {
  flode: "Flöde",
  adresserar: "Adresserar",
  huki: "HUKI",
  samverkar: "Samverkar med",
  styr: "Styr",
  stodjer: "Stödjer",
  bestar: "Består av",
};

/**
 * Vad en relationssort BETYDER – EN PLATS, läst av figurförteckningen.
 *
 * HUKI står inte här: den sorten har fyra betydelser, en per bokstav, och de
 * byggs av `HUKI_MENING` så att förteckningen och hovertexten säger samma sak.
 */
export const AP_RELATION_BETYDELSE: Record<Exclude<ApRelationKind, "huki">, string> = {
  flode: "Förädlingskedjan – ordningen stegen utförs i. Svaret på en regel står på pilen.",
  adresserar: "Krav eller tid som aktiviteten måste svara upp mot.",
  samverkar: "Aktiviteten samverkar med ett IT-stöd, ett arkiv, ett forum eller en plats.",
  styr: "Något styr hur aktiviteten får utföras.",
  stodjer: "Något stödjer aktiviteten utan att styra den.",
  bestar: "Objektet består av delarna pilen pekar på.",
};

/** Namnet inom citattecken – ett namnlöst (nyss placerat) objekt ger null. */
const citat = (n?: ApNode) => (n && n.label.trim() ? `”${n.label}”` : null);

/**
 * Hovertexten för en relation. En ensam bokstav (H/U/K/I) på en koppling
 * säger ingenting för den som inte kan metoden utantill – här skrivs den ut
 * i klartext, med objektens namn när de är kända.
 */
export function relationHint(rel: ApRelation, källa?: ApNode, mål?: ApNode): string {
  if (rel.kind === "huki") {
    const h = rel.huki ?? "U";
    const aktör = citat(källa) ?? (källa?.kind === "intressent" ? "intressenten" : "rollen");
    const aktivitet = citat(mål) ?? "aktiviteten";
    return `${h} – ${HUKI_LABEL[h]}: ${HUKI_MENING[h](aktör, aktivitet)}`;
  }
  const namn = AP_RELATION_LABEL[rel.kind];
  const led = [citat(källa), citat(mål)].filter(Boolean).join(" → ");
  const svar = rel.label ? ` (${rel.label})` : "";
  return led ? `${namn}${svar}: ${led}` : `${namn}${svar}`;
}

/**
 * Texten som ritas PÅ en koppling – EN plats, läst av både canvasens scen och
 * SVG-exporten.
 *
 * HUKI-bokstaven skrivs INTE ut. Ansvarslinjerna skiljs åt med FÄRG (se
 * `hukiFärg`), så bokstaven bär ingen egen upplysning. Den var dessutom
 * aktivt i vägen: ett gult "I" i liten grad bredvid en linje läses inte som en
 * bokstav utan som ett litet streck som inte hör hemma (beslut 2026-09-07).
 *
 * Hela innebörden finns kvar i hovertexten (`relationHint`).
 */
export function apRelationEtikett(rel: ApRelation): string {
  if (rel.kind === "huki") return "";
  return rel.label ?? "";
}

/**
 * Typer där texten står UNDER en liten ikon i stället för inuti formen.
 *
 * VERKSAMHETSOBJEKTEN hör hit: en liten ruta med namnet under. Som fylld låda
 * med vit text inuti – som vi ritade förut – blev objekten tyngre än
 * aktiviteterna och tog över hela bilden, fast de bara är förädlingsresultat
 * mellan stegen.
 */
export const IKONTYPER: ReadonlySet<ApNodeKind> = new Set([
  "vo",
  // REGELN med: en liten romb med frågan under – inte den stora fyllda romb
  // med texten inuti som vi ritade förut. Den drog blicken till sig som om
  // beslutet vore bildens huvudsak.
  "regel",
  "applikation",
  "arkiv",
  "roll",
  // Intressenten har SAMMA symbol som rollen och namnet under. Som fylld
  // ellips med texten inuti blev den en egen sorts ruta som drog blicken till
  // sig, fast den bara är ännu en aktör under aktiviteten.
  "intressent",
  "tid",
  "plats",
  "problem",
  "risk",
  "mojlighet",
]);

/** Typsnittet ur symbolstilen – EN plats för skärm, fil och scen. */
const FONT = () => symbolstil().teckensnitt;

/*
 * Textmetrik för ikontyperna – SAMMA tal som apNodeSvg ritar med.
 * Texten under en ikon är mindre än den inuti en aktivitet: satellitnamnen är
 * finstiltare än stegens, och det är det som håller ihop bilden när en
 * aktivitet har både roll och system under sig.
 */
/**
 * Tecken per rad innan radbrytning. En etikett ska helst vara en rad och
 * aldrig fler än tre. Vår gamla grundbredd på 13–14 tecken gjorde tvärtom:
 * sex smala rader i en hög ruta, med orden sönderbrutna mitt i. Bredare rad,
 * färre rader – det är så processägare skriver.
 */
const RADBREDD_GRUND: Record<"ikon" | "text", number> = { ikon: 18, text: 22 };
/** Tak för hur brett ett enda ord får göra en form innan texten krymps. */
const RADBREDD_TAK: Record<"ikon" | "text", number> = { ikon: 26, text: 32 };
/** Hur bred en rad får bli när etiketten annars inte ryms på radtaket. */
const RADBREDD_HÅRT_TAK = 40;
/**
 * Rader innan raden breddas: TRE. Formerna växer med sin
 * etikett, så taket styr FORMEN, inte om texten får plats: ryms den inte på
 * tre rader breddas raden (se apRadbredd), den kapas aldrig.
 */
export const AP_MAX_RADER = 3;
const IKON_FONT = 11; // px
const IKON_TECKEN_PX = 6.2; // ≈ bredd per tecken vid IKON_FONT
const IKON_RADHÖJD = 13;
const IKON_ZON = 32; // ikonens höjd ovanför texten

/**
 * Radbredden en etikett bryts på: grundbredden, eller det LÄNGSTA ORDET om
 * det inte får plats där.
 *
 * Texten krymper aldrig – rutan blir bredare i stället. Vår gamla regel
 * gjorde tvärtom, och "Rapporterar akut ärende utanför ärendehanterings-
 * system" fick 7 px text i en ruta med samma bredd som grannens 11 px. Två
 * teckenstorlekar bredvid varandra är det första man ser i en jämförelse.
 * Krympningen finns kvar som säkerhetsventil ovanför taket – ett ord på 40
 * tecken ska inte spränga sidbrytningen.
 */
export function apRadbredd(kind: ApNodeKind, label: string): number {
  const ikon = IKONTYPER.has(kind);
  // Pratbubblan bryter tidigare: en ellips växer på höjden när den blir
  // bredare, så "Avhandla agendapunkter" på en rad blev en ballong dubbelt så
  // hög som aktiviteterna bredvid. På två rader håller den formen.
  const bas = kind === "forum" ? 14 : RADBREDD_GRUND[ikon ? "ikon" : "text"];
  // Samma orddelning som `wrap` gör: bindestrecket är en brytpunkt, så
  // "Kund-medarbetare" räknas som elva tecken och inte sexton.
  const längsta = Math.max(
    ...label.split(/\s+/).flatMap((o) => o.split(/(?<=-)(?=.)/)).map((o) => o.length),
    1,
  );
  let bredd = Math.max(bas, Math.min(längsta, RADBREDD_TAK[ikon ? "ikon" : "text"]));
  /**
   * RYMS INTE TEXTEN PÅ RADTAKET BREDDAS RADEN – ordet kapas aldrig tyst.
   *
   * `wrap` klipper vid `AP_MAX_RADER`, och regeln "Har personuppgifter läkt,
   * eller finns risk för att personuppgifter läkt?" (4.4.3) behövde sju rader:
   * frågetecknet och sista ordet försvann ur bilden utan ett spår. Formerna
   * växer ändå med sin etikett, så en bredare rad kostar bara några pixlar:
   * rutan blir bredare, texten står kvar.
   *
   * Bredden är EN plats (måtten, ikonmåtten och SVG:n läser samma funktion),
   * annars mäter layouten en ruta och ritar en annan.
   */
  while (bredd < RADBREDD_HÅRT_TAK && wrap(label, bredd, AP_MAX_RADER + 1, true).length > AP_MAX_RADER) {
    bredd += 2;
  }
  return bredd;
}

/**
 * Ikonens ruta inuti noden – DÄR pilarna ska fästa.
 *
 * En ikontyp är mest etikett: rutan är så bred som namnet, medan symbolen är
 * knappt 30 px och sitter överst. Fäster pilen i rutans kant hamnar den långt
 * ifrån symbolen, mitt för texten, och ser ut att sluta i tomma luften – så
 * såg in-objektet ut förut. Canvasen sätter sina kopplings-
 * punkter här, exporten räknar sina portar härifrån, och routern får rutan i
 * `portRects`, så alla tre är överens.
 *
 * Returnerar null för former som fyller hela sin ruta (aktivitet, regel …).
 */
export function ikonPortRuta(
  kind: ApNodeKind,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } | null {
  // Pratbubblans pilar fäster i KROPPEN – ellipsen – inte i rutan som också
  // rymmer svansen. Annars hamnade sidopilarna under ellipsens bredaste punkt
  // och slutade en bit utanför konturen.
  if (kind === "forum") return { x: 0, y: 0, w, h: forumKropp(h) };
  if (!IKONTYPER.has(kind)) return null;
  const bredd = Math.min(w, 28);
  const topp = Math.min(2, h);
  return { x: w / 2 - bredd / 2, y: topp, w: bredd, h: Math.min(h - topp, IKON_ZON - 4) };
}

/**
 * Pratbubblans svans, som andel av hela rutans höjd: kroppen 67 px, svansen
 * 15 px under den.
 */
export const FORUM_SVANS = 0.18;
/** Höjden på pratbubblans kropp (ellipsen) i en ruta som är `h` hög. */
export const forumKropp = (h: number) => h * (1 - FORUM_SVANS);

/**
 * Var formens KONTUR går i höjdled vid `dx` från rutans vänsterkant – över-
 * och underkant. För rutformerna är det rutans kanter; pratbubblan är en
 * ellips, och en pil som slutade i rutans underkant hängde i luften bredvid
 * svansen, en bit under själva bubblan.
 */
export function apKontur(kind: ApNodeKind, w: number, h: number, dx: number): { topp: number; botten: number } {
  if (kind !== "forum") return { topp: 0, botten: h };
  const kropp = forumKropp(h);
  const rx = w / 2 - 1;
  const ry = kropp / 2 - 1;
  const t = Math.min(1, Math.abs(dx - w / 2) / rx);
  const halv = ry * Math.sqrt(1 - t * t);
  return { topp: kropp / 2 - halv, botten: kropp / 2 + halv };
}

/**
 * Var under pratbubblan klustrets stammar får hänga: till HÖGER om svansen.
 * Svansen går ut ur undersidan vid 29–51 % av bredden, och stammarna, som
 * annars sitter strax kring mitten, gick rakt upp i den. Mitten av den fria
 * högra delen är fästet; för alla andra former är det formens mitt.
 */
export function apStamMitt(kind: ApNodeKind, w: number): number {
  return kind === "forum" ? w * 0.68 : w / 2;
}

/**
 * Måtten en form med texten INUTI behöver för att etiketten ska rymmas.
 *
 * Ett långt forumnamn ("Forum – aktiviteten är alltid ett möte") svämmade ut
 * ur pratbubblan, och långa aktivitetsnamn trängdes mot
 * kanterna. Måttet är ett GOLV: en form krymper aldrig under sitt grundmått,
 * den växer bara när texten kräver det. Samma metrik som apNodeSvg ritar med.
 */
export function textEtikettMått(
  kind: ApNodeKind,
  label: string,
): { w: number; h: number } {
  const max = apRadbredd(kind, label);
  const rader = wrap(label, max, AP_MAX_RADER, true);
  const längsta = Math.max(...rader.map((r) => r.length), 1);
  // Spetsiga former (romb, hexagon, pil, pratbubbla med svans) behöver mer
  // luft än en rektangel för samma text.
  const spetsig = kind === "regel" || kind === "krav" || kind === "process";
  if (kind === "forum") {
    // Forumet står i en AKTIVITETS ställe och är lika stort som en, SVANSEN
    // INRÄKNAD. Vi blåste förut upp en ballong runt texten – 251 × 140 för
    // "Avdelningsledningsgruppen", dubbelt så bred och nästan tre gånger så
    // hög som aktiviteterna bredvid (beslut 2026-10-13: "för stor, fel
    // dimension"). Kroppen får aktivitetens texthöjd; bara sidorna får några
    // pixlar extra, eftersom ellipsen rundar av där raderna slutar.
    return {
      w: Math.ceil(längsta * 6.6 + 30),
      h: Math.ceil((rader.length * 13.5 + 18) / (1 - FORUM_SVANS)),
    };
  }
  return {
    w: Math.ceil(längsta * 6.6 + (spetsig ? 54 : 22)),
    h: Math.ceil(rader.length * 13.5 + (spetsig ? 30 : 18)),
  };
}

/**
 * Måtten en ikontyp behöver för att HELA etiketten ska rymmas. Layouten
 * använder detta för nodens storlek och kolumnbredden – utan det klipptes
 * "Inom 5 dagar" i kanterna av nodens egen SVG-ruta i canvasen (exporten
 * ritar i hela dokumentets SVG och klipper inte, så skärm och fil såg olika
 * ut – exakt det delade moduler ska förhindra).
 */
export function ikonEtikettMått(label: string): { w: number; h: number } {
  const rader = wrap(label, apRadbredd("vo", label), AP_MAX_RADER, true);
  const längsta = Math.max(...rader.map((r) => r.length), 1);
  return {
    w: Math.ceil(längsta * IKON_TECKEN_PX + 12),
    h: Math.ceil(IKON_ZON + rader.length * IKON_RADHÖJD + 6),
  };
}

/**
 * Formens SVG-element (utan text) vid origo, i rutan w×h.
 * Ikontyperna ritar sin ikon i den övre delen och lämnar resten åt texten.
 */
export function apShapeSvg(kind: ApNodeKind, w: number, h: number, variant?: string): string {
  const stil = symbolstil();
  const s = stil.former[kind];
  const sw = 1.6;
  switch (kind) {
    case "process": {
      // Delprocessen: en pil åt höger. Rak vänsterkant, spets åt höger – den
      // pekar dit flödet fortsätter.
      const a = Math.min(24, w * 0.16);
      return `<polygon points="0.8,0.8 ${w - a},0.8 ${w - 0.8},${h / 2} ${w - a},${h - 0.8} 0.8,${h - 0.8}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${sw}"/>`;
    }
    case "aktivitet":
      // Tunn kontur och, om stilen vill, en mjuk skugga ner till höger.
      // Skuggan är en förskjuten ruta, inte ett SVG-filter: scenen skickar
      // formerna som fristående fragment och kan inte räkna med att
      // mottagaren har våra `defs`.
      return `${stil.skugga ? `<rect x="3" y="3" width="${w - 1}" height="${h - 1}" rx="8" fill="#e4e4e5"/>\n` : ""}<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="8" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1"/>`;
    case "vo": {
      // Liten ruta i ikonzonen, namnet under.
      const cx = w / 2;
      const sida = 24;
      const x0 = cx - sida / 2;
      const y0 = 4;
      if (variant === "dokument") {
        // Dokument: ruta med vikt hörn uppe till höger.
        const v = 7;
        return `<path d="M${x0},${y0} h${sida - v} l${v},${v} v${sida - v} h${-sida} Z" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.4"/>
<path d="M${x0 + sida - v},${y0} v${v} h${v}" fill="none" stroke="#ffffff" stroke-width="1.2"/>`;
      }
      if (variant === "meddelande") {
        // Meddelande: kuvert – ruta med flik.
        return `<rect x="${x0}" y="${y0 + 3}" width="${sida}" height="${sida - 6}" rx="2" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.4"/>
<polyline points="${x0 + 1.5},${y0 + 4.5} ${cx},${y0 + 12} ${x0 + sida - 1.5},${y0 + 4.5}" fill="none" stroke="#ffffff" stroke-width="1.3"/>`;
      }
      return `<rect x="${x0}" y="${y0}" width="${sida}" height="${sida}" rx="2" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.4"/>`;
    }
    case "regel": {
      // Liten romb i ikonzonen, frågan under.
      const cx = w / 2;
      const r = 13;
      return `<polygon points="${cx},${16 - r} ${cx + r},16 ${cx},${16 + r} ${cx - r},16" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.4"/>`;
    }
    case "roll":
    case "intressent": {
      // Rollen och intressenten delar symbolen; det är relationens bokstav och
      // namnet som skiljer dem åt, inte formen. Stilen väljer en person
      // (huvud och axlar) eller en arbetsplats (skärm på ett bord).
      const cx = w / 2;
      if (stil.aktör === "person") {
        return `<circle cx="${cx}" cy="10.5" r="5.8" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.2"/>
<path d="M${cx - 11},27.5 C${cx - 11},20 ${cx - 6.5},17.5 ${cx},17.5 C${cx + 6.5},17.5 ${cx + 11},20 ${cx + 11},27.5 Z" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.2"/>`;
      }
      return `<rect x="${cx - 11}" y="6" width="22" height="13" rx="3" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.2"/>
<rect x="${cx - 15}" y="19.5" width="30" height="4.5" rx="2" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.2"/>
<rect x="${cx - 16}" y="26" width="32" height="2" rx="1" fill="#e2e2e3"/>`;
    }
    case "applikation": {
      // Liten cylinder i ikonzonen, namnet under (IT-stödet).
      const bw = 26;
      const bh = 24;
      const x0 = w / 2 - bw / 2;
      const ry = 5;
      // Locket är ljusare än mantelen – det är den skuggningen som gör
      // cylindern rund i stället för platt.
      return `<path d="M${x0},${5 + ry} a${bw / 2},${ry} 0 0 1 ${bw},0 v${bh - 2 * ry} a${bw / 2},${ry} 0 0 1 ${-bw},0 Z" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.3"/>
<ellipse cx="${w / 2}" cy="${5 + ry}" rx="${bw / 2}" ry="${ry}" ${s.ljus ? `fill="${s.ljus}"` : `fill="${s.fill}" fill-opacity="0.6"`} stroke="${s.stroke}" stroke-width="1.1"/>`;
    }
    case "arkiv": {
      // Liten arkivlåda i ikonzonen, namnet under.
      const bw = 26;
      const bh = 22;
      const x0 = w / 2 - bw / 2;
      return `<rect x="${x0}" y="5" width="${bw}" height="${bh}" rx="2" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.3"/>
<line x1="${x0}" y1="${5 + bh * 0.34}" x2="${x0 + bw}" y2="${5 + bh * 0.34}" stroke="${s.stroke}" stroke-width="1.1"/>
<rect x="${w / 2 - 5}" y="${5 + bh * 0.34 + 3}" width="10" height="4" rx="2" fill="none" stroke="${s.stroke}" stroke-width="1"/>`;
    }
    case "krav": {
      const k = Math.min(16, w * 0.18);
      return `<polygon points="${k},1 ${w - k},1 ${w - 1},${h / 2} ${w - k},${h - 1} ${k},${h - 1} 1,${h / 2}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${sw}"/>`;
    }
    case "tid": {
      const cx = w / 2;
      return `<circle cx="${cx}" cy="15" r="12" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.6"/>
<line x1="${cx}" y1="15" x2="${cx}" y2="8" stroke="${s.stroke}" stroke-width="1.4"/>
<line x1="${cx}" y1="15" x2="${cx + 5}" y2="18" stroke="${s.stroke}" stroke-width="1.4"/>`;
    }
    case "forum": {
      // Pratbubblan: en ELLIPS med svansen ur undersidan strax vänster om
      // mitten, snett ned åt vänster. Ritad som EN kontur, så att ingen
      // kantlinje syns mellan kropp och svans (bas 35–51 % av bredden, spets
      // vid 29 %).
      const kropp = forumKropp(h);
      const cx = w / 2;
      const cy = kropp / 2;
      const rx = w / 2 - 1;
      const ry = kropp / 2 - 1;
      const påUndersidan = (x: number) => cy + ry * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2));
      const v = w * 0.35;
      const hö = w * 0.51;
      const f = (n: number) => n.toFixed(1);
      return `<path d="M${f(hö)},${f(påUndersidan(hö))} A${f(rx)},${f(ry)} 0 1,0 ${f(v)},${f(påUndersidan(v))} L${f(w * 0.29)},${f(h - 1)} Z" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    }
    case "plats": {
      // Kartnål: droppe + cirkel.
      const cx = w / 2;
      return `<path d="M${cx},28 C${cx - 11},16 ${cx - 11},4 ${cx},4 C${cx + 11},4 ${cx + 11},16 ${cx},28 Z" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.4"/>
<circle cx="${cx}" cy="12" r="4" fill="#ffffff"/>`;
    }
    case "problem": {
      const cx = w / 2;
      return `<circle cx="${cx}" cy="14" r="12" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.8"/>
<text x="${cx}" y="19" text-anchor="middle" font-family="${FONT()}" font-size="15" font-weight="700" fill="${s.stroke}">!</text>`;
    }
    case "risk": {
      const cx = w / 2;
      return `<polygon points="${cx},2 ${cx + 13},24 ${cx - 13},24" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.6"/>
<text x="${cx}" y="21" text-anchor="middle" font-family="${FONT()}" font-size="12" font-weight="700" fill="${s.stroke}">!</text>`;
    }
    case "mojlighet": {
      const cx = w / 2;
      return `<circle cx="${cx}" cy="14" r="12" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.8"/>
<text x="${cx}" y="19" text-anchor="middle" font-family="${FONT()}" font-size="14" font-weight="700" fill="${s.stroke}">?</text>`;
    }
    case "textobjekt":
      return "";
  }
}

/** "i"-ikonen (beskrivning finns) respektive nedbruten-ikonen (delprocess). */
function ikonSvg(x: number, y: number, typ: "info" | "ned" | "rutin"): string {
  const r = 6.5;
  const inner =
    typ === "info"
      ? `<text x="${x}" y="${y + 3}" text-anchor="middle" font-family="Georgia, serif" font-size="9" font-style="italic" font-weight="700" fill="#45474a">i</text>`
      : typ === "rutin"
        ? `<path d="M${x - 3.2},${y - 2.6} h6.4 M${x - 3.2},${y} h6.4 M${x - 3.2},${y + 2.6} h4" fill="none" stroke="#45474a" stroke-width="1.2" stroke-linecap="round"/>`
        : `<path d="M${x - 3},${y} h4 m-1.6,-2.4 l2.4,2.4 l-2.4,2.4" fill="none" stroke="#45474a" stroke-width="1.3"/>`;
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" stroke="#85878a" stroke-width="1.1"/>${inner}`;
}

/**
 * Komplett nod: form + etikett + ev. ikoner, placerad på (x, y).
 * `textScale` är globalt reglage × nodens egen faktor – samma kontrakt som
 * flödesschemat.
 */
export function apNodeSvg(
  node: ApNode,
  x: number,
  y: number,
  w: number,
  h: number,
  textScale = 1,
): string {
  const s = formstil(node.kind);
  const delar: string[] = [apShapeSvg(node.kind, w, h, node.voVariant)];

  // Text: inuti formen, eller under ikonen för ikontyperna.
  const ikontyp = IKONTYPER.has(node.kind);
  const max = apRadbredd(node.kind, node.label);
  // Ett ord som är längre än radbredden kan inte radbrytas – krymp texten i
  // stället (samma princip som decisionTextScale, delad mellan skärm och fil
  // eftersom hela modulen är delad). "Anställningserbjudande" svämmade annars
  // ur sitt verksamhetsobjekt.
  // Samma orddelning som radbredden och `wrap` – räknades det längsta ordet
  // utan bindestrecksbrytningen krympte texten fast raden fick plats, och
  // rollnamnet stod med 9 px bredvid grannens 11.
  const längsta = Math.max(
    ...node.label.split(/\s+/).flatMap((o) => o.split(/(?<=-)(?=.)/)).map((o) => o.length),
    1,
  );
  const t = textScale * (node.textSize ?? 1) * (längsta > max ? Math.max(0.55, max / längsta) : 1);
  const lines = wrap(node.label, Math.round(max / Math.max(0.4, t)), AP_MAX_RADER, true);
  const fontSize = (ikontyp ? IKON_FONT : 12) * t;
  const lineH = (ikontyp ? IKON_RADHÖJD : 13.5) * t;
  // Pratbubblans svans är ingen textyta – texten centreras i KROPPEN, annars
  // hamnar sista raden i svansen.
  const texthöjd = node.kind === "forum" ? forumKropp(h) : h;
  const textStart = ikontyp
    ? IKON_ZON + fontSize // under ikonzonen
    : texthöjd / 2 - ((lines.length - 1) * lineH) / 2 + fontSize * 0.35;
  // Namnet under en symbol har en gemensam färg – aldrig symbolens egen, som
  // kan vara för ljus för text.
  const textFill = ikontyp ? symbolstil().textUnderSymbol : s.text;
  for (let i = 0; i < lines.length; i++) {
    delar.push(
      `<text x="${(w / 2).toFixed(1)}" y="${(textStart + i * lineH).toFixed(1)}" text-anchor="middle" font-family="${FONT()}" font-size="${fontSize.toFixed(1)}" fill="${textFill}">${esc(lines[i])}</text>`,
    );
  }

  // Ikoner nere till höger (beskrivning / nedbruten) på aktivitet & process.
  // Forum ska också ha en beskrivning, så "i" sitter där med – PÅ ellipsens
  // kontur nere till höger, som på aktivitetens hörn. Inne i bubblan låg den
  // ovanpå sista raden.
  if (node.kind === "forum") {
    if (node.harBeskrivning) delar.push(ikonSvg(w * 0.86, apKontur("forum", w, h, w * 0.86).botten, "info"));
  } else if (node.kind === "aktivitet" || node.kind === "process") {
    let ix = w - 12;
    if (node.nedbruten) {
      delar.push(ikonSvg(ix, h - 10, "ned"));
      ix -= 16;
    }
    if (node.harBeskrivning) delar.push(ikonSvg(ix, h - 10, "info"));
  }
  // Rutin-ikonen: kravet bär en rutin som går att öppna. Uppe till höger på
  // sexhörningens raka kant, så att den inte ligger över namnet.
  if (node.kind === "krav" && node.rutin) {
    delar.push(ikonSvg(w - Math.min(16, w * 0.18) - 4, 8, "rutin"));
  }

  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">${delar.join("\n")}</g>`;
}
