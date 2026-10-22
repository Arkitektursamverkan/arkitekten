import { describe, expect, it } from "vitest";
import type { EaProcess } from "@/core/publicering";
import { byggTräd, förvaldProcess, jämförPrefix, nästaPrefix, vägTill } from "./ea-trad";

const P = (id: string, namn: string, prefix?: string, förälderId?: string): EaProcess => ({
  id,
  namn,
  ...(prefix ? { prefix } : {}),
  ...(förälderId ? { förälderId } : {}),
  struktur: false,
  källa: "EXTERN",
});

const TRÄD: EaProcess[] = [
  P("it", "4.4 IT", "4.4", "stöd"),
  P("443", "4.4.3  Allvarlig incident", "4.4.3", "it"),
  P("410", "4.4.10 Tio", "4.4.10", "it"),
  P("stöd", "4 Stödprocesser", "4"),
  P("441", "4.4.1 Ärendehantering", "4.4.1", "it"),
  P("kund", "2 Huvudprocess Kund", "2"),
  P("föräldralös", "Gammal", undefined, "arkiverad"),
];

describe("EA-trädet i publiceringsrutan", () => {
  it("sorterar numret led för led", () => {
    expect(jämförPrefix("4.4.9", "4.4.10")).toBeLessThan(0);
    expect(jämförPrefix("4.4", "4.4.1")).toBeLessThan(0);
    expect(jämförPrefix(undefined, "1")).toBeGreaterThan(0);
  });

  it("bygger trädet i portalens ordning, och en nod utan synlig förälder blir rot", () => {
    expect(byggTräd(TRÄD).map((r) => `${r.djup}:${r.process.id}`)).toEqual([
      "0:kund",
      "0:stöd",
      "1:it",
      "2:441",
      "2:443",
      "2:410",
      "0:föräldralös",
    ]);
  });

  it("sökningen behåller träffens förfäder", () => {
    expect(byggTräd(TRÄD, "incident").map((r) => r.process.id)).toEqual(["stöd", "it", "443"]);
    expect(byggTräd(TRÄD, "4.4.1").map((r) => r.process.id)).toEqual(["stöd", "it", "441", "410"]);
  });

  it("föreslår nästa lediga nummer under föräldern", () => {
    expect(nästaPrefix(TRÄD, "it")).toBe("4.4.11");
    expect(nästaPrefix(TRÄD, "443")).toBe("4.4.3.1");
    expect(nästaPrefix(TRÄD, "föräldralös")).toBe("");
  });

  it("står på den publicerade noden, annars på samma nummer som flödets namn", () => {
    const pub = {
      eaNodId: "441",
      eaNodNamn: "",
      ägare: "a",
      beskrivning: "b",
      publiceradAt: "",
    };
    expect(förvaldProcess(TRÄD, "4.4.3 Incident", pub)?.id).toBe("441");
    expect(förvaldProcess(TRÄD, "4.4.3 Incident")?.id).toBe("443");
    expect(förvaldProcess(TRÄD, "Utan nummer")).toBeUndefined();
  });

  it("visar vägen ner till noden", () => {
    expect(vägTill(TRÄD, "443")).toBe("4 Stödprocesser › 4.4 IT › 4.4.3 Allvarlig incident");
  });
});
