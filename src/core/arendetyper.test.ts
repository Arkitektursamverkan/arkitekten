import { afterEach, describe, expect, it } from "vitest";
import { byggFlödesträd, sättÄrendetyper, tolkaÄrendetyp, ärendetyper, ärendetypFör } from "./flow-tree";
import { organisationUrMiljö, sättOrganisation } from "./organisation";
import type { FlowSummary } from "./flow-store";

afterEach(() => {
  sättOrganisation(null);
  sättÄrendetyper(null);
});

const post = (id: string): FlowSummary => ({
  id,
  name: id,
  savedAt: "2026-11-01T00:00:00.000Z",
  stepCount: 1,
  versionCount: 1,
  actor: "Användare",
});

describe("ärendetyperna kommer ur installationens inställning (ARK_ARENDETYPER)", () => {
  it("REGRESSION: standardlistan var en viss organisations ärendetyper – nu ingen gruppering utan inställning", () => {
    sättOrganisation(organisationUrMiljö({}));
    expect(ärendetyper().map((t) => t.titel)).toEqual(["Alla processer"]);
    const träd = byggFlödesträd([post("driftfraga-ny"), post("annat")]);
    expect(träd).toHaveLength(1);
    expect(träd[0].antal).toBe(2);
  });

  it("listan läses kommaseparerad, i ordning, med reservgrenen sist", () => {
    sättOrganisation(
      organisationUrMiljö({
        ARK_ARENDETYPER: " Driftfråga, Inköpsorder ,verksamhetsforslag=Verksamhetsförslag,reklamation=Reklamation och skador,,",
      }),
    );
    expect(ärendetyper().map((t) => [t.id, t.titel])).toEqual([
      ["driftfraga", "Driftfråga"],
      ["inkopsorder", "Inköpsorder"],
      ["verksamhetsforslag", "Verksamhetsförslag"],
      ["reklamation", "Reklamation och skador"],
      ["gemensamt", "Gemensamt"],
    ]);
    expect(ärendetypFör("reklamation-ny").titel).toBe("Reklamation och skador");
    expect(ärendetypFör("inkopsorder-attestera").id).toBe("inkopsorder");
    // Ett sammansatt id gäller flera typer – reservgrenen.
    expect(ärendetypFör("driftfraga-och-inkopsorder-ny-kommentar").id).toBe("gemensamt");
    expect(ärendetypFör("schemalagd-paminnelse").id).toBe("gemensamt");
  });

  it("listan når webbläsaren genom organisationen (/__ark/organisation) och tål skräp", () => {
    sättOrganisation({ ärendetyper: ["Driftfråga", 3 as never, "  ", "=", "x=Y"] });
    expect(ärendetyper().map((t) => t.id)).toEqual(["driftfraga", "x", "gemensamt"]);
    expect(tolkaÄrendetyp("=")).toBeNull();
  });

  it("testernas egen lista går före installationens", () => {
    sättOrganisation(organisationUrMiljö({ ARK_ARENDETYPER: "Driftfråga" }));
    sättÄrendetyper([{ id: "a", titel: "A", test: () => true }]);
    expect(ärendetyper().map((t) => t.id)).toEqual(["a"]);
  });
});
