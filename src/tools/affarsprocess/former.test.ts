/**
 * Hovertexten på en relation i en affärsprocess.
 *
 * REGRESSION: kopplingen mellan en roll och en aktivitet ritades med bara en
 * bokstav ("U") och ingenting mer. Den som inte kan metoden utantill hade
 * inget sätt att ta reda på vad bokstaven betydde – varken hover, panel eller
 * legend sa något. Nu skriver `relationHint` ut bokstaven i klartext, och
 * ApCanvas skickar texten som <title> på hela kopplingens bana.
 */

import { describe, expect, it } from "vitest";
import type { ApNode, ApRelation } from "@/core/affarsprocess";
import { apMarkerDefs, apNodeSvg, formstil, ikonPortRuta, relationHint, textEtikettMått, HUKI_LABEL } from "./former";

const nod = (id: string, kind: ApNode["kind"], label: string): ApNode => ({
  id,
  kind,
  label,
  sourceIndex: -1,
});

const rel = (r: Partial<ApRelation>): ApRelation => ({
  id: "r1",
  source: "a",
  target: "b",
  kind: "huki",
  ...r,
});

describe("ikonPortRuta", () => {
  /**
   * REGRESSION: sedan verksamhetsobjektet blev en liten symbol med namnet
   * under blev nodrutan lika bred som namnet, medan symbolen är knappt 30 px.
   * Pilen fäste i rutans kant och hamnade långt ifrån symbolen, mitt för
   * texten – "stort avstånd mellan koppling och verksamhetsobjekt".
   * Porten ska sitta på SYMBOLEN.
   */
  it("REGRESSION: ikontypernas port ligger på symbolen, inte i etikettrutans kant", () => {
    const bred = ikonPortRuta("vo", 120, 60)!;
    expect(bred).toBeTruthy();
    expect(bred.w).toBeLessThanOrEqual(28);
    // Centrerad i sidled, överst i rutan.
    expect(bred.x + bred.w / 2).toBe(60);
    expect(bred.y).toBeLessThan(6);
    expect(bred.y + bred.h).toBeLessThanOrEqual(32);
  });

  it("former som fyller sin ruta har ingen egen port", () => {
    expect(ikonPortRuta("aktivitet", 132, 54)).toBeNull();
    expect(ikonPortRuta("process", 150, 60)).toBeNull();
  });

  /**
   * Regeln är en IKONTYP: en liten romb med frågan under, inte en stor fylld romb med texten inuti. Pilarna
   * ska då fästa i ROMBEN, inte i etikettens ytterkant – annars slutar
   * grenpilen i tomma luften bredvid frågetexten.
   */
  it("regeln fäster i romben, inte i etikettrutan", () => {
    const port = ikonPortRuta("regel", 120, 60)!;
    expect(port).not.toBeNull();
    expect(port.w).toBeLessThanOrEqual(28);
    expect(port.x + port.w / 2).toBeCloseTo(60, 5);
  });

  it("porten ryms alltid i noden, även i en smal ruta", () => {
    const smal = ikonPortRuta("roll", 20, 20)!;
    expect(smal.x).toBeGreaterThanOrEqual(0);
    expect(smal.w).toBeLessThanOrEqual(20);
    expect(smal.y + smal.h).toBeLessThanOrEqual(20);
  });
});

describe("relationHint", () => {
  it("skriver ut HUKI-bokstaven i klartext med båda objektens namn", () => {
    const text = relationHint(
      rel({ kind: "huki", huki: "U" }),
      nod("roll_1", "roll", "HR"),
      nod("s1", "aktivitet", "Genomför urval"),
    );
    expect(text).toBe("U – Utför: ”HR” utför ”Genomför urval”");
  });

  it("täcker alla fyra bokstäverna med var sin egen mening", () => {
    const texter = (["H", "U", "K", "I"] as const).map((h) =>
      relationHint(
        rel({ huki: h }),
        nod("roll_1", "roll", "Chef"),
        nod("s1", "aktivitet", "Fatta beslut"),
      ),
    );
    for (const [i, h] of (["H", "U", "K", "I"] as const).entries()) {
      expect(texter[i]).toContain(`${h} – ${HUKI_LABEL[h]}`);
    }
    // Fyra olika meningar – ingen bokstav får återanvända en annans text.
    expect(new Set(texter).size).toBe(4);
  });

  it("faller tillbaka på 'rollen'/'intressenten' när namnet saknas", () => {
    expect(relationHint(rel({ huki: "I" }), nod("i1", "intressent", ""), undefined)).toBe(
      "I – Informeras: intressenten informeras om aktiviteten",
    );
    expect(relationHint(rel({ huki: "U" }), undefined, undefined)).toBe(
      "U – Utför: rollen utför aktiviteten",
    );
  });

  it("saknad bokstav läses som U – samma standard som kompileringen", () => {
    expect(relationHint(rel({ huki: undefined }))).toContain("U – Utför");
  });

  it("namnger även andra relationstyper, med regelsvaret om det finns", () => {
    expect(
      relationHint(
        rel({ kind: "flode", label: "Ja" }),
        nod("s1", "regel", "Godkänd?"),
        nod("s2", "aktivitet", "Skicka svar"),
      ),
    ).toBe("Flöde (Ja): ”Godkänd?” → ”Skicka svar”");

    expect(
      relationHint(
        rel({ kind: "samverkar" }),
        nod("s1", "aktivitet", "Annonsera"),
        nod("it1", "applikation", "ReachMee"),
      ),
    ).toBe("Samverkar med: ”Annonsera” → ”ReachMee”");
  });
});

