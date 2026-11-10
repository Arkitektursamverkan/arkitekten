// @vitest-environment happy-dom
/**
 * Skalets NAVIGERING: appen ska börja med en fråga, inte med någon annans
 * process.
 *
 * Felbeteendet som ledde hit: appen öppnade mitt i flödesschemat med ett
 * exempel inläst och hela flödesträdet nedtryckt i en smal mörk meny. Den som
 * ville leta efter en befintlig process fick själv lista ut att menyn var vägen
 * dit, och den som ville skapa något nytt fick hitta en liten knapp mitt i en
 * panel. Testerna nedan håller fast vid de två vägarna – och vid att arbetet
 * inte försvinner när man tittar i katalogen.
 *
 * Trädets egen indelning testas där den numera ritas: ProcessKatalog.test.tsx.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppShell } from "./AppShell";
import { användTestärendetyper, återställÄrendetyper } from "@/core/test-arendetyper";

const FLÖDEN = [
  {
    id: "verksamhetsforslag-kommentera-handlaggare",
    name: "Verksamhetsförslag - kommentera ärendet (handläggare)",
    draft: {
      steps: [{ id: "s1", type: "start", laneId: "Handläggare", text: "Start" }],
      lanes: [],
      // Fullständigt meta, som en riktig sparad draft: kompileringen läser
      // fragmenten och varningarna direkt.
      meta: { sourceText: "", origin: "manual", sourceFragments: [], warnings: [] },
    },
  },
  {
    id: "driftfraga-paminn-mig-handlaggare",
    name: "Driftfråga - påminn mig (handläggare)",
    draft: {
      steps: [{ id: "s1", type: "start", laneId: "Handläggare", text: "Start" }],
      lanes: [],
      // Fullständigt meta, som en riktig sparad draft: kompileringen läser
      // fragmenten och varningarna direkt.
      meta: { sourceText: "", origin: "manual", sourceFragments: [], warnings: [] },
    },
  },
];

beforeEach(() => {
  // Påhittade ärendetyper – standardlistan är en viss installations portal.
  användTestärendetyper();
  history.replaceState(null, "", location.pathname);
  localStorage.clear();
  for (const f of FLÖDEN) {
    localStorage.setItem(
      `ark.flow.${f.id}`,
      JSON.stringify({ ...f, savedAt: "2026-07-29T10:00:00.000Z", rawText: "", versions: [] }),
    );
  }
  // Ingen dev-brygga i testet: lagringen faller tillbaka på localStorage.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ingen brygga")));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  återställÄrendetyper();
});

/**
 * Menyn, aldrig hela dokumentet: "Processkatalog" står både som menyval och som
 * rubrik i katalogen, och en fråga till hela sidan hade inte kunnat säga vilken
 * av dem den mätte.
 */
function meny(): HTMLElement {
  return document.querySelector("nav.ark-sidebar") as HTMLElement;
}

const tillKatalogen = () => fireEvent.click(within(meny()).getByText("Processkatalog"));

/**
 * Katalogen visar EN nivå i taget sedan den blev en drill-down. Testerna här
 * handlar om skalets navigering och inte om strukturen, så de går via
 * sökrutan – som plattar ut nivåerna och visar hela namnet på kortet.
 */
async function kortIKatalogen(fråga: string): Promise<HTMLElement> {
  fireEvent.change(screen.getByLabelText("Sök process"), { target: { value: fråga } });
  await waitFor(() => expect(document.querySelector(".ark-kort")).toBeTruthy());
  return document.querySelector(".ark-kort") as HTMLElement;
}

const PÅMINN = "Driftfråga - påminn mig (handläggare)";

it("appen börjar med valet: skapa nytt eller öppna befintligt", () => {
  render(<AppShell />);

  expect(screen.getByText("Skapa ny process")).toBeTruthy();
  expect(screen.getByText("Öppna befintlig process")).toBeTruthy();
  // Inget diagram är påbörjat åt någon – arbetsytan är tom tills man valt.
  expect(screen.getByText(/Ingen process är öppen/)).toBeTruthy();
});

