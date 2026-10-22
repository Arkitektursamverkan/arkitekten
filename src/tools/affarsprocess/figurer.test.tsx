// @vitest-environment happy-dom
/**
 * Figurförteckningen i verktyget Affärsprocess.
 *
 * Kontrakt som låses här:
 *  - bara de symboler som FAKTISKT står i processen listas (en fast katalog
 *    över sexton former säger ingenting om just den här bilden),
 *  - HUKI-bokstäverna listas med SIN FÄRG – det är hela skälet till att rutan
 *    finns, eftersom bokstaven aldrig skrivs ut i diagrammet,
 *  - betydelsetexterna kommer ur former, inte ur en egen uppsättning.
 */

import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { compileAp } from "@/core/affarsprocess";
import { emptyDraft, makeLane, type DraftStep, type ProcessDraft } from "@/core/draft";
import type { NodeType } from "@/core/model";
import { Figurförteckning } from "@/shell/Figurforteckning";
import { apFigurer } from "./figurer";
import { AP_TYPE_BETYDELSE, hukiFärg } from "./former";

afterEach(cleanup);

function steg(id: string, type: NodeType, text: string, extra?: Partial<DraftStep>): DraftStep {
  return { id, type, text, laneId: "Användare", sourceIndex: 0, ...extra };
}

function draftMed(steps: DraftStep[]): ProcessDraft {
  return { ...emptyDraft(), title: "Test", lanes: [makeLane("Användare", 0)], steps };
}

const grupp = (grupper: ReturnType<typeof apFigurer>, titel: string) =>
  grupper.find((g) => g.titel === titel);

it("listar bara de symboler som står i processen", () => {
  const grupper = apFigurer(
    compileAp(
      draftMed([
        steg("a1", "activity", "Genomför urval", {
          ap: { roller: [{ namn: "Rekryteringsansvarig", huki: "U" }] },
        }),
      ]),
    ),
  );

  const objekt = grupp(grupper, "Objekt")!;
  const nycklar = objekt.figurer.map((f) => f.nyckel);
  expect(nycklar).toContain("aktivitet");
  expect(nycklar).toContain("roll");
  // Inget krav, ingen applikation, ingen risk – de finns inte i bilden.
  expect(nycklar).not.toContain("krav");
  expect(nycklar).not.toContain("applikation");
  expect(nycklar).not.toContain("risk");
});

it("räknar hur många av varje sort bilden innehåller", () => {
  const grupper = apFigurer(
    compileAp(
      draftMed([
        steg("a1", "activity", "Genomför urval"),
        steg("a2", "activity", "Fatta beslut"),
      ]),
    ),
  );
  const aktivitet = grupp(grupper, "Objekt")!.figurer.find((f) => f.nyckel === "aktivitet");
  expect(aktivitet?.antal).toBe(2);
});

it("betydelsen kommer ur former – EN plats, delad med paletten", () => {
  const grupper = apFigurer(compileAp(draftMed([steg("a1", "activity", "Genomför urval")])));
  const aktivitet = grupp(grupper, "Objekt")!.figurer.find((f) => f.nyckel === "aktivitet");
  expect(aktivitet?.betydelse).toBe(AP_TYPE_BETYDELSE.aktivitet);
});

it("listar bara de HUKI-bokstäver som används, i metodens ordning", () => {
  const grupper = apFigurer(
    compileAp(
      draftMed([
        steg("a1", "activity", "Genomför urval", {
          ap: {
            roller: [
              { namn: "Chef", huki: "H" },
              { namn: "Handläggare", huki: "U" },
            ],
            intressenter: [{ namn: "Facket", huki: "I" }],
          },
        }),
      ]),
    ),
  );

  const ansvar = grupp(grupper, "Ansvar (HUKI)")!;
  expect(ansvar.figurer.map((f) => f.nyckel)).toEqual(["huki-H", "huki-U", "huki-I"]);
  // K används inte här och ska därför inte stå i rutan.
  expect(ansvar.figurer.map((f) => f.namn)).toEqual([
    "H – Huvudansvar",
    "U – Utför",
    "I – Informeras",
  ]);
});

/**
 * Hela poängen med förteckningen: vi skriver ALDRIG ut
 * HUKI-bokstaven i bilden – ansvaret bärs av linjens färg. Står inte färgen i
 * rutan finns den ingenstans att slå upp.
 */
it("HUKI-raden ritas i relationens egen färg", () => {
  const grupper = apFigurer(
    compileAp(
      draftMed([
        steg("a1", "activity", "Genomför urval", {
          ap: { intressenter: [{ namn: "Facket", huki: "I" }] },
        }),
      ]),
    ),
  );

  const { container } = render(<Figurförteckning grupper={grupper} />);
  fireEvent.click(screen.getByRole("button", { name: /Figurer/ }));

  const färger = [...container.querySelectorAll("line")].map((l) => l.getAttribute("stroke"));
  expect(färger).toContain(hukiFärg("I"));
  expect(screen.getByText("I – Informeras")).toBeTruthy();
  expect(screen.getByText(/bärs av FÄRGEN/)).toBeTruthy();
});

/**
 * Ett textobjekt ritas som bara sin text – det HAR ingen symbol. En rad
 * med en tom ruta där symbolen skulle stått läses som ett fel, och att hitta på
 * en symbol åt den vore värre: rutan ska visa det bilden visar.
 */
it("formlösa objekt får ingen rad – de har ingen symbol att förklara", () => {
  const grupper = apFigurer(
    compileAp(
      draftMed([
        steg("a1", "activity", "Genomför urval"),
        steg("t1", "activity", "Anteckning"),
      ]),
    ),
  );
  const alla = grupper.flatMap((g) => g.figurer);
  expect(alla.every((f) => f.svg !== "")).toBe(true);
  expect(alla.map((f) => f.nyckel)).not.toContain("textobjekt");
});

it("faktarutan är stängd tills man fäller ner den", () => {
  const grupper = apFigurer(compileAp(draftMed([steg("a1", "activity", "Genomför urval")])));
  render(<Figurförteckning grupper={grupper} />);

  expect(screen.queryByText("Aktivitet")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Figurer/ }));
  expect(screen.getByText("Aktivitet")).toBeTruthy();
});

it("en tom process säger det i klartext i stället för att visa tomma rubriker", () => {
  render(<Figurförteckning grupper={apFigurer(compileAp(emptyDraft()))} tomText="Inget ritat än" />);
  fireEvent.click(screen.getByRole("button", { name: /Figurer/ }));
  expect(screen.getByText("Inget ritat än")).toBeTruthy();
});
