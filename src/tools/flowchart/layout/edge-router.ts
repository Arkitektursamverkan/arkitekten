/**
 * Kollisionsundvikande ortogonal routning.
 *
 * Ger en väg med räta vinklar mellan två portar som går RUNT andra objekt i
 * stället för genom dem. Ren funktion utan React/SVG – matematiken går att
 * testa (vägen är ortogonal, rör inget hinder, börjar/slutar på rätt sida).
 *
 * Metod: A* på ett "Hanan-rutnät" – rutnätslinjerna dras genom varje objekts
 * kanter (plus en marginal) och genom start/mål. Kanter i nätet som skär ett
 * hinder tas bort. A* minimerar väglängd + svängar, så vägen blir kort och med
 * få knäckar. Deterministisk: samma indata ger alltid samma väg.
 */

export type Side = "top" | "right" | "bottom" | "left";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface RouteRequest {
  from: Point;
  fromSide: Side;
  to: Point;
  toSide: Side;
  /** Objekt att undvika. Start- och målobjektet ska INTE ingå. */
  obstacles: Rect[];
  /**
   * Manuell brytpunkt. Är den satt äger användaren vägen: kanten går med räta
   * vinklar RAKT genom punkten, utan automatisk väjning. Så tvingar man en kant
   * till andra sidan om ett objekt när routern valt "fel" sida.
   */
  via?: Point | null;
  /**
   * ANDRA brytpunkten, närmast målet. Gäller bara tillsammans med `via`.
   *
   * En brytpunkt styr vägens andra hörn, men den sista sträckan in i målet
   * låg alltid precis framför målets port – och där står ofta målets egna
   * satelliter. En räls (upp/ner ur källan, tvärs över, in i målet) har
   * två fria hörn: 2.2.1:s "Byter annonstyp" gick in till "Publicerar
   * lägenhet" genom Lägenhetsförvaltare, Kundkoordinator och RitoCad, och
   * gick inte att flytta (2026-09-30). Se `sistaSträckan`.
   */
  via2?: Point | null;
}

/** Hur långt en väg sticker rakt ut från en port innan den får svänga. */
const STUB = 14;
/**
 * Kortaste stubb när portarna står tätt mot varandra. Får inte vara 0 – då
 * ligger svängpunkten PÅ porten och pilspetsens riktning tappas.
 */
const MIN_STUB_FACING = 2;

/**
 * Stubblängden när portarna står MOT VARANDRA (botten→topp, höger→vänster …):
 * halva avståndet mellan dem, så att BÅDA stubbarna slutar på samma korridor.
 *
 * Fast stubb (14) sprack i en trång radlucka: pilen ut ur ett besluts botten
 * stack 14 ner, medan stubben framför mottagarens topp låg högre upp. A* kunde
 * då inte gå rakt mellan dem utan tog vägen runt mottagaren och kom in i
 * toppen bakvägen – en krok som såg ut som att pilen kom från fel håll, och
 * som dessutom drog linjen tvärs genom mottagarens ruta. Möts stubbarna på
 * samma höjd blir vägen tre raka stycken: ut, över, ner i porten.
 *
 * Bara mötande portar räknas. Står de åt samma håll (t.ex. botten→botten) är
 * halva avståndet ingen korridor, och den fasta stubben är rätt.
 */
function facingStub(req: RouteRequest): number | null {
  const { from, to, fromSide, toSide } = req;
  const d =
    fromSide === "bottom" && toSide === "top" && to.y > from.y
      ? to.y - from.y
      : fromSide === "top" && toSide === "bottom" && to.y < from.y
        ? from.y - to.y
        : fromSide === "right" && toSide === "left" && to.x > from.x
          ? to.x - from.x
          : fromSide === "left" && toSide === "right" && to.x < from.x
            ? from.x - to.x
            : null;
  if (d === null) return null;
  const halva = Math.floor(d / 2);
  return halva >= STUB ? null : Math.max(MIN_STUB_FACING, halva);
}
/** Marginal runt hinder – vägen håller sig så här långt ifrån. */
const CLEARANCE = 10;
/** Kostnad per sväng, i "pixelekvivalenter" – gör raka vägar billigare. */
const TURN_COST = 40;
/**
 * FRAMÅTREGELN: att färdas åt VÄNSTER kostar extra. Flödet läser
 * vänster→höger, så när två omvägar är ungefär lika långa ska routern välja
 * den som passerar på objektets HÖGERSIDA – en vänsterloop läses som att
 * flödet backar. Straffet är litet nog att en genuint vänsterriktad kant
 * (målet ligger till vänster) fortfarande går kortaste vägen.
 */
const LEFT_PENALTY = 0.3;

/** Axel som en port sticker ut längs: vågrät för vänster/höger, annars lodrät. */
function axisOf(side: Side): "h" | "v" {
  return side === "left" || side === "right" ? "h" : "v";
}

/** Kanten på bandet som pilen aldrig får landa i: etikettfliken plus lite luft. */
const BAND_MARGINAL = 12;

/**
 * VAR ett meddelandeflöde landar på mottagarbandets ovankant (absolut x).
 *
 * Förvalet är RAKT NEDANFÖR AVSÄNDAREN: bandet är brett som hela sidan, så det
 * finns ingen naturlig mittpunkt att sikta på, och en lodrät pil läses som "det
 * här meddelandet kommer härifrån". Har användaren dragit landningspunkten (då
 * bär flödet `targetPos`, en andel av bandets bredd) gäller den i stället –
 * automatiken är ett förval, inte ett förbud.
 *
 * EN implementation, delad av bandets handtag i canvasen, kantens utpekade port
 * och SVG-/draw.io-exporten. Låg räkningen på flera ställen kunde handtaget och
 * den ritade pilen hamna på olika x – och det gjorde de: pilens slut satt kvar
 * på bandets cachade handtagsläge när avsändaren flyttades.
 */
export function messageFlowLandning(
  mf: { targetPos?: number },
  band: { x: number; w: number; labelW: number },
  /** Avsändarnodens mitt-x i samma koordinatrymd som bandet. */
  avsändarMittX: number | undefined,
): number {
  const önskad =
    mf.targetPos === undefined
      ? (avsändarMittX ?? band.x + band.w / 2)
      : band.x + Math.min(1, Math.max(0, mf.targetPos)) * band.w;
  // Aldrig in i etikettfliken, aldrig utanför bandet.
  const min = band.x + band.labelW + BAND_MARGINAL;
  const max = band.x + band.w - BAND_MARGINAL;
  return Math.min(Math.max(önskad, min), Math.max(min, max));
}

