// @vitest-environment happy-dom
/**
 * Menyns processträd i läsläge.
 *
 * Kravet: allt infällt utom den gren man står i. Ett helt utfällt träd med
 * trettio processer blev en lista att skrolla i, där den öppna processen kunde
 * ligga utanför bild – menyn svarade alltså inte längre på "var är jag?".
 */

import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Processträd } from "./Processtrad";
import { AnvändarKontext } from "./Inloggning";
import type { FlowSummary } from "@/core/flow-store";
import { användTestärendetyper, återställÄrendetyper } from "@/core/test-arendetyper";

const post = (id: string, name: string, actor: string): FlowSummary => ({
  id,
  name,
  savedAt: "2026-07-29T10:00:00.000Z",
  stepCount: 8,
  versionCount: 1,
  status: "utkast",
  beteckning: "0.1",
  actor,
});

const FLÖDEN = [
  post("driftfraga-ny-anvandare", "Driftfråga - ny (användare)", "Användare"),
  post("driftfraga-paminn-mig-handlaggare", "Driftfråga - påminn mig (handläggare)", "Handläggare"),
  post("inkopsorder-avbryt-anvandare", "Inköpsorder - avbryt (användare)", "Användare"),
];

function rita(aktivtFlöde: string | null) {
  const öppnade: string[] = [];
  render(
    <Processträd flöden={FLÖDEN} aktivtFlöde={aktivtFlöde} onÖppna={(id) => öppnade.push(id)} />,
  );
  return öppnade;
}

// Påhittade ärendetyper – installationens egna kommer ur ARK_ARENDETYPER.
beforeEach(användTestärendetyper);
afterEach(() => {
  cleanup();
  återställÄrendetyper();
});

it("bara grenen man står i är utfälld", () => {
  rita("driftfraga-paminn-mig-handlaggare");

  // Vägen ner till den öppna processen står öppen …
  expect(screen.getByText("Driftfråga")).toBeTruthy();
  expect(screen.getByText("Påminn mig")).toBeTruthy();
  // … och syskonen är rubriker utan innehåll.
  expect(screen.getByText("Inköpsorder")).toBeTruthy();
  expect(screen.queryByText("Avbryt")).toBeNull();
});

it("en annan gren går att fälla ut, och stannar ute", () => {
  rita("driftfraga-paminn-mig-handlaggare");

  fireEvent.click(screen.getByText("Inköpsorder"));
  expect(screen.getByText("Avbryt")).toBeTruthy();
  // Den egna grenen är kvar – utfällningen ersätter inte, den lägger till.
  expect(screen.getByText("Påminn mig")).toBeTruthy();
});

/**
 * Automatiken får aldrig köra över ett eget val: fäller man ihop sin egen gren
 * ska den stanna ihopfälld, annars slår den upp sig igen vid varje omrendering.
 */
it("ett eget klick väger tyngre än automatiken", () => {
  rita("driftfraga-paminn-mig-handlaggare");

  expect(screen.getByText("Påminn mig")).toBeTruthy();
  fireEvent.click(screen.getByText("Driftfråga"));
  expect(screen.queryByText("Påminn mig")).toBeNull();
  expect(screen.getByText("Driftfråga")).toBeTruthy(); // rubriken är kvar att fälla ut
});

it("en sökning fäller ut träffarna – man ska slippa leta upp dem själv", () => {
  rita(null);

  // Utan öppen process är allt infällt.
  expect(screen.queryByText("Påminn mig")).toBeNull();

  fireEvent.change(screen.getByLabelText("Sök process i menyn"), { target: { value: "påminn" } });
  expect(screen.getByText("Påminn mig")).toBeTruthy();
  expect(screen.queryByText("Inköpsorder")).toBeNull(); // grenen är tom
});

it("ett klick på en process öppnar den", () => {
  const öppnade = rita("driftfraga-paminn-mig-handlaggare");

  fireEvent.click(screen.getByText("Påminn mig"));
  expect(öppnade).toEqual(["driftfraga-paminn-mig-handlaggare"]);
});

/**
 * Märket "ny": en process som lagts upp de senaste 48 timmarna märks på sin
 * egen rad i menyn, direkt efter namnet. Grenrubrikerna märks aldrig.
 */
const NU = Date.parse("2026-10-02T12:00:00.000Z");
const MED_NY = [
  ...FLÖDEN.slice(0, 2),
  { ...FLÖDEN[2], skapad: "2026-10-01T15:00:00.000Z" },
  { ...FLÖDEN[0], id: "driftfraga-avsluta-anvandare", name: "Driftfråga - avsluta (användare)", skapad: "2026-09-01T15:00:00.000Z" },
];

it("en nyupplagd process märks med ny, en äldre gör det inte", () => {
  render(<Processträd flöden={MED_NY} aktivtFlöde="inkopsorder-avbryt-anvandare" onÖppna={() => {}} nu={NU} />);

  const rad = screen.getByText("Avbryt").closest("button")!;
  expect(rad.querySelector(".ark-meny-nymarke")?.textContent).toBe("ny");
  // Driftfråga är hopfälld och rymmer inget nytt.
  expect(document.querySelectorAll(".ark-meny-nymarke")).toHaveLength(1);
});

it("en hopfälld gren märks inte – ny syns först när grenen är utfälld", () => {
  render(<Processträd flöden={MED_NY} aktivtFlöde="driftfraga-paminn-mig-handlaggare" onÖppna={() => {}} nu={NU} />);

  expect(screen.queryByText("Avbryt")).toBeNull();
  expect(document.querySelector(".ark-meny-nymarke")).toBeNull();

  fireEvent.click(screen.getByText("Inköpsorder"));
  const rad = screen.getByText("Avbryt").closest("button")!;
  // Direkt efter namnet, inte i grenrubriken.
  expect(rad.querySelector(".ark-meny-namn")!.nextElementSibling?.className).toBe("ark-meny-nymarke");
  expect(document.querySelectorAll(".ark-meny-nymarke")).toHaveLength(1);
});

it("efter 48 timmar är märket borta", () => {
  render(
    <Processträd
      flöden={MED_NY}
      aktivtFlöde="inkopsorder-avbryt-anvandare"
      onÖppna={() => {}}
      nu={NU + 48 * 60 * 60 * 1000}
    />,
  );
  expect(document.querySelector(".ark-meny-nymarke")).toBeNull();
});

it("REGRESSION: i menyn stod ägaren bara i hovertexten – nu under rubriken och på raden", () => {
  const admin = { id: "a", namn: "Admin", roller: ["admin" as const, "user" as const] };
  const emelies = { ...post("pilot", "Pilot", "Användare"), ägare: { id: "e", namn: "Emelie" } };
  render(
    <AnvändarKontext användare={admin} läge="entra">
      <Processträd flöden={[emelies]} aktivtFlöde="pilot" onÖppna={() => {}} />
    </AnvändarKontext>,
  );
  // En gång under ytans rubrik (hopfällt eller ej), en gång på den utfällda raden.
  expect(screen.getAllByText("Emelie")).toHaveLength(2);
});