describe("etiketter som ryms", () => {
  /**
   * REGRESSION: `wrap` kapade tyst efter tredje raden. Ett forum som hette
   * "Forum (aktivtet alltid ett möte)" – på ytan stod
   * det "…alltid ett", och sista ordet fanns ingenstans. Formerna växer nu med
   * sin etikett, och taket är högre för dem.
   */
  it("REGRESSION: en lång etikett kapas inte efter tre rader", () => {
    const svg = apNodeSvg(
      { id: "f1", kind: "forum", label: "Forum (aktivtet alltid ett möte)", sourceIndex: -1 },
      0,
      0,
      92,
      86,
    );
    expect(svg).toContain("möte)");
  });

  it("formen växer med texten, men aldrig under sitt grundmått", () => {
    const kort = textEtikettMått("aktivitet", "Kort");
    const lång = textEtikettMått(
      "aktivitet",
      "Stämmer av med kontoutdrag och inbetalningar i Excel",
    );
    expect(lång.h).toBeGreaterThan(kort.h);
    // Grundmåttet är golvet – layouten tar max(bas, mått).
    expect(kort.h).toBeLessThanOrEqual(54);
  });

  it("spetsiga former får mer luft än rektanglar för samma text", () => {
    const text = "Är kreditupplysningen godkänd";
    expect(textEtikettMått("regel", text).w).toBeGreaterThan(
      textEtikettMått("aktivitet", text).w,
    );
  });

  /**
   * REGRESSION: taket flyttades bara – vid sju rader kapade `wrap` igen. 4.4.3
   * har regeln "Har personuppgifter läkt, eller finns risk för att
   * personuppgifter läkt?", och i bilden slutade frågan på "personuppgifter":
   * sista ordet och frågetecknet fanns ingenstans. Formen växer ändå med sin
   * etikett, så raden breddas i stället för att ordet kapas.
   */
  it("REGRESSION: en etikett som inte ryms på radtaket kapas inte – raden breddas", () => {
    const fråga = "Har personuppgifter läkt, eller finns risk för att personuppgifter läkt?";
    const svg = apNodeSvg({ id: "r1", kind: "regel", label: fråga, sourceIndex: -1 }, 0, 0, 200, 120);
    expect(svg).toContain("läkt?");
    // Och måttet följer med, annars mäter layouten en ruta och ritar en annan.
    expect(textEtikettMått("regel", fråga).w).toBeGreaterThan(
      textEtikettMått("regel", "Har personuppgifter läkt?").w,
    );
  });
});

describe("apMarkerDefs", () => {
  /**
   * REGRESSION: pilspetsarna hade SVG 2:s `orient="auto-start-reverse"`.
   * Webbläsaren klarar det, men PNG-förhandsvisningen (resvg) och äldre
   * SVG-läsare tolkade det som 0°: varje spets pekade åt höger, och på de
   * lodräta strecken upp i aktiviteten syntes bara en flik i sidled.
   */
  it("REGRESSION: spetsarna vrids med strecket i alla läsare (orient=auto)", () => {
    const defs = apMarkerDefs();
    expect(defs).not.toContain("auto-start-reverse");
    expect(defs).toContain('orient="auto"');
  });
});

describe("forumets pratbubbla", () => {
  /**
   * REGRESSION: forumet var en rektangel. Det är en pratbubbla: en ELLIPS
   * med svansen ned åt vänster, i stilens forumfärger.
   */
  it("REGRESSION: stilens färger och en ellips, inte en rektangel", () => {
    const n = { id: "f", kind: "forum", label: "Enhetsmöte", sourceIndex: 0 } as ApNode;
    const svg = apNodeSvg(n, 0, 0, 120, 70);
    expect(svg).toContain(formstil("forum").fill);
    expect(svg).toContain(formstil("forum").stroke);
    expect(svg).toMatch(/ A[\d.]+,[\d.]+ 0 1,0 /);
    expect(svg).not.toContain("<rect");
  });

  it("pilarna fäster i kroppen, inte i rutan med svansen", () => {
    const r = ikonPortRuta("forum", 120, 70)!;
    expect(r.h).toBeLessThan(70);
    expect(r.w).toBe(120);
  });
});

describe("forumets mått", () => {
  /**
   * REGRESSION: bubblan blåstes upp runt texten – 251 × 140 för
   * "Avdelningsledningsgruppen" när aktiviteterna bredvid var 132 × 54.
   * Forumet står i aktivitetens ställe och är lika stort, svansen inräknad
   * (beslut 2026-10-13: "för stor, fel dimension").
   */
  it("REGRESSION: forumet är ungefär lika stort som en aktivitet med samma namn", () => {
    for (const namn of ["Fatta beslut", "Avhandla agendapunkter", "Avdelningsledningsgruppen"]) {
      const f = textEtikettMått("forum", namn);
      const a = textEtikettMått("aktivitet", namn);
      expect(f.h, namn).toBeLessThanOrEqual(Math.max(a.h, 54) * 1.15);
      expect(f.w, namn).toBeLessThanOrEqual(Math.max(a.w, 100) * 1.15);
    }
  });
});