/** Motsatsen: vilken andel av bandets bredd en absolut x-punkt motsvarar. */
export function messageFlowAndel(band: { x: number; w: number }, x: number): number {
  if (band.w <= 0) return 0.5;
  return Math.min(1, Math.max(0, (x - band.x) / band.w));
}

/**
 * ISO 5807-regeln för vilka sidor en kant ansluter till: mot flödesriktningen.
 * Ligger målet på en annan rad (tydlig lodrät separation) går kanten
 * topp↔botten, annars sida↔sida. Manuella val vinner alltid.
 *
 * EN implementation, delad av canvasen och SVG-exporten. Regeln låg tidigare
 * duplicerad i båda – varje justering måste då göras två gånger, och missades
 * den ena divergerade skärm och fil. Ändra den HÄR, ingen annanstans.
 */
export function pickEdgeSides(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  manual?: { sourceSide?: Side; targetSide?: Side; label?: string },
): [Side, Side] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  const differentRow = Math.abs(dy) > a.h / 2 + b.h / 2;
  let sa: Side;
  let sb: Side;
  // FASTSLAGEN REGEL, bestämd flera gånger: en koppling som kommer OVANIFRÅN går in
  // i objektets OVANSIDA – inte i sidan. MÅLSIDAN är därför alltid topp/botten
  // när målet ligger på en annan rad, oavsett hur många kolumner åt sidan det
  // ligger. Den delen av villkoret får aldrig kompletteras med ett kolumnkrav.
  if (differentRow) {
    sb = dy >= 0 ? "top" : "bottom";
    // KÄLLSIDAN är däremot fri, och botten är fel när målet står snett FRAMÅT:
    // pilen gick då ner, vek av i sidled precis i banskiljaren och föll ner i
    // toppen – ett L som såg ut att följa banans kant i stället för flödet.
    // Ut åt SIDAN och sedan ner i toppen läses som det ska.
    //
    // Två undantag, båda med sitt skäl:
    //  - En GREN (kanten bär en etikett, Ja/Nej) lämnar alltid botten. Annars
    //    delar beslutets båda grenar samma port och ligger omlott en bit.
    //  - Bara NÄRLIGGANDE kolumner. Ligger målet långt bort går sidoutgången
    //    rakt in i raden som står emellan, och routern måste kränga sig runt.
    const gren = Boolean(manual?.label);
    const annanKolumn = Math.abs(dx) > a.w / 2 + b.w / 2;
    const närliggande = Math.abs(dx) < (a.w + b.w) * 1.5;
    sa = !gren && annanKolumn && närliggande && dx > 0 ? "right" : dy >= 0 ? "bottom" : "top";
  } else {
    [sa, sb] = dx >= 0 ? ["right", "left"] : ["left", "right"];
  }
  if (manual?.sourceSide) sa = manual.sourceSide;
  if (manual?.targetSide) sb = manual.targetSide;
  return [sa, sb];
}

/**
 * Ortogonal väg från `start` genom brytpunkten `via` till `end`, med räta
 * vinklar. Första benet lämnar `start` längs källportens axel och når `via` längs
 * den vinkelräta axeln. Andra benet MÅSTE lämna `via` längs den FÖRSTA axeln igen
 * (vinkelrätt mot hur det kom in) – annars blir `via` en återvändsspik som
 * förenklingen kapar, och brytpunkten försvinner. `via` blir då ett äkta hörn.
 */
function orthThrough(start: Point, via: Point, end: Point, fromSide: Side): Point[] {
  if (axisOf(fromSide) === "h") {
    // Ut vågrätt, ner/upp till via, ut vågrätt igen, sedan lodrätt till end.
    return [{ x: via.x, y: start.y }, via, { x: end.x, y: via.y }];
  }
  // Ut lodrätt, i sidled till via, lodrätt igen, sedan vågrätt till end.
  return [{ x: start.x, y: via.y }, via, { x: via.x, y: end.y }];
}

/**
 * Som `orthThrough`, men genom TVÅ punkter. Axlarna växlar på samma sätt: ut
 * längs portens axel till första punkten, tvärs, längs axeln till den andra,
 * tvärs – och sist till `end`. Med en punkt blir det exakt `orthThrough`.
 */
function orthThroughTwo(start: Point, v1: Point, v2: Point, end: Point, fromSide: Side): Point[] {
  if (axisOf(fromSide) === "h") {
    return [{ x: v1.x, y: start.y }, v1, { x: v2.x, y: v1.y }, v2, { x: end.x, y: v2.y }];
  }
  return [{ x: start.x, y: v1.y }, v1, { x: v1.x, y: v2.y }, v2, { x: v2.x, y: end.y }];
}

/**
 * DEN SISTA STRÄCKAN – den som går tvärs in mot målets stubbe – och om den
 * går att flytta i sidled.
 *
 * Med en enda brytpunkt ligger den på stubbens koordinat, framför målets port,
 * och ingenting i mellanlagret styr den. Den finns bara när källans och målets
 * portar har samma axel (höger/vänster → höger/vänster, eller topp/botten →
 * topp/botten); annars är sista sträckan brytpunktens egen och flyttas med den.
 *
 * Svaret säger vilken koordinat sträckan ligger på (`axel`: "x" = en lodrät
 * sträcka som flyttas i sidled) och hur man gör om ett drag till `via2`:
 * punkten i höjd med målets port, så att pilen går rakt in.
 */
export function sistaSträckan(
  fromSide: Side,
  to: Point,
  toSide: Side,
): { axel: "x" | "y"; via2: (p: Point) => Point } | null {
  if (axisOf(fromSide) !== axisOf(toSide)) return null;
  return axisOf(toSide) === "h"
    ? { axel: "x", via2: (p) => ({ x: p.x, y: to.y }) }
    : { axel: "y", via2: (p) => ({ x: to.x, y: p.y }) };
}

/** Vilken koordinat ett drag i en sträcka ändrar. */
export type Sträckgrepp = "via.x" | "via.y" | "via2.x" | "via2.y";

