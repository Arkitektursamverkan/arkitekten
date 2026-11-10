// @vitest-environment happy-dom
/**
 * Katalogen ÄR navigeringen till det som redan finns – därför testas den i
 * DOM:en och inte bara som data.
 *
 * Felbeteendet som en gång ledde hit: trettio flöden i en platt lista, alla med
 * samma inledande ord, avhuggna i en smal spalt. Det gick inte att se vilket
 * flöde som var vilket. Kraven är desamma som när trädet bodde i menyn –
 * rubrikerna ska finnas, och kortet ska bära det som SKILJER processerna åt –
 * men de prövas nu där trädet faktiskt ritas.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ProcessKatalog } from "./ProcessKatalog";
import { AnvändarKontext } from "./Inloggning";
import type { FlowSummary } from "@/core/flow-store";
import { användTestärendetyper, återställÄrendetyper } from "@/core/test-arendetyper";

/** Två processer med samma kortnamn i olika målgrupper – det svåra fallet. */
const FLÖDEN: FlowSummary[] = [
  {
    id: "verksamhetsforslag-kommentera-handlaggare",
    name: "Verksamhetsförslag - kommentera ärendet (handläggare)",
    savedAt: "2026-07-29T10:00:00.000Z",
    stepCount: 9,
    versionCount: 1,
    status: "utkast",
    beteckning: "0.1",
    actor: "Handläggare",
  },
  {
    id: "verksamhetsforslag-kommentera-godkannare",
    name: "Verksamhetsförslag - kommentera ärendet (godkännare)",
    savedAt: "2026-07-29T10:00:00.000Z",
    stepCount: 9,
    versionCount: 1,
    status: "utkast",
    beteckning: "0.1",
    actor: "Godkännare",
  },
  {
    id: "driftfraga-paminn-mig-handlaggare",
    name: "Driftfråga - påminn mig (handläggare)",
    savedAt: "2026-07-29T10:00:00.000Z",
    stepCount: 6,
    versionCount: 2,
    status: "fastslagen",
    beteckning: "1.0",
    actor: "Handläggare",
  },
];

function rita(flöden: FlowSummary[] = FLÖDEN) {
  const öppnade: string[] = [];
  render(
    <ProcessKatalog
      flöden={flöden}
      aktivtFlöde={null}
      onÖppna={(id) => öppnade.push(id)}
      onNy={() => {}}
    />,
  );
  return öppnade;
}

// Påhittade ärendetyper – standardlistan är en viss installations portal.
beforeEach(användTestärendetyper);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  återställÄrendetyper();
});

/**
 * Katalogen visade hela biblioteket utrullat – alla samlingar, alla grenar,
 * alla kort på en gång. Med sjuttio processer blev vägen ner i strukturen en
 * lång skrollning (beslut 2026-09-04). Nu visas EN nivå i taget.
 */