it("'Öppna befintlig process' leder till katalogen med bibliotekets processer", async () => {
  render(<AppShell />);

  fireEvent.click(screen.getByText("Öppna befintlig process"));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Processkatalog" })).toBeTruthy());
  // Översta nivån: samlingen, inte alla kort.
  await waitFor(() => expect(screen.getByRole("button", { name: /^Systemprocesser/ })).toBeTruthy());
  expect(await kortIKatalogen(PÅMINN)).toBeTruthy();
});

it("'Ny process' frågar efter verktyg, namn och utgångspunkt", () => {
  render(<AppShell />);

  fireEvent.click(screen.getByText("Skapa ny process"));
  expect(screen.getByRole("heading", { name: "Ny process" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: /Vad ska du rita\?/ })).toBeTruthy();
  expect(screen.getByRole("heading", { name: /Vad heter processen\?/ })).toBeTruthy();
  expect(screen.getByRole("heading", { name: /Hur vill du börja\?/ })).toBeTruthy();

  // Utan namn går det inte att skapa något – posten skulle inte gå att hitta.
  const skapa = screen.getByRole("button", { name: "Skapa process" }) as HTMLButtonElement;
  expect(skapa.disabled).toBe(true);
});

it("ett kort i katalogen öppnar processen på arbetsytan", async () => {
  render(<AppShell />);

  tillKatalogen();
  fireEvent.click(await kortIKatalogen(PÅMINN));

  // Rubriken över ritytan svarar på "var är jag?" – både med verktygets namn
  // och med processens. Rubriken, inte hela sidan: "Systemprocess" står också i
  // menyns verktygslista.
  await waitFor(() => expect(document.querySelector(".ark-flow-header")).toBeTruthy());
  const rubrik = document.querySelector(".ark-flow-header") as HTMLElement;
  expect(within(rubrik).getByText("Systemprocess")).toBeTruthy();
  expect(within(rubrik).getByText("Driftfråga - påminn mig (handläggare)")).toBeTruthy();
});

/**
 * REGRESSION: katalogen fick inte bli en återvändsgränd.
 *
 * Ritade vyerna om huvudytan i stället för att lägga sig ovanpå, plockades
 * verktyget ner varje gång man tittade i katalogen – och tog med sig allt
 * osparat i fallet. "Titta snabbt på en annan process" är just den handling
 * som aldrig får kosta arbete.
 */
it("REGRESSION: arbetsytan lever kvar när man går till katalogen och tillbaka", async () => {
  render(<AppShell />);

  tillKatalogen();
  fireEvent.click(await kortIKatalogen(PÅMINN));
  await waitFor(() => expect(document.querySelector(".ark-flow-header")).toBeTruthy());

  tillKatalogen();
  expect(screen.getByRole("heading", { name: "Processkatalog" })).toBeTruthy();
  // Verktyget står kvar under överlägget – rubriken finns fortfarande i DOM:en.
  expect(document.querySelector(".ark-flow-header")).toBeTruthy();
  /**
   * REGRESSION: …men den SYNS inte. Arbetsytans rubrik, verktygsrad och
   * ritytans flytande palett har egna z-index, och utan att arbetsytan döljs
   * stack de upp genom överlägget – man satt med ritverktyg i handen mitt i
   * katalogen, utan någon process öppen.
   */
  const arbetsytan = document.querySelector(".ark-verktygsyta")!;
  expect(arbetsytan.className).toContain("dold");
  expect(arbetsytan.getAttribute("aria-hidden")).toBe("true");

  // …och menyn erbjuder vägen tillbaka dit. Menyvalet bär processens namn, så
  // man ser VAD man går tillbaka till och inte bara "arbetsytan".
  const tillbaka = meny().querySelector(".ark-navval-namn")!.closest("button")!;
  expect(tillbaka.textContent).toContain("Driftfråga - påminn mig (handläggare)");
  fireEvent.click(tillbaka);
  expect(document.querySelector(".ark-verktygsyta")!.className).not.toContain("dold");
});

/**
 * REGRESSION: katalogen glömde var man var.
 *
 * Plockades den ner mellan besöken började varje återbesök om från toppen av
 * en ofiltrerad lista – man fick söka fram sin plats på nytt varje gång man
 * tittat på en process. Det var det som gjorde växlingen osmidig.
 */
