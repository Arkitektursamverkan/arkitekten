import { describe, expect, it } from "vitest";
import {
  STATUSAR,
  nuvarandeBeteckning,
  nuvarandeStatus,
  normaliseraStatus,
  sammanfattaStatus,
  senasteFastslagna,
  senasteFastslagnaIndex,
  statusEtikett,
  versionsBeteckning,
  versionsBeteckningar,
} from "./status";

const u = { status: "utkast" as const };
const f = { status: "fastslagen" as const };

describe("statusvokabulären", () => {
  it("har exakt de två beslutade lägena", () => {
    expect(STATUSAR.map((s) => s.id)).toEqual(["utkast", "fastslagen"]);
  });

  it("bara fastslagen räknar upp huvudversionen", () => {
    expect(STATUSAR.filter((s) => s.huvudversion).map((s) => s.id)).toEqual(["fastslagen"]);
  });

  it("okänt, saknat eller påhittat värde blir utkast – aldrig fastslagen", () => {
    expect(normaliseraStatus(undefined)).toBe("utkast");
    expect(normaliseraStatus(null)).toBe("utkast");
    expect(normaliseraStatus("godkänd")).toBe("utkast");
    expect(normaliseraStatus("FASTSLAGEN")).toBe("utkast");
    expect(normaliseraStatus(1)).toBe("utkast");
    expect(statusEtikett(undefined)).toBe("Utkast");
    expect(statusEtikett("fastslagen")).toBe("Fastslagen");
  });
});

describe("versionsnumreringen", () => {
  it("fastslagen ger huvudversion, utkast räknar minor", () => {
    expect(versionsBeteckningar([u, u, f, u, u, f])).toEqual([
      "0.1",
      "0.2",
      "1.0",
      "1.1",
      "1.2",
      "2.0",
    ]);
  });

  it("före första fastslagna versionen är huvudtalet 0 – inget gäller än", () => {
    expect(versionsBeteckningar([u, u, u])).toEqual(["0.1", "0.2", "0.3"]);
  });

  it("två fastslagna i rad ger två huvudversioner", () => {
    expect(versionsBeteckningar([f, f, f])).toEqual(["1.0", "2.0", "3.0"]);
  });

  it("versioner utan statusfält räknas som utkast – gamla filer behöver ingen migrering", () => {
    expect(versionsBeteckningar([{}, {}, f, {}])).toEqual(["0.1", "0.2", "1.0", "1.1"]);
  });

  it("tom historik ger inga beteckningar", () => {
    expect(versionsBeteckningar([])).toEqual([]);
    expect(nuvarandeBeteckning([])).toBe("");
    expect(nuvarandeStatus([])).toBe("utkast");
  });

  it("beteckning för ett index utanför listan är tom, inte ett kast", () => {
    expect(versionsBeteckning([u, f], 5)).toBe("");
    expect(versionsBeteckning([u, f], -1)).toBe("");
  });
});

describe("senaste fastslagna", () => {
  it("hittar den SISTA fastslagna, inte den första", () => {
    const historik = [f, u, f, u];
    expect(senasteFastslagnaIndex(historik)).toBe(2);
    expect(senasteFastslagna(historik)).toMatchObject({ index: 2, beteckning: "2.0" });
  });

  it("saknas fastslagen version svarar den null i stället för en gissning", () => {
    expect(senasteFastslagnaIndex([u, u])).toBe(-1);
    expect(senasteFastslagna([u, u])).toBeNull();
    expect(senasteFastslagna([])).toBeNull();
  });

  it("returnerar anroparens egen version, inte en avskalad kopia", () => {
    const historik = [{ ...u, id: "v1" }, { ...f, id: "v2" }];
    expect(senasteFastslagna(historik)?.version.id).toBe("v2");
  });
});

describe("sammanfattaStatus – det listningarna visar", () => {
  it("ger nuvarande status, beteckning och senaste huvudversion", () => {
    expect(sammanfattaStatus([u, f, u])).toEqual({
      status: "utkast",
      beteckning: "1.1",
      fastslagenBeteckning: "1.0",
    });
  });

  it("står flödet SJÄLV på en huvudversion är den både nuvarande och fastslagen", () => {
    expect(sammanfattaStatus([u, f])).toEqual({
      status: "fastslagen",
      beteckning: "1.0",
      fastslagenBeteckning: "1.0",
    });
  });

  it("utan fastslagen version utelämnas fältet – ingen låtsas-huvudversion", () => {
    expect(sammanfattaStatus([u, u])).toEqual({
      status: "utkast",
      beteckning: "0.2",
      fastslagenBeteckning: undefined,
    });
  });
});