/**
 * DE STRÄCKOR PÅ EN MANUELL VÄG SOM GÅR ATT DRA – och vad draget ändrar.
 *
 * Ett handtag på en punkt räcker inte när vägen är tusentals pixlar lång:
 * 2.2.1:s "Byter annonstyp" har brytpunkten längst ut till höger och sista
 * sträckan långt ner till vänster, och i en normal vy syntes inget av dem
 * ("nu kan jag bara hantera högra delen av flödet", 2026-09-30). Man
 * tar i stället tag i LINJEN där man ser den, som i andra ritverktyg:
 *
 *  - sträckan på brytpunktens x (lodrät) flyttar punkten i sidled,
 *  - sträckan på brytpunktens y (vågrät, t.ex. rälsen) flyttar den i höjdled,
 *  - SISTA sträckan in mot målet flyttas i sidled och sätter `via2`
 *    (se `sistaSträckan`).
 *
 * Stubbarna vid portarna och sträckor som ligger på portens egen linje går
 * inte att dra – de bestäms av objekten. `i` är index för sträckans FÖRSTA
 * punkt i `pts`.
 */
export function dragbaraSträckor(
  pts: Point[],
  req: { fromSide: Side; to: Point; toSide: Side; via?: Point | null },
): { i: number; grepp: Sträckgrepp }[] {
  const via = req.via;
  if (!via || pts.length < 4) return [];
  const sista = sistaSträckan(req.fromSide, req.to, req.toSide);
  const ut: { i: number; grepp: Sträckgrepp }[] = [];
  const nära = (a: number, b: number) => Math.abs(a - b) <= RAK_TOLERANS + 1;
  // Första och sista sträckan är stubbar vid portarna.
  for (let i = 1; i <= pts.length - 3; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const lodrät = a.x === b.x;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 12) continue;
    if (sista && i + 1 === pts.length - 2 && lodrät === (sista.axel === "x")) {
      ut.push({ i, grepp: sista.axel === "x" ? "via2.x" : "via2.y" });
    } else if (lodrät && nära(a.x, via.x)) {
      ut.push({ i, grepp: "via.x" });
    } else if (!lodrät && nära(a.y, via.y)) {
      ut.push({ i, grepp: "via.y" });
    }
  }
  return ut;
}

/**
 * Stubben ut från en port, men ALDRIG längre än till brytpunkten.
 *
 * Stubben finns för att pilen ska lämna objektet rakt ut innan den viker av.
 * Ligger brytpunkten närmare än så blir stubben en spik: vägen går ut, och
 * sedan tillbaka samma väg. Punkten kapas därför vid brytpunktens egen
 * koordinat längs utgångsaxeln.
 */
function kapadStubb(p: Point, side: Side, via: Point, stubb: number): Point {
  // SIGNERAT avstånd i utgångsriktningen. Ligger brytpunkten BAKOM porten finns
  // inget att kapa mot – då gäller hela stubben, för avgången måste vara axiell
  // (pilspetsen ska möta porten längs portens egen axel, se regressionstestet).
  // Ett obetingat Math.abs gav noll stubbe när punkten låg i höjd med porten,
  // och då lämnade vägen objektet i sidled.
  const framåt =
    side === "bottom" ? via.y - p.y
    : side === "top" ? p.y - via.y
    : side === "right" ? via.x - p.x
    : p.x - via.x;
  if (!(framåt > 0)) return outward(p, side, stubb);
  return outward(p, side, Math.min(stubb, framåt));
}

function outward(p: Point, side: Side, dist: number): Point {
  switch (side) {
    case "top": return { x: p.x, y: p.y - dist };
    case "bottom": return { x: p.x, y: p.y + dist };
    case "left": return { x: p.x - dist, y: p.y };
    case "right": return { x: p.x + dist, y: p.y };
  }
}


/** Skär segmentet p→q (ortogonalt) någon rektangel? */
function segmentHits(p: Point, q: Point, obstacles: Rect[], pad: number): boolean {
  const minX = Math.min(p.x, q.x);
  const maxX = Math.max(p.x, q.x);
  const minY = Math.min(p.y, q.y);
  const maxY = Math.max(p.y, q.y);
  for (const r of obstacles) {
    const rx1 = r.x - pad;
    const rx2 = r.x + r.w + pad;
    const ry1 = r.y - pad;
    const ry2 = r.y + r.h + pad;
    // Överlappar segmentets omslutande låda rektangeln? (segmentet är axelrätt)
    if (maxX > rx1 && minX < rx2 && maxY > ry1 && minY < ry2) return true;
  }
  return false;
}

function sorted(nums: number[]): number[] {
  return [...new Set(nums.map((n) => Math.round(n)))].sort((a, b) => a - b);
}

/**
 * Kompletterar en linjelista med mittpunkter mellan intilliggande linjer.
 * De blir kanaler MELLAN objekten – utan dem saknar A* en väg att gå runt när
 * ett objekt ligger rakt i vägen, och faller tillbaka på en väg rakt igenom.
 */
function withChannels(lines: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    if (i + 1 < lines.length && lines[i + 1] - lines[i] > 4) {
      out.push(Math.round((lines[i] + lines[i + 1]) / 2));
    }
  }
  return sorted(out);
}

/* -------------------------------------------------------------------- */
/* Vägcachen                                                            */
/* -------------------------------------------------------------------- */

/**
 * FÄRDIGA VÄGAR SPARAS – för att ritytan frågar om samma väg om och om igen.
 *
 * Ruttningen är en REN funktion av portarna, sidorna, brytpunkten och
 * hinderuppsättningen (se modulens inledning): samma indata ger alltid samma
 * väg. React Flow renderar däremot om kantlagret vid varje musruck under en
 * panorering och vid varje zoomsteg, och varje omrendering räknade fram
 * exakt samma vägar en gång till. För 4.4.3 (107 objekt, 108 kopplingar) blev
 * fem panoreringsdrag ~20 sekunder låst huvudtråd, med 85 % av tiden i
 * routern (2026-09-10: "det går jättelångsamt … att scrolla en
 * process"). Inget av det som avgör vägen ändras av att man flyttar kameran.
 *
 * CACHEN ÄNDRAR ALDRIG VAD ROUTERN SVARAR. Nyckeln bär hela indata – de
 * avrundade portarna, sidorna och brytpunkten plus hinderuppsättningens antal
 * och en hash av alla rutor – och en träff kontrolleras DESSUTOM ruta för ruta
 * mot de hinder som faktiskt skickades in. En hashkrock kan därför inte ge fel
 * väg; den ger bara en miss.
 *
 * Punktlistan kopieras ut vid varje träff. Den som får en väg ska kunna göra
 * vad den vill med den utan att nästa anropare får en förändrad väg.
 */
const VÄGCACHE_MAX = 2000;
const vägcache = new Map<string, { obstacles: Rect[]; pts: Point[] }>();

/** Tömmer vägcachen. Finns för testerna – appen behöver den aldrig. */
export function nollställVägcache(): void {
  vägcache.clear();
}