function gåTill(...steg: string[]) {
  for (const s of steg) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${s}`) }));
  }
}

it("REGRESSION: en nivå i taget – samlingarna först, inte alla kort", () => {
  rita();

  // NIVÅ 1: samlingen, med vad den innehåller och hur många.
  const rad = screen.getByRole("button", { name: /^Systemprocesser/ });
  expect(within(rad).getByText("3")).toBeTruthy();
  expect(rad.textContent).toContain("Verksamhetsförslag");
  // Inga kort på den här nivån – det var just dem man fick skrolla förbi.
  expect(screen.queryByText("Påminn mig")).toBeNull();

  // NIVÅ 2: grenarna i samlingen.
  gåTill("Systemprocesser");
  expect(screen.getByRole("button", { name: /^Driftfråga/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Verksamhetsförslag/ })).toBeTruthy();
  expect(screen.queryByText("Påminn mig")).toBeNull();

  // NIVÅ 3: processerna, med målgruppen som rubrik.
  gåTill("Verksamhetsförslag");
  expect(screen.getAllByText("Kommentera ärendet")).toHaveLength(2);
  expect(screen.getByRole("heading", { name: "Handläggaren" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Godkännaren" })).toBeTruthy();
});

it("brödsmulan bär vägen tillbaka", () => {
  rita();
  gåTill("Systemprocesser", "Verksamhetsförslag");
  expect(screen.getAllByText("Kommentera ärendet")).toHaveLength(2);

  // Ett steg upp: grenarna igen.
  fireEvent.click(screen.getByRole("button", { name: "Systemprocesser" }));
  expect(screen.queryByText("Kommentera ärendet")).toBeNull();
  expect(screen.getByRole("button", { name: /^Driftfråga/ })).toBeTruthy();

  // Hela vägen hem.
  fireEvent.click(screen.getByRole("button", { name: "Alla samlingar" }));
  expect(screen.getByRole("button", { name: /^Systemprocesser/ })).toBeTruthy();
});

it("kortet bär kortnamnet, och hela namnet finns kvar som hovertext", () => {
  rita();
  gåTill("Systemprocesser", "Verksamhetsförslag");

  // Ärendetyp och roll står redan som rubriker – kortet visar det som skiljer.
  expect(screen.getAllByText("Kommentera ärendet")).toHaveLength(2);

  const kort = screen.getAllByText("Kommentera ärendet")[0].closest("button")!;
  expect(kort.getAttribute("title")).toContain("Verksamhetsförslag - kommentera ärendet");
});

it("sökningen plattar ut strukturen – träffarna står i en lista", () => {
  rita();
  gåTill("Systemprocesser", "Verksamhetsförslag");

  // Söker man vet man inte var något ligger; då är nivåerna i vägen.
  fireEvent.change(screen.getByPlaceholderText("Sök process …"), { target: { value: "påminn" } });
  expect(screen.getByText("Driftfråga - påminn mig (handläggare)")).toBeTruthy();
  expect(screen.queryByText("Kommentera ärendet")).toBeNull();
  expect(screen.queryByRole("button", { name: "Alla samlingar" })).toBeNull();

  // Tom sökruta lämnar tillbaka en till nivån man stod på.
  fireEvent.change(screen.getByPlaceholderText("Sök process …"), { target: { value: "" } });
  expect(screen.getAllByText("Kommentera ärendet")).toHaveLength(2);
});

it("statusfiltret skiljer det som gäller från arbetsmaterialet", () => {
  rita();

  fireEvent.click(screen.getByRole("button", { name: "Fastslagna" }));
  gåTill("Systemprocesser", "Driftfråga");
  expect(screen.getByText("Påminn mig")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Utkast" }));
  // Grenen tömdes av filtret – då finns den inte att stå i heller.
  expect(screen.queryByText("Påminn mig")).toBeNull();
  gåTill("Systemprocesser", "Verksamhetsförslag");
  expect(screen.getAllByText("Kommentera ärendet")).toHaveLength(2);
});

it("läget 'Senast ändrade' visar hela namnet – där finns inga rubriker att luta sig mot", () => {
  rita();

  fireEvent.click(screen.getByRole("button", { name: "Senast ändrade" }));
  expect(screen.getByText("Driftfråga - påminn mig (handläggare)")).toBeTruthy();
  // Kortnamnet ensamt hade varit tvetydigt utan ärendetypen ovanför.
  expect(screen.queryByText("Påminn mig")).toBeNull();
});

it("ett klick på ett kort öppnar processen", () => {
  const öppnade = rita();
  gåTill("Systemprocesser", "Driftfråga");

  fireEvent.click(screen.getByText("Påminn mig").closest("button")!);
  expect(öppnade).toEqual(["driftfraga-paminn-mig-handlaggare"]);
});

it("en tom katalog erbjuder att nollställa filtren i stället för att bara tiga", () => {
  rita();

  fireEvent.change(screen.getByPlaceholderText("Sök process …"), {
    target: { value: "finns inte" },
  });
  expect(screen.getByText("Ingen process matchar det du sökt.")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Nollställ filtren" }));
  // Tillbaka på översta nivån, med samlingarna.
  expect(screen.getByRole("button", { name: /^Systemprocesser/ })).toBeTruthy();
});

/* ------------------------------------------------------------------ */
/* Strukturen ändras där den syns                                      */
/* ------------------------------------------------------------------ */

/**
 * "Jag vill kunna ändra strukturen, men hur då? Ser inte ut att vara möjligt."
 *
 * Placeringen gick bara att sätta en process i taget, inifrån en rullgardin
 * som heter Versioner – och en gren gick inte att döpa om alls. Katalogen är
 * där man SER strukturen, alltså är det där man ska kunna ändra den.
 */
const EGNA: FlowSummary[] = [
  {
    id: "ap-kurs",
    name: "Introduktion för nyanställda",
    savedAt: "2026-09-04T10:00:00.000Z",
    stepCount: 4,
    versionCount: 1,
    actor: "Användare",
    category: "Demo",
    subcategory: "Utbildning",
  },
  {
    id: "ap-arkiv",
    name: "Arkivering av ritningar",
    savedAt: "2026-09-04T10:00:00.000Z",
    stepCount: 3,
    versionCount: 1,
    actor: "Användare",
    category: "Demo",
    subcategory: "Utbildning",
  },
];

function ritaMedStruktur(flöden: FlowSummary[] = EGNA) {
  const onFlytta = vi.fn();
  const onDöpOmGren = vi.fn();
  render(
    <ProcessKatalog
      flöden={flöden}
      aktivtFlöde={null}
      onÖppna={() => {}}
      onNy={() => {}}
      onFlytta={onFlytta}
      onDöpOmGren={onDöpOmGren}
    />,
  );
  return { onFlytta, onDöpOmGren };
}

it("REGRESSION: en gren går att döpa om, och namnet skrivs på ALLA processer i den", () => {
  const { onDöpOmGren } = ritaMedStruktur();

  gåTill("Demo");
  fireEvent.click(screen.getByLabelText("Byt namn på Utbildning"));
  const fält = screen.getByLabelText("Nytt namn på Utbildning");
  fireEvent.change(fält, { target: { value: "Kurser" } });
  fireEvent.keyDown(fält, { key: "Enter" });

  expect(onDöpOmGren).toHaveBeenCalledWith(["ap-arkiv", "ap-kurs"], { subcategory: "Kurser" });
});

it("kategorin döps om på samma sätt", () => {
  const { onDöpOmGren } = ritaMedStruktur();

  fireEvent.click(screen.getByLabelText("Byt namn på Demo"));
  const fält = screen.getByLabelText("Nytt namn på Demo");
  fireEvent.change(fält, { target: { value: "Demoprocesser" } });
  fireEvent.keyDown(fält, { key: "Enter" });

  expect(onDöpOmGren).toHaveBeenCalledWith(["ap-arkiv", "ap-kurs"], { category: "Demoprocesser" });
});

it("Escape ångrar namnbytet – ingenting skrivs", () => {
  const { onDöpOmGren } = ritaMedStruktur();

  gåTill("Demo");
  fireEvent.click(screen.getByLabelText("Byt namn på Utbildning"));
  const fält = screen.getByLabelText("Nytt namn på Utbildning");
  fireEvent.change(fält, { target: { value: "Fel namn" } });
  fireEvent.keyDown(fält, { key: "Escape" });

  expect(onDöpOmGren).not.toHaveBeenCalled();
});

it("samma namn tillbaka skriver ingenting", () => {
  const { onDöpOmGren } = ritaMedStruktur();

  gåTill("Demo");
  fireEvent.click(screen.getByLabelText("Byt namn på Utbildning"));
  fireEvent.keyDown(screen.getByLabelText("Nytt namn på Utbildning"), { key: "Enter" });

  expect(onDöpOmGren).not.toHaveBeenCalled();
});

it("en process flyttas till en annan gren från sitt kort", () => {
  const { onFlytta } = ritaMedStruktur();

  gåTill("Demo", "Utbildning");
  fireEvent.click(screen.getByLabelText("Flytta Arkivering av ritningar"));
  fireEvent.change(screen.getByLabelText("Underkategori"), { target: { value: "__ny__" } });
  fireEvent.change(screen.getByLabelText("Namn på den nya underkategorin"), {
    target: { value: "Arkiv" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Flytta" }));

  // Tredje argumentet är målytan – samma yta som förut, alltså ingen.
  expect(onFlytta).toHaveBeenCalledWith(
    "ap-arkiv",
    { category: "Demo", subcategory: "Arkiv" },
    undefined,
  );
});

it("utan skalets vägar visas inga strukturknappar alls", () => {
  // Katalogen ändrar aldrig lagringen själv – kan skalet inte skriva, ska
  // knapparna inte heller finnas.
  rita(EGNA);
  gåTill("Demo");
  expect(screen.queryByLabelText("Byt namn på Utbildning")).toBeNull();
  gåTill("Utbildning");
  expect(screen.queryByLabelText("Flytta Arkivering av ritningar")).toBeNull();
});

/**
 * REGRESSION: samlingen utan kategori gick inte att döpa om.
 *
 * "Affärsprocess" är rubriken på de processer som SAKNAR kategori –
 * namnet kommer ur verktyget. Pennan var spärrad där, men det är just den
 * samlingen man vill ge ett namn: namnet ÄR det som gör den till en riktig
 * kategori (synpunkt 2026-09-04).
 */
it("REGRESSION: en samling utan kategori går att döpa om – då blir den en", () => {
  const utanKategori: FlowSummary[] = [
    {
      id: "ap-lagerhantering",
      name: "Lagerhantering",
      savedAt: "2026-09-04T10:00:00.000Z",
      stepCount: 6,
      versionCount: 1,
      actor: "Användare",
    },
  ];
  const onDöpOmGren = vi.fn();
  render(
    <ProcessKatalog
      flöden={utanKategori}
      aktivtFlöde={null}
      onÖppna={() => {}}
      onNy={() => {}}
      onFlytta={vi.fn()}
      onDöpOmGren={onDöpOmGren}
    />,
  );

  // Rubriken är verktygets namn, inte "Utan kategori" – samma som i menyn.
  fireEvent.click(screen.getByLabelText("Byt namn på Affärsprocess"));
  const fält = screen.getByLabelText("Nytt namn på Affärsprocess");
  fireEvent.change(fält, { target: { value: "Verksamhetsprocesser" } });
  fireEvent.keyDown(fält, { key: "Enter" });

  expect(onDöpOmGren).toHaveBeenCalledWith(["ap-lagerhantering"], {
    category: "Verksamhetsprocesser",
  });
});

it("ett namnbyte på en STOR gren frågar först", () => {
  const många: FlowSummary[] = Array.from({ length: 12 }, (_, i) => ({
    id: `ap-nr-${i}`,
    name: `Process ${i}`,
    savedAt: "2026-09-04T10:00:00.000Z",
    stepCount: 3,
    versionCount: 1,
    actor: "Användare",
    category: "Demo",
  }));
  const onDöpOmGren = vi.fn();
  const fråga = vi.fn(() => false);
  vi.stubGlobal("confirm", fråga);
  render(
    <ProcessKatalog
      flöden={många}
      aktivtFlöde={null}
      onÖppna={() => {}}
      onNy={() => {}}
      onFlytta={vi.fn()}
      onDöpOmGren={onDöpOmGren}
    />,
  );

  fireEvent.click(screen.getByLabelText("Byt namn på Demo"));
  const fält = screen.getByLabelText("Nytt namn på Demo");
  fireEvent.change(fält, { target: { value: "Något annat" } });
  fireEvent.keyDown(fält, { key: "Enter" });

  expect(fråga).toHaveBeenCalledWith(expect.stringContaining("12 processer"));
  // Nej betyder nej: ingenting skrivs.
  expect(onDöpOmGren).not.toHaveBeenCalled();
  fråga.mockRestore();
});

/**
 * REGRESSION: flytten fanns, men ingen kunde se den.
 *
 * Knappen på kortet var osynlig tills pekaren råkade hamna där, och bar ⋮ –
 * en menysymbol, inte en flytt. Katalogen sa heller ingenstans att strukturen
 * går att ändra – det gick inte att se hur en process flyttas från en
 * kategori/struktur till en annan (synpunkt 2026-09-07). Nu står det i toppen, och
 * knappen finns i DOM:en från början – dess dämpning är ren opacity i CSS,
 * aldrig `display: none` eller ett villkor.
 */
it("katalogen berättar att strukturen går att ändra", () => {
  ritaMedStruktur();
  expect(screen.getByText(/Flytta en process med mappknappen/)).toBeTruthy();
  gåTill("Demo", "Utbildning");
  const knapp = screen.getByLabelText("Flytta Arkivering av ritningar");
  expect(knapp.className).toContain("ark-kort-flytt");
  // Knappen bär ordet – en ensam ikon gick inte att gissa sig till.
  expect(knapp.textContent).toContain("Flytta");
  // Ingen hovertext om ⋮ eller "meny": knappen ska säga vad den gör.
  expect(knapp.getAttribute("title")).toContain("annan samling");
});

it("utan skalets vägar sägs ingenting om att flytta", () => {
  rita(EGNA);
  expect(screen.queryByText(/Flytta en process med mappknappen/)).toBeNull();
});

/**
 * REGRESSION: flyttdialogen sa "Ingen kategori" om en process som ligger i en.
 *
 * Portalens flöden har ingen EGEN kategori – de hamnar under "Systemprocesser"
 * via reglerna i flow-tree, och delas in efter ärendetyp. Dialogen visade bara
 * fältens innehåll, alltså tomt, vilket läses som "den ligger ingenstans". Nu
 * står det var processen ligger nu, och det tomma valet säger vart det leder.
 */
it("flyttdialogen säger var processen ligger nu, även när kategorin är härledd", () => {
  ritaMedStruktur();
  gåTill("Demo", "Utbildning");
  fireEvent.click(screen.getByLabelText("Flytta Arkivering av ritningar"));

  const dialog = screen.getByRole("dialog", { name: /Flytta/ });
  expect(within(dialog).getByText(/Ligger nu i/).textContent).toContain("Demo");
  expect(within(dialog).getByText(/Ligger nu i/).textContent).toContain("Utbildning");
});

it("REGRESSION: under 'Andra användares processer' gick det inte att se vems processen var", () => {
  const admin = { id: "a", namn: "Admin", roller: ["admin" as const, "user" as const] };
  const annans: FlowSummary = {
    ...FLÖDEN[2],
    id: "testssons-process",
    name: "Testssons påminnelse",
    ägare: { id: "test", namn: "Test Testsson" },
    skapadAv: { id: "prov", namn: "Prov Provsson" },
  };
  render(
    <AnvändarKontext användare={admin} läge="entra">
      <ProcessKatalog flöden={[annans]} aktivtFlöde={null} onÖppna={() => {}} onNy={() => {}} />
    </AnvändarKontext>,
  );
  fireEvent.change(screen.getByPlaceholderText("Sök process …"), { target: { value: "Testssons" } });
  expect(screen.getByText("Test Testsson · skapad av Prov Provsson")).toBeTruthy();
});

it("REGRESSION: ägaren syntes bara två hopfällda nivåer ner – nu står den under rubriken", () => {
  const admin = { id: "a", namn: "Admin", roller: ["admin" as const, "user" as const] };
  const annans: FlowSummary = { ...FLÖDEN[2], id: "exempel", name: "Pilot", ägare: { id: "e", namn: "Exempel Exempelsson" } };
  render(
    <AnvändarKontext användare={admin} läge="entra">
      <ProcessKatalog flöden={[annans]} aktivtFlöde={null} onÖppna={() => {}} onNy={() => {}} />
    </AnvändarKontext>,
  );
  expect(screen.getByText("Ägare: Exempel Exempelsson")).toBeTruthy();
});
