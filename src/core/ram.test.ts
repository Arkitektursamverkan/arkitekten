/**
 * Ramarnas datamodell: klicket växlar, målen nycklas stabilt och helpers
 * sprider (invariant 4).
 */

import { describe, expect, it } from "vitest";
import {
  duplicera,
  flyttaRam,
  läggTillRam,
  nyRam,
  nySerie,
  ramKantNyckel,
  serieId,
  taBortRam,
  växlaMarkering,
  type Markering,
} from "./ram";
import { edgeKey } from "./draft";

const puls = (id: string, färg = "#e8590c"): Markering => ({
  mål: { typ: "kant", id },
  verktyg: "puls",
  färg,
});

describe("växlaMarkering", () => {
  it("samma verktyg i samma färg igen tar bort markeringen", () => {
    const r = växlaMarkering(nyRam("R"), puls("a->b"));
    expect(r.markeringar).toHaveLength(1);
    expect(växlaMarkering(r, puls("a->b")).markeringar).toHaveLength(0);
  });

  it("ett annat verktyg eller en annan färg ersätter – ett mål bär en markering", () => {
    let r = växlaMarkering(nyRam("R"), puls("a->b"));
    r = växlaMarkering(r, puls("a->b", "#1f5c9e"));
    expect(r.markeringar).toEqual([puls("a->b", "#1f5c9e")]);
    r = växlaMarkering(r, { ...puls("a->b"), verktyg: "blink" });
    expect(r.markeringar.map((m) => m.verktyg)).toEqual(["blink"]);
  });

  it("en nod och en kant med samma id är olika mål", () => {
    let r = växlaMarkering(nyRam("R"), puls("x"));
    r = växlaMarkering(r, { mål: { typ: "nod", id: "x" }, verktyg: "farg", färg: "#000" });
    expect(r.markeringar).toHaveLength(2);
  });
});

describe("kopplingens nyckel", () => {
  it("är kantstilarnas nyckel – Ja och Nej mellan samma par skiljs åt (invariant 3)", () => {
    expect(ramKantNyckel("d1", "s2", "Ja")).toBe(edgeKey("d1", "s2", "Ja"));
    expect(ramKantNyckel("d1", "s2", "Ja")).not.toBe(ramKantNyckel("d1", "s2", "Nej"));
  });
});

describe("serien", () => {
  it("id:t är filsäkert och krockar inte med ett upptaget", () => {
    expect(serieId("Åtgärda avvikelse!")).toBe("ramar-atgarda-avvikelse");
    expect(serieId("A", ["ramar-a"])).toBe("ramar-a-2");
    expect(serieId("A")).toMatch(/^[a-z0-9-]{1,64}$/);
  });

  it("ny ram läggs efter den valda, kopian får eget id", () => {
    const s = nySerie("S", "flode-x");
    const första = s.ramar[0];
    const kopia = duplicera(växlaMarkering(första, puls("a->b")));
    const s2 = läggTillRam(läggTillRam(s, nyRam("Sist")), kopia, första.id);
    expect(s2.ramar.map((r) => r.rubrik)).toEqual(["Ram 1", "Ram 1 (kopia)", "Sist"]);
    expect(kopia.id).not.toBe(första.id);
    expect(kopia.markeringar).toHaveLength(1);
  });

  it("flytt och borttagning sprider – okända fält överlever (invariant 4)", () => {
    const s = { ...nySerie("S", "f"), framtida: 1 } as ReturnType<typeof nySerie> & { framtida: number };
    const s2 = läggTillRam(s, nyRam("B"));
    const flyttad = flyttaRam(s2, s2.ramar[1].id, -1);
    expect(flyttad.ramar.map((r) => r.rubrik)).toEqual(["B", "Ram 1"]);
    expect((flyttad as typeof s).framtida).toBe(1);
    expect((taBortRam(flyttad, flyttad.ramar[0].id) as typeof s).framtida).toBe(1);
    // Kanten av listan: ingen flytt.
    expect(flyttaRam(flyttad, flyttad.ramar[0].id, -1)).toBe(flyttad);
  });
});
