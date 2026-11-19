import { describe, expect, it } from "vitest";
import { läsUrsprung, ursprungstext } from "./ursprung";

describe("läsUrsprung", () => {
  it("tar bara med de kända fälten", () => {
    expect(läsUrsprung({ system: " Källsystemet ", automatisk: true, flode: "a81cdecd-8fc3", annat: "x" })).toEqual({
      system: "Källsystemet",
      automatisk: true,
      flode: "a81cdecd-8fc3",
    });
  });
  it("utan systemnamn finns inget ursprung", () => {
    expect(läsUrsprung({ automatisk: true })).toBeNull();
    expect(läsUrsprung({ system: "  " })).toBeNull();
    expect(läsUrsprung("Källsystemet")).toBeNull();
    expect(läsUrsprung(null)).toBeNull();
  });
  it("automatisk är bara sant när det står true, och ett konstigt flödes-id följer inte med", () => {
    expect(läsUrsprung({ system: "K", automatisk: "ja", flode: "../x" })).toEqual({ system: "K" });
  });
  it("texten säger var ändringar görs när bilden läses in automatiskt", () => {
    expect(ursprungstext({ system: "Källsystemet", automatisk: true })).toMatch(/automatiskt från Källsystemet.*skrivs över/);
    expect(ursprungstext({ system: "Källsystemet" })).toBe("Kommer från Källsystemet.");
  });
});