/**
 * FNV-1a över hinderrutornas fyra tal. Bara en NYCKEL, aldrig ett bevis:
 * träffen verifieras mot rutorna i `sammaHinder`.
 */
function hinderHash(obstacles: Rect[]): number {
  let h = 0x811c9dc5;
  for (const r of obstacles) {
    h = Math.imul(h ^ (r.x | 0), 0x01000193);
    h = Math.imul(h ^ (r.y | 0), 0x01000193);
    h = Math.imul(h ^ (r.w | 0), 0x01000193);
    h = Math.imul(h ^ (r.h | 0), 0x01000193);
  }
  return h >>> 0;
}

/** Är det samma hinderuppsättning, ruta för ruta? */
function sammaHinder(a: Rect[], b: Rect[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y || a[i].w !== b[i].w || a[i].h !== b[i].h) {
      return false;
    }
  }
  return true;
}

function vägnyckel(req: RouteRequest): string {
  // SAMMA avrundning som routern gör på sin första rad. Utan den fick en port
  // med decimaljitter (ett draget objekt ger t.ex. y=538.767) en egen post
  // trots att vägen blev densamma.
  const r = Math.round;
  const via = req.via ? `${r(req.via.x)},${r(req.via.y)}` : "-";
  const via2 = req.via && req.via2 ? `;${r(req.via2.x)},${r(req.via2.y)}` : "";
  return (
    `${r(req.from.x)},${r(req.from.y)},${req.fromSide}|` +
    `${r(req.to.x)},${r(req.to.y)},${req.toSide}|${via}${via2}|` +
    `${req.obstacles.length}|${hinderHash(req.obstacles)}`
  );
}

/**
 * Routar en kant. Faller tillbaka på en enkel L/Z-väg om A* inte hittar något
 * (t.ex. helt inringad port) så att en kant alltid ritas.
 */
export function routeEdge(req: RouteRequest): Point[] {
  const nyckel = vägnyckel(req);
  const träff = vägcache.get(nyckel);
  if (träff && sammaHinder(träff.obstacles, req.obstacles)) {
    return träff.pts.map((p) => ({ x: p.x, y: p.y }));
  }
  const pts = beräknaVäg(req);
  // Enkel spärr mot obegränsad tillväxt. Ett utlägg har ett hundratal
  // kopplingar, så taket rymmer flera flöden samtidigt; töms den någon gång
  // kostar det en omräkning – aldrig ett annat svar.
  if (vägcache.size >= VÄGCACHE_MAX) vägcache.clear();
  vägcache.set(nyckel, { obstacles: req.obstacles, pts });
  return pts.map((p) => ({ x: p.x, y: p.y }));
}

function beräknaVäg(req: RouteRequest): Point[] {
  // ALLA koordinater avrundas vid ingången. Rutnätets linjer avrundas
  // (`sorted`), och en port med decimaler (manuellt dragna objekt ger t.ex.
  // y=538.767) matchade då aldrig rutnätet: A* stod utan grannar och gav upp
  // TYST – varje kant som rörde ett draget objekt ritades av nödvägen, med
  // vänsterloopar och genomplöjningar som följd. En halv pixel på porten syns
  // inte; en trasig väg syns direkt.
  const rnd = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });
  req = {
    ...req,
    from: rnd(req.from),
    to: rnd(req.to),
    via: req.via ? rnd(req.via) : req.via,
    via2: req.via && req.via2 ? rnd(req.via2) : null,
  };
  req = snäppBrytpunkt(req);
  req = rätaNästanRaka(req);
  // Mötande portar delar korridor (facingStub) – annars den fasta stubben.
  const stubb = facingStub(req) ?? STUB;
  const start = rnd(outward(req.from, req.fromSide, stubb));
  const end = rnd(outward(req.to, req.toSide, stubb));

  // Manuell brytpunkt: användaren äger vägen. Räta vinklar genom punkten, ingen
  // väjning – annars skulle routern kunna dra tillbaka kanten till sidan man
  // just flyttade den ifrån.
  if (req.via) {
    // STUBBEN FÅR INTE SKJUTA FÖRBI BRYTPUNKTEN. Ligger punkten närmare porten
    // än stubbens längd vek vägen först UT och sedan tillbaka – en spik på några
    // pixlar som läses som ett ritfel. Syntes tydligt när brytpunkten låg strax
    // under ett beslut och man bytte kopplingssida på målet.
    const s = kapadStubb(req.from, req.fromSide, req.via, stubb);
    const e = kapadStubb(req.to, req.toSide, req.via2 ?? req.via, stubb);
    return simplify([
      req.from,
      s,
      ...(req.via2
        ? orthThroughTwo(s, req.via, req.via2, e, req.fromSide)
        : orthThrough(s, req.via, e, req.fromSide)),
      e,
      req.to,
    ]);
  }

  // Rutnätslinjer: hindrens kanter (± marginal), start/mål och deras stubbar.
  const xs = withChannels(
    sorted([
      req.from.x,
      req.to.x,
      start.x,
      end.x,
      ...req.obstacles.flatMap((r) => [r.x - CLEARANCE, r.x + r.w + CLEARANCE]),
    ]),
  );
  const ys = withChannels(
    sorted([
      req.from.y,
      req.to.y,
      start.y,
      end.y,
      ...req.obstacles.flatMap((r) => [r.y - CLEARANCE, r.y + r.h + CLEARANCE]),
    ]),
  );

  // Se till att stubbarnas exakta koordinater finns som rutnätslinjer.
  const gx = sorted([...xs, start.x, end.x]);
  const gy = sorted([...ys, start.y, end.y]);
  /** Antal rutnätslinjer i y-led – radlängden i `spärrad`. */
  const antalY = gy.length;

  /**
   * SPÄRRADE RUTNÄTSPUNKTER – markerade PER HINDER, inte prövade per punkt.
   *
   * Regeln är oförändrad: en punkt är spärrad när den ligger STRIKT inuti en
   * hinderruta. Men den räknades förut genom att varje punkt i nätet prövades
   * mot varje hinder, och nätet växer med antalet hinder: 4.4.3 (107 objekt)
   * gav 394 × 161 punkter, alltså 6,8 MILJONER rektangeltest – per koppling,
   * och 108 kopplingar per omritning. Det gick åt 5 sekunder till att räkna
   * fram samma svar som en gång räckt, och ritytan renderar om kantlagret vid
   * varje musruck (2026-09-10: "det går jättelångsamt att scrolla").
   *
   * Nu vänds slingan: rutnätslinjerna är sorterade, så varje hinder täcker ett
   * SAMMANHÄNGANDE indexintervall i x och y som slås upp binärt. Bara de
   * punkter som faktiskt ligger inuti något hinder rörs. Utfallet är exakt
   * detsamma – `edge-router.test.ts` låser det, och hela flödesbiblioteket
   * ruttades om och jämfördes väg för väg innan bytet gjordes.
   *
   * Uint8Array i stället för en Set med strängnycklar: 63 000 strängar per
   * koppling stod för en tiondel av tiden i skräpsamlaren allena.
   */
  const spärrad = new Uint8Array(gx.length * antalY);
  for (const r of req.obstacles) {
    const i0 = förstaÖver(gx, r.x);
    const i1 = sistaUnder(gx, r.x + r.w);
    if (i0 > i1) continue;
    const j0 = förstaÖver(gy, r.y);
    const j1 = sistaUnder(gy, r.y + r.h);
    if (j0 > j1) continue;
    for (let i = i0; i <= i1; i++) {
      const bas = i * antalY;
      for (let j = j0; j <= j1; j++) spärrad[bas + j] = 1;
    }
  }
  // Stubbarna är alltid giltiga vägpunkter, även om de råkar ligga inne i ett
  // hinder (t.ex. ett tätt intilliggande objekt): pilen MÅSTE gå via stubben,
  // annars kan sista segmentet komma in från fel håll.
  const si = linjeIndex(gx, start.x);
  const sj = linjeIndex(gy, start.y);
  const ei = linjeIndex(gx, end.x);
  const ej = linjeIndex(gy, end.y);
  // Stubbarna ligger alltid i nätet (gx/gy byggs med dem). Skulle de mot
  // förmodan inte göra det finns ingen väg att söka – då gäller reservvägen,
  // precis som när A* går bet.
  if (si >= 0 && sj >= 0 && ei >= 0 && ej >= 0) {
    spärrad[si * antalY + sj] = 0;
    spärrad[ei * antalY + ej] = 0;
  }

  /**
   * INVARIANT (pilspetsens riktning): vägen slutar ALLTID [… → end → to], där
   * end är stubben rakt utanför målporten. Sista segmentet ligger då längs
   * portens axel och pilspetsen (orient=auto) pekar in i objektet – aldrig i
   * sidled. Tidigare föll routern tillbaka på en väg SIKTAD PÅT PORTEN direkt;
   * ankomsten kunde då bli vågrät in i en topp-port, den påklistrade stubben
   * blev en 14 px-spik och förenklingen klippte bort den. Det är därför pilar
   * "uppifrån" har kunnat peka åt höger, gång på gång. A* går nu alltid mot
   * stubben, och reservvägen likaså.
   */
  const path =
    si >= 0 && sj >= 0 && ei >= 0 && ej >= 0
      ? astar(si, sj, ei, ej, gx, gy, spärrad, req.obstacles)
      : null;
  const mitten = path ?? detour(start, end, req.obstacles);
  const full = [req.from, start, ...mitten, end, req.to];
  return simplify(full);
}

