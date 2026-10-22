/**
 * SCENEN – kontraktet som lämnar huset.
 *
 * En scen är ett FÄRDIGRUTTAT utlägg: koordinater, mått och färdiga SVG-banor.
 * Den finns för att en annan applikation (EA-portalen) ska kunna rita ett
 * flödesschema interaktivt utan att äga en enda av Arkitektens layoutregler.
 * Ritar mottagaren med egen layout hamnar vi i exakt den duplicering invariant 1
 * finns för att förhindra – två ställen som räknar samma sak och glider isär.
 * Scenen vänder på det: ARKITEKTEN räknar, mottagaren ritar.
 *
 * Därför gäller två saker om det här formatet:
 *
 * 1. **Ingenting här får kräva efterberäkning.** Texten är redan bruten till
 *    rader, färgerna är redan valda, banorna är redan ruttade. Måste mottagaren
 *    räkna ut något själv har vi flyttat en regel ut ur huset.
 * 2. **Det är ett publikt kontrakt.** `formatVersion` höjs när något tas bort
 *    eller byter betydelse – aldrig när ett fält läggs till. Mottagaren ska
 *    kunna ignorera fält den inte känner igen.
 *
 * Koordinaterna är utläggets egna (samma som SVG-exportens), med origo uppe
 * till vänster och y nedåt. `bredd`/`höjd` är hela scenens mått.
 */

import type { FigurGrupp } from "./figurer";

/** Ett placerat objekt, färdigt att ritas. */
export interface ScenNod {
  id: string;
  /** Objektets typ i sin familjs vokabulär – styr ikon/form hos mottagaren. */
  typ: string;
  /** Hela etiketten som en sträng, för sökning och tillgänglighet. */
  etikett: string;
  /**
   * Objektet FÄRDIGRITAT som ett SVG-fragment i lokala koordinater (0,0 till
   * w×h). Placera det i en `<g transform="translate(x,y)">` – precis som
   * `ApCanvas` redan gör med samma funktion (`apNodeSvg(node, 0, 0, w, h)`).
   *
   * Att formen kommer färdig och inte som ritinstruktioner är själva poängen:
   * radbrytning, teckenstorlek, radhöjd, vertikal centrering och ikonzoner
   * räknas fram av `former.ts` med regler som är för många och för
   * lättglömda för att skickas som data. Ritar mottagaren om dem glider
   * portalen från Arkitekten – och den glidningen syns först i en exporterad
   * bild, långt efteråt.
   *
   * Interaktivitet påverkas inte: fragmentet är vanliga DOM-noder som går att
   * klicka på, och markering ritar mottagaren själv ur `x/y/w/h`.
   */
  svg: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Vilken del (0-baserad) objektet ligger på i ett flersidigt utlägg. */
  sida: number;
  stil: { fill: string; stroke: string; text: string };
  /** Hovertext – stegets anteckning, när en sådan finns. */
  beskrivning?: string;
  /** Objektet är en nedbruten delprocess (pil-i-cirkel). */
  nedbruten?: boolean;
}

/** En koppling, färdigruttad. */
export interface ScenKant {
  id: string;
  källa: string;
  mål: string;
  typ: string;
  /**
   * Färdig SVG-bana (`d`-attributet). Ruttad av `layout/edge-router.ts` med
   * alla andra objekt som hinder. Rita den rakt av – rutta ALDRIG om.
   */
  d: string;
  färg: string;
  /**
   * Linjetjocklek. Bär en verklig skillnad: i affärsprocessen är BÅDE förädlingskedjan och
   * annoteringarna heldragna – de skiljs åt med tjocklek, färg och pilspets,
   * inte med streckning. En mottagare som streckar annoteringar ritar något
   * Arkitekten aldrig ritar.
   */
  tjocklek: number;
  /**
   * Pilspetsens form. Numera alltid "fylld" – relationssorterna skiljs åt
   * med FÄRG, inte med spetsens form, och en öppen spets på en tunn färgad
   * linje syntes knappt hos mottagaren. Fältet står kvar för scener som redan
   * ligger speglade.
   */
  pilspets: "fylld" | "oppen";
  /**
   * Markörens id i `defs` – rita `marker-end="url(#<markör>)"`.
   *
   * Bygg ALDRIG id:t själv ur `typ` och `pilspets`: HUKI har en markör per
   * ansvarstyp (U blå, I gul, H orange, K oliv), och den som gissar utifrån
   * sorten ger en I-relation den blå spetsen. Saknas fältet är scenen äldre än
   * regeln – då gäller det gamla schemat `ap-<arrow|open>-<typ>`.
   */
  markör?: string;
  etikett?: string;
  /** Var etiketten ska sitta. Saknas när kanten inte bär etikett. */
  ankare?: { x: number; y: number };
  /**
   * Etiketten FÄRDIGRITAD i scenens koordinater (flödesschemats Ja/Nej i sin
   * ruta). Finns den ritar mottagaren den rakt av, ovanpå noderna, i stället
   * för att sätta `etikett` vid `ankare` med en egen stil – rutans mått och
   * teckengrad följer utläggets skala och är en regel här, inte där.
   */
  etikettSvg?: string;
}

