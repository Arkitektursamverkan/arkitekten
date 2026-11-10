// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VidareInstruktioner, exempelInstruktioner, vidareInstruktion } from "./VidareInstruktioner";

afterEach(cleanup);

const AI = "Licensinventering\nBehov → Granska licensrapporten";

it("önskemålet bär den NUVARANDE AI-beskrivningen och justeringarna – det är tolkningen som justeras", () => {
  const t = vidareInstruktion(AI, "Rollen är Systemförvaltare");
  expect(t).toContain("Granska licensrapporten");
  expect(t).toContain("Rollen är Systemförvaltare");
  expect(t.indexOf("Granska licensrapporten")).toBeLessThan(t.indexOf("Rollen är Systemförvaltare"));
});

it("visas inte förrän det finns en AI-beskrivning", () => {
  render(<VidareInstruktioner diagramType="affarsprocess" aiText="  " upptagen={false} väntarText="…" onSkicka={async () => true} />);
  expect(screen.queryByText("Vidare instruktioner till AI")).toBeNull();
});

it("påminner om kostnaden, skickar allt i ett anrop och tömmer rutan när svaret kommit", async () => {
  const onSkicka = vi.fn(async () => true);
  render(<VidareInstruktioner diagramType="affarsprocess" aiText={AI} upptagen={false} väntarText="…" onSkicka={onSkicka} />);
  expect(screen.getByText(/förknippat med en kostnad/)).toBeTruthy();
  const knapp = screen.getByRole("button", { name: /Skicka instruktionerna/ }) as HTMLButtonElement;
  expect(knapp.disabled).toBe(true);
  const ruta = screen.getByLabelText("Vidare instruktioner till AI") as HTMLTextAreaElement;
  fireEvent.change(ruta, { target: { value: "Rollen är Systemförvaltare" } });
  fireEvent.click(knapp);
  expect(onSkicka).toHaveBeenCalledWith(vidareInstruktion(AI, "Rollen är Systemförvaltare"));
  await waitFor(() => expect(ruta.value).toBe(""));
});

it("misslyckas anropet står instruktionerna kvar", async () => {
  render(<VidareInstruktioner diagramType="affarsprocess" aiText={AI} upptagen={false} väntarText="…" fel="Avbrutet – inget AI-anrop gjordes." onSkicka={async () => false} />);
  const ruta = screen.getByLabelText("Vidare instruktioner till AI") as HTMLTextAreaElement;
  fireEvent.change(ruta, { target: { value: "Ta bort steg 3" } });
  fireEvent.click(screen.getByRole("button", { name: /Skicka instruktionerna/ }));
  await new Promise((r) => setTimeout(r, 0));
  expect(ruta.value).toBe("Ta bort steg 3");
  expect(screen.getByText(/inget AI-anrop gjordes/)).toBeTruthy();
});

const OMV =
  "Licensinventering system - CRM\nBehov av licensinventering → Hämta användarlista [IT: Katalogtjänst] → " +
  "Granska licensrapporten [IT: Licensportalen] [Ut: Granskade licenser] → Bedöm påverkan på verksamheten → " +
  "Behövs åtgärder? (↓ Ja → Initiera åtgärder [Ut: Åtgärder initierade]) → Licensinventering genomförd";

it("exemplen byggs ur processens egna steg – utan satelliter, start, slut eller grenetiketter", () => {
  const ex = exempelInstruktioner(OMV, "affarsprocess");
  expect(ex).toContain("Rollen som utför ”Hämta användarlista” är …");
  expect(ex).toContain("Vid Nej på ”Behövs åtgärder?” ska …");
  expect(ex).not.toContain("[");
  expect(ex).not.toContain("Behov av licensinventering");
  expect(ex).not.toMatch(/”Ja”/);
});

it("flödesschemats exempel talar om banor, och utan regel föreslås ett steg efter det sista", () => {
  const ex = exempelInstruktioner("Ny dator\nBehov av dator → Beställ dator → Konfigurera dator → Dator levererad", "flowchart");
  expect(ex).toContain("”Beställ dator” utförs i banan …");
  expect(ex).toContain("Lägg till ett steg efter ”Konfigurera dator”");
});

it("rutan visar exemplen för det aktuella fallet", () => {
  render(<VidareInstruktioner diagramType="affarsprocess" aiText={OMV} upptagen={false} väntarText="…" onSkicka={async () => true} />);
  const ruta = screen.getByLabelText("Vidare instruktioner till AI") as HTMLTextAreaElement;
  expect(ruta.placeholder).toBe(exempelInstruktioner(OMV, "affarsprocess"));
});

it("ett förtydligande i parentes följer inte med in i exemplet", () => {
  const ex = exempelInstruktioner(
    "Ny dator\nBehov av dator → Godkänn och förankra beställningen hos ledningen (chef) → Lämna ut dator → Dator levererad",
    "flowchart",
  );
  expect(ex).toContain("Dela upp ”Godkänn och förankra beställningen hos…” i två steg");
  expect(ex).not.toContain("chef");
});