/**
 * Hur långt två MOTSTÅENDE portar får ligga isär och ändå räknas som "på samma
 * linje" (px).
 *
 * Måttet är uppmätt, inte valt. Över de sparade affärsprocesserna ligger
 * avvikelsen mellan två motstående portar antingen under 2,1 px (93 kopplingar) eller
 * över 10 px (21 kopplingar) – däremellan finns knappt något. Den undre
 * klungan är brus: symbolens mitt sitter olika långt ner i rutan för olika
 * sorter (en aktivitet på h/2, ett verksamhetsobjekt på ikonens mitt), och
 * koordinater skalas med en bråkdel innan de avrundas. Den övre är
 * riktig geometri – ett L som ska ritas som ett L. Tröskeln läggs i gapet.
 */
const RAK_TOLERANS = 3;

/**
 * Drar två nästan raka portar till samma linje.
 *
 * Utan det svarade routern på en enda pixels skillnad med ett litet hack strax
 * före målet – segmenten mätte [97, 1, 14] – och "typ varannan koppling är
 * krokig på något ställe" (2026-09-08, 4.4.6). En pixel syns inte på
 * porten; hacket syns direkt.
 *
 * Bara MOTSTÅENDE sidor (höger→vänster, botten→topp och deras spegling) rörs:
 * där är en rak linje det väntade utfallet. Ett L (höger→topp) ska förbli ett
 * L, och en dragen brytpunkt äger vägen helt – då rörs ingenting.
 */
/**
 * Snäpper BRYTPUNKTEN till portens linje när den ligger nästan på den.
 *
 * En brytpunkt äger vägen, men en pixel är inget val: en sparad punkt på
 * y=416 mot en port på y=415 gav svansen ett hack – vägen gick fram till
 * målets höjd, en pixel fel, och routern la till två böjar för att komma in.
 * "Information diarieförd → Avslutar ärende" ritades med fyra böjar där två
 * räcker ("linjerna går fortfarande i svängar", 2026-09-09).
 *
 * Samma tolerans som för nästan raka portar (RAK_TOLERANS): under den syns
 * ingen skillnad på punkten, men hacket syns direkt. Bara SNÄPPNING – en
 * punkt som ligger längre bort rörs inte, för då är avvikelsen ett val.
 */
function snäppBrytpunkt(req: RouteRequest): RouteRequest {
  if (!req.via) return req;
  const nära = (a: number, b: number) => a !== b && Math.abs(a - b) <= RAK_TOLERANS;
  let { x, y } = req.via;
  if (nära(y, req.to.y)) y = req.to.y;
  else if (nära(y, req.from.y)) y = req.from.y;
  if (nära(x, req.to.x)) x = req.to.x;
  else if (nära(x, req.from.x)) x = req.from.x;
  return x === req.via.x && y === req.via.y ? req : { ...req, via: { x, y } };
}

function rätaNästanRaka(req: RouteRequest): RouteRequest {
  if (req.via) return req;
  const vågrät = (s: Side) => s === "left" || s === "right";
  if (vågrät(req.fromSide) !== vågrät(req.toSide)) return req;
  if (req.fromSide === req.toSide) return req;
  const axel = vågrät(req.fromSide) ? "y" : "x";
  const diff = req.from[axel] - req.to[axel];
  if (diff === 0 || Math.abs(diff) > RAK_TOLERANS) return req;
  const linje = Math.round((req.from[axel] + req.to[axel]) / 2);
  return {
    ...req,
    from: { ...req.from, [axel]: linje },
    to: { ...req.to, [axel]: linje },
  };
}