it("REGRESSION: katalogen minns sökning och filter när man varit inne i en process", async () => {
  render(<AppShell />);

  tillKatalogen();
  // Katalogens sökruta, inte menyträdets: båda letar processer och har samma
  // platshållare. Etiketten skiljer dem åt.
  const kort = await kortIKatalogen("påminn");
  expect(screen.queryByText(/Kommentera ärendet/)).toBeNull();

  fireEvent.click(kort);
  await waitFor(() => expect(document.querySelector(".ark-flow-header")).toBeTruthy());

  tillKatalogen();
  expect((screen.getByLabelText("Sök process") as HTMLInputElement).value).toBe("påminn");
  expect(screen.queryByText(/Kommentera ärendet/)).toBeNull();
});

it("en öppnad process hamnar under 'Senast öppnade' på startsidan", async () => {
  render(<AppShell />);

  tillKatalogen();
  fireEvent.click(await kortIKatalogen(PÅMINN));
  await waitFor(() => expect(document.querySelector(".ark-flow-header")).toBeTruthy());

  fireEvent.click(within(meny()).getByTitle("Till startsidan"));
  // Startvyn, inte hela sidan: menyns "Arbetsytan"-val bär samma namn.
  const start = within(document.querySelector(".ark-start") as HTMLElement);
  expect(start.getByText("Senast öppnade")).toBeTruthy();
  expect(
    start.getByRole("button", { name: "Driftfråga - påminn mig (handläggare)" }),
  ).toBeTruthy();
});

/**
 * Strukturen ska synas DIREKT, inte först när man öppnat något. Låg den bara i
 * läsläge fick man gissa vad biblioteket innehöll tills man klickat sig in i
 * en process.
 */
it("strukturens översta nivå står i menyn redan från start, infälld", async () => {
  render(<AppShell />);

  await waitFor(() => expect(within(meny()).getByText("Systemprocesser")).toBeTruthy());
  expect(within(meny()).getByText("Processer")).toBeTruthy();
  // Infälld: nivåerna under syns inte förrän man fäller ut.
  expect(within(meny()).queryByText("Driftfråga")).toBeNull();

  fireEvent.click(within(meny()).getByText("Systemprocesser"));
  expect(within(meny()).getByText("Driftfråga")).toBeTruthy();
});

/**
 * REGRESSION: menyn hade EN lista för mycket.
 *
 * Under trädet låg en verktygslista som i praktiken upprepade trädets översta
 * nivå ("Flödesschema" mot "Systemprocesser", och Affärsprocess två gånger med samma namn).
 * Två listor med nästan samma innehåll i samma smala spalt läser som två menyer
 * ovanpå varandra, och det gick inte att se vilken av dem som var strukturen.
 */
it("REGRESSION: menyn har en enda lista – strukturen", async () => {
  render(<AppShell />);

  await waitFor(() => expect(within(meny()).getByText("Systemprocesser")).toBeTruthy());
  expect(within(meny()).queryByText("Verktyg")).toBeNull();
  expect(within(meny()).queryByText("Förmågekarta")).toBeNull();
  expect(within(meny()).queryByText("Systemprocess")).toBeNull();
});

/**
 * Att ÖPPNA en process är att läsa den, inte att börja ändra i den.
 *
 * Felbeteendet: ritverktygen låg framme så fort något var öppet – också när man
 * bara ville titta – och strukturen fanns bara i katalogen, dit man var tvungen
 * att gå tillbaka mellan varje process.
 */
it("en öppnad process visas i LÄSLÄGE: strukturen i menyn, inga ritverktyg", async () => {
  render(<AppShell />);

  tillKatalogen();
  fireEvent.click(await kortIKatalogen(PÅMINN));
  await waitFor(() => expect(document.querySelector(".ark-flow-header")).toBeTruthy());

  // Strukturen står i menyn, med den öppna processen markerad. Markeringen
  // kommer ur verktygets ACTIVE_FLOW_CHANGED och hinner alltså efter klicket.
  expect(within(meny()).getByText("Processer")).toBeTruthy();
  await waitFor(() =>
    expect(meny().querySelector(".ark-flow-menyval.active")?.textContent).toContain("Påminn mig"),
  );
  // …och ritytans palett är inte framme.
  expect(document.querySelector(".ark-verktygsrad")).toBeNull();
});