/** Sidhänvisning där en koppling korsar ett snitt ("till del 2"). */
export interface ScenHänvisning {
  riktning: "ut" | "in";
  sida: number;
  x: number;
  y: number;
  text: string;
}

export interface ScenSida {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Scen {
  format: "ark-scen";
  formatVersion: 1;
  /** Vilken ritfamilj scenen kommer ur – styr vokabulären i `typ`. */
  familj: "affarsprocess" | "flodesschema";
  flöde: {
    id: string;
    namn: string;
    sparad: string;
    /**
     * Status och beteckning HÄRLEDS ur historiken av `core/status.ts`
     * (invariant 9) och skickas med som avläst värde. Mottagaren ska visa
     * dem, aldrig räkna om dem och aldrig lagra dem som sanning.
     */
    status?: string;
    beteckning?: string;
    fastslagenBeteckning?: string;
  };
  vy: { pageFormat: string; scale: number; spacing: number; textScale: number };
  /**
   * `<defs>`-innehållet som nodernas och kanternas SVG refererar till –
   * pilspetsarnas markers. Lägg det i scenens `<defs>` en gång; utan det ritas
   * kanterna utan pilspets och ingenting säger åt vilket håll flödet går.
   */
  defs: string;
  bredd: number;
  höjd: number;
  skala: number;
  sidor: ScenSida[];
  hänvisningar: ScenHänvisning[];
  noder: ScenNod[];
  kanter: ScenKant[];
  /** Stegens innehåll per nod-id – underlaget för en klickad rutas detaljpanel. */
  steg: Record<string, { text: string; typ: string; not?: string; källtext?: string }>;
  /**
   * TECKENFÖRKLARINGEN – vad symbolerna och färgerna i bilden betyder.
   *
   * Bara de symboler som faktiskt står i den här bilden, med form, namn,
   * betydelse och antal. Den finns med i scenen därför att mottagaren annars
   * inte KAN förklara bilden: affärsprocessens ansvarslinjer bär sin HUKI-bokstav i
   * FÄRGEN och skriver aldrig ut den, så en läsare i portalen ser en gul linje
   * utan att någonstans kunna slå upp att den betyder "informeras".
   *
   * Symbolerna kommer färdigritade, av samma skäl som `ScenNod.svg`: räknade
   * mottagaren fram dem själv skulle portalens förklaring och Arkitektens bild
   * kunna visa olika saker. Fragmenten är självständiga och refererar inga
   * `defs`, så förteckningen går att rita utanför scenens egen `<svg>`.
   *
   * Frivilligt: scener speglade innan fältet fanns saknar det, och en
   * mottagare som inte känner igen det ska kunna hoppa över det
   * (`formatVersion` höjs bara när något TAS BORT eller byter betydelse).
   */
  figurer?: FigurGrupp[];

  /**
   * Det som ligger BAKOM flödet, färdigritat i scenens koordinater: sidramar,
   * pool, banor och mottagarpooler. Rita det först. Bara flödesschemat har
   * sådant; en affärsprocessscen saknar fältet.
   */
  bakgrund?: string;
  /**
   * Artefakterna, färdigritade i scenens koordinater: datalager, streckade
   * dataassociationer, meddelandeflöden och sidhänvisningar. Rita dem efter
   * kanterna och före noderna – samma ordning som exporten.
   */
  artefakter?: string;

  /** Vem/när/vilken version bilden visar. Byggd av `export/revision.ts`. */
  revision: unknown;
}