/* Rutnätslinjerna är sorterade och unika – uppslagen nedan är binära. */

/** Lägsta index vars linje ligger STRIKT över `v` (= listans längd om ingen). */
function förstaÖver(linjer: number[], v: number): number {
  let lo = 0;
  let hi = linjer.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (linjer[m] > v) hi = m;
    else lo = m + 1;
  }
  return lo;
}

/** Högsta index vars linje ligger STRIKT under `v` (= −1 om ingen). */
function sistaUnder(linjer: number[], v: number): number {
  let lo = 0;
  let hi = linjer.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (linjer[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo - 1;
}

/** Index för en linje med exakt värdet `v` (= −1 om den inte finns). */
function linjeIndex(linjer: number[], v: number): number {
  let lo = 0;
  let hi = linjer.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (linjer[m] === v) return m;
    if (linjer[m] < v) lo = m + 1;
    else hi = m - 1;
  }
  return -1;
}

/**
 * Sista utväg när A* inte hittar något: gå ut vid sidan om alla hinder mellan
 * punkterna i stället för rakt igenom. Alltid ortogonal, korsar aldrig.
 */
function detour(from: Point, to: Point, obstacles: Rect[]): Point[] {
  const mellan = obstacles.filter(
    (r) =>
      r.x + r.w > Math.min(from.x, to.x) &&
      r.x < Math.max(from.x, to.x) &&
      r.y + r.h > Math.min(from.y, to.y) &&
      r.y < Math.max(from.y, to.y),
  );
  if (mellan.length === 0) return [from, { x: to.x, y: from.y }, to];
  // FRAMÅTREGELN: vik ut till HÖGER om det som ligger emellan. Flödet läser
  // vänster→höger, så en omväg på högersidan följer läsriktningen – en väg som
  // viker bakåt/vänster om ett objekt läses som att flödet backar.
  const höger = Math.max(...mellan.map((r) => r.x + r.w)) + CLEARANCE + STUB;
  return [
    from,
    { x: höger, y: from.y },
    { x: höger, y: to.y },
    to,
  ];
}

interface AStarNode {
  /** Index i `gx` respektive `gy` – noden ÄR en rutnätspunkt. */
  i: number;
  j: number;
  x: number;
  y: number;
  g: number;
  f: number;
  dir: "h" | "v" | null;
  prev: AStarNode | null;
  /**
   * Insättningsordning. Bär TURORDNINGEN mellan noder med samma f, och är
   * därför inte en detalj: se `före`.
   */
  seq: number;
}

/**
 * Vilken av två öppna noder som ska plockas först.
 *
 * Lägst f vinner. VID LIKA f VINNER DEN SOM LADES IN FÖRST – och den regeln
 * måste stå kvar. Den öppna mängden var förut en vanlig array som söktes
 * igenom linjärt (`open[i].f < open[bi].f`, alltså första index med lägsta f)
 * och tömdes med `splice`, som bevarar inbördes ordning: valet var alltså
 * "äldst av de billigaste". A* med en annan tie-break hittar en LIKA BILLIG
 * men ANNAN väg – och en väg som byter utseende utan att någon rört flödet är
 * precis det bilden inte får göra. `seq` bevarar den gamla ordningen exakt.
 */
function före(a: AStarNode, b: AStarNode): boolean {
  return a.f !== b.f ? a.f < b.f : a.seq < b.seq;
}

/**
 * MINHÖG över de öppna noderna.
 *
 * Linjärsökningen den ersätter var O(n) per uttag och `splice` ytterligare
 * O(n) – med ett hundratal objekt i utlägget växte den öppna mängden till
 * tusentals noder och sökningen dominerade sig själv. Högen gör uttaget till
 * O(log n) utan att ändra VILKEN nod som plockas (se `före`).
 */
class Hög {
  private v: AStarNode[] = [];

  get längd(): number {
    return this.v.length;
  }

  push(n: AStarNode): void {
    const v = this.v;
    v.push(n);
    let i = v.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!före(v[i], v[p])) break;
      const tmp = v[i];
      v[i] = v[p];
      v[p] = tmp;
      i = p;
    }
  }

  pop(): AStarNode | undefined {
    const v = this.v;
    const topp = v[0];
    const sista = v.pop();
    if (v.length && sista) {
      v[0] = sista;
      let i = 0;
      for (;;) {
        const vä = 2 * i + 1;
        const hö = vä + 1;
        let m = i;
        if (vä < v.length && före(v[vä], v[m])) m = vä;
        if (hö < v.length && före(v[hö], v[m])) m = hö;
        if (m === i) break;
        const tmp = v[i];
        v[i] = v[m];
        v[m] = tmp;
        i = m;
      }
    }
    return topp;
  }
}