it("Redigera visar ritverktygen och fäller undan strukturen; Klar tar tillbaka den", async () => {
  render(<AppShell />);

  tillKatalogen();
  fireEvent.click(await kortIKatalogen(PÅMINN));
  await waitFor(() => expect(document.querySelector(".ark-flow-header")).toBeTruthy());

  fireEvent.click(screen.getByRole("button", { name: /Redigera/ }));
  expect(document.querySelector(".ark-verktygsrad")).toBeTruthy();
  expect(within(meny()).queryByText("Processer")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /Klar/ }));
  expect(document.querySelector(".ark-verktygsrad")).toBeNull();
  expect(within(meny()).getByText("Processer")).toBeTruthy();
});

/**
 * En NY process finns bara för att den ska ritas – där vore ett extra tryck på
 * "Redigera" ett steg utan innehåll.
 */
it("en ny process börjar direkt i redigeringsläge", async () => {
  render(<AppShell />);

  fireEvent.click(screen.getByText("Skapa ny process"));
  fireEvent.change(screen.getByLabelText("Namn på processen"), {
    target: { value: "Inköpsorder - ny (användare)" },
  });
  fireEvent.change(screen.getByPlaceholderText(/En rad per spår/), {
    target: { value: "Medarbetare → Startar portalen" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Skapa process" }));

  await waitFor(() => expect(document.querySelector(".ark-verktygsrad")).toBeTruthy());
  expect(screen.getByRole("button", { name: /Klar/ })).toBeTruthy();
});

/**
 * LÄNK TILL EN PROCESS. Appen hade ingen adress per process: en omladdning
 * ledde till startsidan, och det gick inte att skicka någon till en viss
 * process. Adressen följer nu processen som visas, och öppnar den.
 */
const rubrikNamn = () => document.querySelector(".ark-flow-header")?.textContent ?? "";

it("adressen följer processen man öppnar, och töms när man går till start", async () => {
  render(<AppShell />);
  tillKatalogen();
  fireEvent.click(await kortIKatalogen(PÅMINN));
  await waitFor(() => expect(location.hash).toBe("#/process/driftfraga-paminn-mig-handlaggare"));

  fireEvent.click(screen.getByTitle("Till startsidan"));
  await waitFor(() => expect(location.hash).toBe(""));
});

it("en länk öppnar processen direkt, i läsläge", async () => {
  history.replaceState(null, "", "#/process/driftfraga-paminn-mig-handlaggare");
  render(<AppShell />);

  await waitFor(() => expect(rubrikNamn()).toContain("Driftfråga - påminn mig (handläggare)"));
  expect(location.hash).toBe("#/process/driftfraga-paminn-mig-handlaggare");
  // Läsläge: knappen bjuder in till redigering, den pågår inte.
  expect(screen.getByText(/Redigera/)).toBeTruthy();
});

it("en länk till en process som inte finns landar på startsidan med ren adress", async () => {
  history.replaceState(null, "", "#/process/finns-inte");
  render(<AppShell />);

  await waitFor(() => expect(location.hash).toBe(""));
  expect(document.querySelector(".ark-flow-header")).toBeNull();
});

it("bakåt i webbläsaren går tillbaka till processen man tittade på nyss", async () => {
  history.replaceState(null, "", "#/process/driftfraga-paminn-mig-handlaggare");
  render(<AppShell />);
  await waitFor(() => expect(rubrikNamn()).toContain("påminn mig"));

  // Webbläsaren byter adress och säger till – som vid bakåt/framåt.
  history.pushState(null, "", "#/process/verksamhetsforslag-kommentera-handlaggare");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await waitFor(() => expect(rubrikNamn()).toContain("kommentera ärendet"));
  expect(location.hash).toBe("#/process/verksamhetsforslag-kommentera-handlaggare");
});
