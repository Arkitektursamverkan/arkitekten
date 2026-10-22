import { describe, expect, it } from "vitest";
import { delaNamn, saknasFörPublicering, type PubliceringsUtkast } from "./publicering";

const KLAR: PubliceringsUtkast = {
  läge: "befintlig",
  nodId: "abc",
  nyttNamn: "",
  nyttPrefix: "",
  ägare: "IT-chef",
  beskrivning: "Så hanteras en incident.",
};

describe("saknasFörPublicering", () => {
  it("ett ifyllt utkast får publiceras", () => {
    expect(saknasFörPublicering(KLAR)).toEqual([]);
  });

  it("processägare och beskrivning är obligatoriska", () => {
    const fel = saknasFörPublicering({ ...KLAR, ägare: "  ", beskrivning: "" });
    expect(fel).toEqual(["Ange processägare.", "Ange en beskrivning av processen."]);
  });

  it("en ny process kräver förälder och namn, och numret måste se ut som ett nummer", () => {
    const fel = saknasFörPublicering({ ...KLAR, läge: "ny", nodId: null, nyttNamn: "", nyttPrefix: "4.x" });
    expect(fel).toHaveLength(3);
    expect(saknasFörPublicering({ ...KLAR, läge: "ny", nyttNamn: "Ny", nyttPrefix: "" })).toEqual([]);
    expect(saknasFörPublicering({ ...KLAR, läge: "ny", nyttNamn: "Ny", nyttPrefix: "4.4.5" })).toEqual([]);
  });
});

describe("delaNamn", () => {
  it("skiljer numret från namnet", () => {
    expect(delaNamn("4.4.3 Allvarlig incident")).toEqual({ prefix: "4.4.3", namn: "Allvarlig incident" });
    expect(delaNamn("4.4.3  Två blanksteg")).toEqual({ prefix: "4.4.3", namn: "Två blanksteg" });
    expect(delaNamn("Utan nummer")).toEqual({ namn: "Utan nummer" });
  });
});