function astar(
  si: number,
  sj: number,
  ti: number,
  tj: number,
  xs: number[],
  ys: number[],
  /** 1 = punkten ligger inuti ett hinder. Indexeras `i * ys.length + j`. */
  spärrad: Uint8Array,
  obstacles: Rect[],
): Point[] | null {
  /** Radlängden i `spärrad` – samma som antalet y-linjer. */
  const antalY = ys.length;
  const sx = xs[si];
  const sy = ys[sj];
  const tx = xs[ti];
  const ty = ys[tj];
  const h = (x: number, y: number) => Math.abs(x - tx) + Math.abs(y - ty);

  const öppna = new Hög();
  öppna.push({ i: si, j: sj, x: sx, y: sy, g: 0, f: h(sx, sy), dir: null, prev: null, seq: 0 });
  let seq = 1;
  // Nyckeln är rutnätspunkten OCH riktningen man kom in i den med – ett tal,
  // inte en sträng: strängnycklarna var en egen post i skräpsamlarens budget.
  const bäst = new Map<number, number>();

  while (öppna.längd) {
    const cur = öppna.pop()!;
    if (cur.i === ti && cur.j === tj) return rebuild(cur);

    // ORDNINGEN på grannarna är turordningen vid lika f (se `före`) och ska
    // vara densamma som förut: höger, vänster, ner, upp.
    const grannar: { i: number; j: number; x: number; y: number; dir: "h" | "v" }[] = [];
    if (cur.i + 1 < xs.length)
      grannar.push({ i: cur.i + 1, j: cur.j, x: xs[cur.i + 1], y: cur.y, dir: "h" });
    if (cur.i - 1 >= 0)
      grannar.push({ i: cur.i - 1, j: cur.j, x: xs[cur.i - 1], y: cur.y, dir: "h" });
    if (cur.j + 1 < ys.length)
      grannar.push({ i: cur.i, j: cur.j + 1, x: cur.x, y: ys[cur.j + 1], dir: "v" });
    if (cur.j - 1 >= 0)
      grannar.push({ i: cur.i, j: cur.j - 1, x: cur.x, y: ys[cur.j - 1], dir: "v" });

    for (const n of grannar) {
      if (spärrad[n.i * antalY + n.j]) continue;
      // Första hoppet (ut ur startstubben) och sista (in i målstubben) får
      // passera ett hinders röjningszon: ligger stubben tätt intill ett annat
      // objekt (användaren har packat dem) var den annars onåbar, A* gav upp
      // och reservvägen plöjde rakt genom saker. Pilens riktning skyddas ändå
      // av stubben – in-/utfarten ligger alltid längs portens axel.
      const sistaHopp = n.i === ti && n.j === tj;
      const förstaHopp = cur.i === si && cur.j === sj;
      if (!sistaHopp && !förstaHopp && segmentHits(cur, n, obstacles, CLEARANCE - 1)) continue;
      const svängKostnad = cur.dir && cur.dir !== n.dir ? TURN_COST : 0;
      // Framåtregeln: vänsterfärd bär ett litet påslag (se LEFT_PENALTY).
      const vänsterKostnad = n.x < cur.x ? (cur.x - n.x) * LEFT_PENALTY : 0;
      const g = cur.g + Math.abs(n.x - cur.x) + Math.abs(n.y - cur.y) + svängKostnad + vänsterKostnad;
      const k = (n.i * antalY + n.j) * 2 + (n.dir === "h" ? 0 : 1);
      const tidigare = bäst.get(k);
      if (tidigare !== undefined && tidigare <= g) continue;
      bäst.set(k, g);
      öppna.push({
        i: n.i,
        j: n.j,
        x: n.x,
        y: n.y,
        g,
        f: g + h(n.x, n.y),
        dir: n.dir,
        prev: cur,
        seq: seq++,
      });
    }
  }
  return null;
}

function rebuild(node: AStarNode): Point[] {
  const out: Point[] = [];
  let n: AStarNode | null = node;
  while (n) {
    out.unshift({ x: n.x, y: n.y });
    n = n.prev;
  }
  return out;
}

/**
 * Tar bort kolinjära mellanpunkter och dubbletter.
 *
 * En mittpunkt får BARA tas bort när vägen passerar rakt igenom den – aldrig
 * när den VÄNDER där (a → förbi b → tillbaka). Utan riktningskravet raderades
 * målstubben när vägen sköt förbi porten och vek tillbaka, sista segmentet
 * bytte håll och pilspetsen pekade åt fel håll in i objektet.
 */
function simplify(pts: Point[]): Point[] {
  const rensad: Point[] = [];
  for (const p of pts) {
    const sista = rensad[rensad.length - 1];
    if (sista && sista.x === p.x && sista.y === p.y) continue;
    rensad.push({ ...p });
  }
  const out: Point[] = [];
  for (let i = 0; i < rensad.length; i++) {
    const a = out[out.length - 1];
    const b = rensad[i];
    const c = rensad[i + 1];
    if (a && c) {
      // Tre punkter på samma linje – två fall, och bara det ena får bort b.
      //
      // FRAMÅT: b ligger mitt på ett rakt streck och säger ingenting. Bort.
      //
      // VÄNDNING: vägen går ut och tillbaka längs samma linje – en SPIK, som
      // ritas som ett litet hak och som blev en synlig ögla när hörnen
      // rundades (2026-09-07, rollernas streck i affärsprocessvyn). Den får bort
      // b BARA när vändningen är partiell, alltså när c ligger kvar på samma
      // sida om a som b: då är b bara en stubbe som skjutit för långt, och
      // vägen a→c går åt samma håll som förut, bara kortare.
      //
      // Vänder vägen ända tillbaka till a eller förbi den är b däremot
      // NÖDVÄNDIG: den bär den axiella avgången ut ur objektet, som pilspetsen
      // kräver (se regressionstestet om en brytpunkt bakom porten). Att korta
      // av den hade lagt avgången i sidled.
      const lodrätt = a.x === b.x && b.x === c.x;
      const vågrätt = a.y === b.y && b.y === c.y;
      if (lodrätt || vågrätt) {
        const ut = lodrätt ? b.y - a.y : b.x - a.x;
        const kvar = lodrätt ? c.y - a.y : c.x - a.x;
        const framåt = ut * (lodrätt ? c.y - b.y : c.x - b.x) >= 0;
        // Framåt: alltid bort. Vändning: bort bara om vägen ändå fortsätter
        // åt samma håll ut från a (kvar har samma tecken som ut, och > 0) OCH
        // c inte är målporten – den sista punkten före porten bär ANKOMSTENS
        // axel, precis som den första bär avgångens. Tas den bort kommer pilen
        // in i porten bakifrån.
        const cÄrMålet = i + 1 === rensad.length - 1;
        if (framåt || (ut * kvar > 0 && !cÄrMålet)) continue;
      }
    }
    out.push(b);
  }
  // En spik kan lämna efter sig två likadana punkter (ut och exakt tillbaka).
  const utan: Point[] = [];
  for (const p of out) {
    const sista = utan[utan.length - 1];
    if (sista && sista.x === p.x && sista.y === p.y) continue;
    utan.push(p);
  }
  return utan;
}

/**
 * Punkt mitt på en polylinjes LÄNGD – så en etikett hamnar på själva linjen.
 * Delad av canvas och SVG-export: samma ankare, annars satt etiketten på olika
 * ställen på skärmen och i filen.
 */
export function midOfPath(pts: Point[]): Point {
  return pointAlongPath(pts, 0.5);
}

/**
 * ETIKETTENS ankare på en väg – t.ex. "Ja"/"Nej" på en grenpil.
 *
 * Mitten av vägens LÄNGD dög inte: en rak Ja-pil fick etiketten mitt på sitt
 * vågräta streck, medan Nej-pilen (som svänger) fick sin mitt i böjen, tätt
 * inpå gatewayen. Två grenar från samma beslut såg då ut att vara placerade
 * efter olika regler. Ankaret sitter i stället mitt på vägens LÄNGSTA raka
 * segment, med företräde för ett VÅGRÄTT när ett sådant är i närheten av det
 * längsta – flödet läses i sidled, och då hamnar båda grenarnas etiketter på
 * samma sorts sträcka.
 *
 * `andel` (0–1 längs vägen) åsidosätter regeln: användarens egen placering.
 * EN regel, en plats – canvasen och exportörerna kallar samma funktion.
 */
