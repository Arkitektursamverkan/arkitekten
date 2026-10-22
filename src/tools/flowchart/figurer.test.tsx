// @vitest-environment happy-dom
/**
 * Figurförteckningen i flödesschemat.
 *
 * Kontrakt som låses här:
 *  - bara de former och pilsorter som FAKTISKT står i bilden listas,
 *  - förteckningen läser den FILTRERADE modellen, så verksamhetsvyn inte får
 *    en faktaruta som beskriver systemsteg man inte ser,
 *  - färgläget slår igenom: i strikt BPMN är rutans former lika färglösa som
 *    diagrammets, för där betyder färgen ingenting.
 */

import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { compileDraft, emptyDraft, makeLane, type DraftStep, type ProcessDraft } from "@/core/draft";
import type { NodeType } from "@/core/model";
import { Figurförteckning } from "@/shell/Figurforteckning";
import { flödesFigurer } from "./figurer";
import { filterByPerspective } from "./perspective";
import { NODE_STYLES, TYPE_BETYDELSE } from "./theme";

afterEach(cleanup);

function steg(id: string, type: NodeType, text: string, extra?: Partial<DraftStep>): DraftStep {
  return { id, type, text, laneId: "Användare", sourceIndex: 0, ...extra };
}

function draftMed(steps: DraftStep[]): ProcessDraft {
  return {
    ...emptyDraft(),
    title: "Test",
    lanes: [makeLane("Användare", 0), makeLane("Power Automate", 1)],
    steps,
  };
}

const grupp = (grupper: ReturnType<typeof flödesFigurer>, titel: string) =>
  grupper.find((g) => g.titel === titel);

it("listar bara de former som står i bilden, i palettens ordning", () => {
  const grupper = flödesFigurer(
    compileDraft(
      draftMed([
        steg("s1", "start", "Behov uppstår"),
        steg("s2", "decision", "Är ärendet akut?"),
        steg("s3", "activity", "Hantera ärendet"),
      ]),
    ),
    "type",
  );

  const nycklar = grupp(grupper, "Objekt")!.figurer.map((f) => f.nyckel);
  expect(nycklar).toContain("start");
  expect(nycklar).toContain("decision");
  expect(nycklar).toContain("activity");
  // Ingen integration, ingen notifiering – de finns inte i flödet.
  expect(nycklar).not.toContain("integration");
  expect(nycklar).not.toContain("notification");
  // Ordningen är palettens: start före aktivitet före beslut.
  expect(nycklar.indexOf("start")).toBeLessThan(nycklar.indexOf("activity"));
  expect(nycklar.indexOf("activity")).toBeLessThan(nycklar.indexOf("decision"));
});

it("betydelsen kommer ur theme – EN plats, delad med paletten", () => {
  const grupper = flödesFigurer(
    compileDraft(draftMed([steg("s1", "decision", "Är ärendet akut?")])),
    "type",
  );
  const beslut = grupp(grupper, "Objekt")!.figurer.find((f) => f.nyckel === "decision");
  expect(beslut?.betydelse).toBe(TYPE_BETYDELSE.decision);
});

it("skiljer sekvensflöde, meddelandeflöde och dataassociation åt", () => {
  const grupper = flödesFigurer(
    compileDraft(
      draftMed([
        steg("s1", "start", "Behov uppstår"),
        steg("s2", "activity", "Hantera ärendet"),
        steg("s3", "notification", "Skicka kvittens", { recipient: "Extern part" }),
        steg("s4", "datastore", 'Loggpost i SP-listan "Ärenden"', { laneId: "Power Automate" }),
      ]),
    ),
    "type",
  );

  const kopplingar = grupp(grupper, "Kopplingar")!.figurer.map((f) => f.nyckel);
  expect(kopplingar).toContain("sequence");
  expect(kopplingar).toContain("message");
  expect(kopplingar).toContain("data");

  // Mottagaren är en deltagare vi inte modellerar – en svart låda.
  const bilden = grupp(grupper, "Bilden")!.figurer.map((f) => f.nyckel);
  expect(bilden).toContain("svartlada");
  expect(bilden).toContain("bana");
});

/**
 * Verksamhetsvyn döljer systemstegen. Läste förteckningen den OFILTRERADE
 * modellen skulle faktarutan räkna upp en systemruta och en integration som
 * inte syns någonstans i bilden framför läsaren.
 */
it("följer perspektivet – dolda systemsteg står inte i rutan", () => {
  const model = compileDraft(
    draftMed([
      steg("s1", "activity", "Hantera ärendet"),
      steg("s2", "integration", "Anropa fastighetssystemets API", { laneId: "Power Automate" }),
    ]),
  );

  const alla = flödesFigurer(model, "type").flatMap((g) => g.figurer.map((f) => f.nyckel));
  expect(alla).toContain("integration");

  const verksamhet = flödesFigurer(filterByPerspective(model, "business"), "type").flatMap((g) =>
    g.figurer.map((f) => f.nyckel),
  );
  expect(verksamhet).not.toContain("integration");
});

it("strikt BPMN ritar rutans former färglösa – som diagrammet", () => {
  const model = compileDraft(draftMed([steg("s1", "decision", "Är ärendet akut?")]));

  const { container, rerender } = render(
    <Figurförteckning grupper={flödesFigurer(model, "type")} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Figurer/ }));
  expect(container.querySelector("polygon")?.getAttribute("fill")).toBe(NODE_STYLES.decision.fill);

  rerender(<Figurförteckning grupper={flödesFigurer(model, "bpmn")} />);
  expect(container.querySelector("polygon")?.getAttribute("fill")).toBe("#ffffff");
});

it("faktarutan är stängd tills man fäller ner den", () => {
  const grupper = flödesFigurer(
    compileDraft(draftMed([steg("s1", "decision", "Är ärendet akut?")])),
    "type",
  );
  render(<Figurförteckning grupper={grupper} />);

  expect(screen.queryByText("Beslut")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Figurer/ }));
  expect(screen.getByText("Beslut")).toBeTruthy();
});