export function labelAnchor(pts: Point[], andel?: number): Point {
  if (andel !== undefined && Number.isFinite(andel)) return pointAlongPath(pts, andel);
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };

  let bäst = -1;
  let bästLängd = -1;
  let bästVågrät = false;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = Math.abs(pts[i + 1].x - pts[i].x);
    const dy = Math.abs(pts[i + 1].y - pts[i].y);
    const längd = Math.hypot(dx, dy);
    const vågrät = dx >= dy;
    // Ett vågrätt segment vinner så länge det är minst 70 % av det längsta:
    // annars vandrar etiketten ut på en lång lodrät omväg.
    const slårBäst = bästVågrät
      ? vågrät && längd > bästLängd
      : vågrät
        ? längd >= bästLängd * 0.7
        : längd > bästLängd;
    if (slårBäst) {
      bäst = i;
      bästLängd = längd;
      bästVågrät = vågrät;
    }
  }
  const a = pts[bäst];
  const b = pts[bäst + 1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Var på vägen (0–1) punkten `p` ligger närmast. Används när användaren drar
 * en etikett: läget sparas som en ANDEL av vägen, inte som en koordinat, så
 * att det överlever att objekten flyttas och att layouten byter format.
 */
export function andelAvPath(pts: Point[], p: Point): number {
  if (pts.length < 2) return 0.5;
  const längder: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    längder.push(l);
    total += l;
  }
  if (total === 0) return 0.5;

  let bästAvstånd = Infinity;
  let bästAndel = 0.5;
  let passerad = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const seg = längder[i];
    if (seg > 0) {
      const t = Math.min(1, Math.max(0, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (seg * seg)));
      const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < bästAvstånd) {
        bästAvstånd = d;
        bästAndel = (passerad + seg * t) / total;
      }
    }
    passerad += seg;
  }
  return bästAndel;
}

/**
 * Etikettens läge BREDVID banan i stället för PÅ den.
 *
 * En kort koppling – som strecket ner till en roll – blev fyra saker i stället
 * för en: streck, vit etikettruta, streck igen, pil. Ligger bokstaven vid
 * sidan om förblir strecket ett streck, och brytpunktshandtaget mitt på går
 * att träffa. Regeln är delad av canvas och export, annars hamnar etiketten på
 * olika ställen på skärmen och i filen.
 *
 * `sida` säger åt vilket håll etiketten förskjutits: ett lodrätt streck får
 * texten till HÖGER, ett vågrätt får den OVANFÖR.
 */
export function labelBesideMid(
  pts: Point[],
  avstånd = 6,
): { x: number; y: number; sida: "höger" | "ovanför" } {
  const mid = midOfPath(pts);
  // Segmentets riktning vid mittpunkten: jämför två punkter strax intill.
  const före = pointAlongPath(pts, 0.45);
  const efter = pointAlongPath(pts, 0.55);
  const lodrätt = Math.abs(efter.y - före.y) >= Math.abs(efter.x - före.x);
  return lodrätt
    ? { x: mid.x + avstånd, y: mid.y, sida: "höger" }
    : { x: mid.x, y: mid.y - avstånd, sida: "ovanför" };
}

/** Punkt vid `andel` (0–1) av polylinjens längd. */
export function pointAlongPath(pts: Point[], andel: number): Point {
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  let mål = total * Math.min(1, Math.max(0, andel));
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (mål <= seg) {
      const t = seg === 0 ? 0 : mål / seg;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    mål -= seg;
  }
  return pts[pts.length - 1];
}

/**
 * Polyline → SVG-path.
 *
 * `radie > 0` RUNDAR hörnen: varje knä blir en kvartsbåge i stället för en rät
 * vinkel. Affärsprocessens kopplingar ska svänga mjukt – tvära knän var det
 * som gjorde bilderna mest kantiga (2026-09-07).
 *
 * Radien KAPAS mot de två segment hörnet sitter mellan: en båge får aldrig äta
 * upp mer än halva sitt segment, annars skulle två hörn nära varandra rita över
 * varandra och strecket vika av åt fel håll. Ett kort segment ger alltså en
 * mindre båge, inte en trasig väg.
 *
 * Ändpunkterna rörs aldrig: pilspetsen sitter i sista punkten och måste möta
 * rutan på exakt samma ställe som den orutade vägen. Av samma skäl räknas
 * etikettens ankare (`midOfPath`) på PUNKTERNA och inte på den här strängen –
 * rundningen är utseende, inte geometri.
 */
export function pointsToPath(pts: Point[], radie = 0): string {
  if (pts.length === 0) return "";
  const nr = (n: number) => n.toFixed(1);
  if (radie <= 0 || pts.length < 3) {
    return "M" + pts.map((p) => `${nr(p.x)},${nr(p.y)}`).join(" L");
  }

  const längd = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  /** Punkten `d` px från `a` mot `b`. */
  const mot = (a: Point, b: Point, d: number): Point => {
    const l = längd(a, b);
    if (l === 0) return { ...a };
    return { x: a.x + ((b.x - a.x) / l) * d, y: a.y + ((b.y - a.y) / l) * d };
  };

  let ut = `M${nr(pts[0].x)},${nr(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const föregående = pts[i - 1];
    const hörn = pts[i];
    const nästa = pts[i + 1];
    const inLängd = längd(föregående, hörn);
    const utLängd = längd(hörn, nästa);
    // Rak fortsättning (tre punkter på linje) har inget hörn att runda.
    const rakt =
      Math.abs((hörn.x - föregående.x) * (nästa.y - hörn.y) -
        (hörn.y - föregående.y) * (nästa.x - hörn.x)) < 0.01;
    const r = Math.min(radie, inLängd / 2, utLängd / 2);
    if (rakt || r < 0.5) {
      ut += ` L${nr(hörn.x)},${nr(hörn.y)}`;
      continue;
    }
    const start = mot(hörn, föregående, r);
    const slut = mot(hörn, nästa, r);
    // Svephållet: korsprodukten säger om vägen viker åt vänster eller höger.
    const kryss =
      (hörn.x - föregående.x) * (nästa.y - hörn.y) - (hörn.y - föregående.y) * (nästa.x - hörn.x);
    const sweep = kryss > 0 ? 1 : 0;
    ut += ` L${nr(start.x)},${nr(start.y)} A${nr(r)},${nr(r)} 0 0,${sweep} ${nr(slut.x)},${nr(slut.y)}`;
  }
  const sista = pts[pts.length - 1];
  return ut + ` L${nr(sista.x)},${nr(sista.y)}`;
}
