// @vitest-environment happy-dom
/**
 * "Ny process" är den ena av startvyns två vägar. Vyn tolkar ingenting själv –
 * den samlar in valen och lämnar över dem. Testerna håller fast vid det: att
 * begäran bär verktyg, namn, utgångspunkt och text, och att vyn inte släpper
 * igenom en process som inte går att hitta efteråt.
 */

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NyProcess } from "./NyProcess";

afterEach(cleanup);

function rita(
  taget: string[] = [],
  kategorier: string[] = ["Systemprocesser"],
  underkategorier: string[] = [],
) {
  const onSkapa = vi.fn();
  render(
    <NyProcess
      onSkapa={onSkapa}
      onAvbryt={() => {}}
      taget={taget}
      kategorier={kategorier}
      underkategorier={() => underkategorier}
    />,
  );
  return onSkapa;
}

const skrivNamn = (v: string) =>
  fireEvent.change(screen.getByLabelText("Namn på processen"), { target: { value: v } });

it("lämnar över verktyg, namn, utgångspunkt och text", () => {
  const onSkapa = rita();

  skrivNamn("Felanmälan – ny (användare)");
  fireEvent.change(screen.getByPlaceholderText(/En rad per spår/), {
    target: { value: "Medarbetare → Startar portalen" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Skapa process" }));

  expect(onSkapa).toHaveBeenCalledWith("flowchart", {
    namn: "Felanmälan – ny (användare)",
    // Förvalet kommer ur SAMMA regler som trädet – ett flödesschema hör till
    // portalen tills man säger något annat.
    kategori: "Systemprocesser",
    underkategori: "",
    text: "Medarbetare → Startar portalen",
    start: "regler",
  });
});

it("verktyget går att byta, och valet följer med i begäran", () => {
  const onSkapa = rita();

  fireEvent.click(screen.getByRole("button", { name: /Affärsprocess/ }));
  skrivNamn("Rekrytera medarbetare");
  fireEvent.change(screen.getByPlaceholderText(/En rad per spår/), {
    target: { value: "Behov → Annonsera" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Skapa process" }));

  expect(onSkapa.mock.calls[0][0]).toBe("affarsprocess");
});

/**
 * Mall och tom yta har ingen text att tolka. Krävde vyn en beskrivning även
 * där gick de två vägarna inte att gå alls.
 */
it("mall och tom yta kräver ingen beskrivning", () => {
  const onSkapa = rita();

  skrivNamn("Ny rutin");
  fireEvent.click(screen.getByRole("button", { name: /Fyll i en mall/ }));
  expect(screen.queryByPlaceholderText(/En rad per spår/)).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Skapa process" }));
  expect(onSkapa.mock.calls[0][1]).toMatchObject({ namn: "Ny rutin", start: "mall" });
});

it("utan namn går det inte att skapa något", () => {
  rita();
  const knapp = screen.getByRole("button", { name: "Skapa process" }) as HTMLButtonElement;
  expect(knapp.disabled).toBe(true);
});

/**
 * Två poster med samma namn går inte att skilja åt i katalogen. Biblioteket
 * vägrar redan vid sparningen – men då har man hunnit rita hela processen, och
 * beskedet kommer ett arbetspass för sent.
 */
it("ett upptaget namn stoppas här, inte först vid sparningen", () => {
  rita(["Felanmälan - ny (användare)"]);

  skrivNamn("felanmälan - ny (användare)"); // versaler ska inte hjälpa
  expect(screen.getByText(/finns redan en process med det namnet/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Skapa process" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

/**
 * Kärnan i önskemålet: verktyget avgör hur processen RITAS, kategorin var den
 * HÖR HEMMA. En affärsprocess ska kunna ligga under "Systemförvaltning".
 */
it("kategorin väljs fritt och följer med i begäran", () => {
  const onSkapa = rita([], ["Systemprocesser"]);

  fireEvent.click(screen.getByRole("button", { name: /Affärsprocess/ }));
  fireEvent.change(screen.getByLabelText("Namn på processen"), {
    target: { value: "Rekrytera medarbetare" },
  });
  fireEvent.change(screen.getByPlaceholderText(/En rad per spår/), {
    target: { value: "Behov → Annonsera" },
  });

  // "Ny kategori …" öppnar fritextrutan; listan ensam kan inte skapa något nytt.
  fireEvent.change(screen.getByLabelText("Kategori i katalogen"), {
    target: { value: "__ny__" },
  });
  fireEvent.change(screen.getByLabelText("Namn på den nya kategorin"), {
    target: { value: "Systemförvaltning" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Skapa process" }));

  expect(onSkapa).toHaveBeenCalledWith("affarsprocess", {
    namn: "Rekrytera medarbetare",
    kategori: "Systemförvaltning",
    underkategori: "",
    text: "Behov → Annonsera",
    start: "regler",
  });
});

it("en befintlig kategori går att välja utan att stavas om", () => {
  const onSkapa = rita([], ["Systemprocesser", "Systemförvaltning"]);

  fireEvent.change(screen.getByLabelText("Namn på processen"), { target: { value: "Ny rutin" } });
  fireEvent.change(screen.getByPlaceholderText(/En rad per spår/), { target: { value: "A → B" } });
  fireEvent.change(screen.getByLabelText("Kategori i katalogen"), {
    target: { value: "Systemförvaltning" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Skapa process" }));

  expect(onSkapa.mock.calls[0][1].kategori).toBe("Systemförvaltning");
});

it("REGRESSION: Presentation erbjuds inte – en ny affärsprocess där öppnades avskalad, som en förenklad bild", () => {
  rita([], ["Systemprocesser", "Presentation", "Systemförvaltning"]);

  const val = Array.from(
    (screen.getByLabelText("Kategori i katalogen") as HTMLSelectElement).options,
  ).map((o) => o.value);
  expect(val).toContain("Systemförvaltning");
  expect(val).not.toContain("Presentation");
});

/** Förvalet ska följa verktyget så länge man inte rört väljaren. */
it("förvalet byter med verktyget, men ett eget val står kvar", () => {
  rita([], ["Systemprocesser"]);
  const väljare = () => screen.getByLabelText("Kategori i katalogen") as HTMLSelectElement;

  expect(väljare().value).toBe("Systemprocesser");
  fireEvent.click(screen.getByRole("button", { name: /Affärsprocess/ }));
  expect(väljare().value).toBe(""); // affärsprocess har ingen regel – alltså ingen kategori

  fireEvent.change(väljare(), { target: { value: "Systemprocesser" } });
  fireEvent.click(screen.getByRole("button", { name: /Systemprocess/ }));
  expect(väljare().value).toBe("Systemprocesser");
});

/**
 * Strukturen är användarens: kategorin är översta nivån, underkategorin nivån
 * under. Kravet är att kunna lägga en egen gren i sin egen samling ("DEMO →
 * Utbildning") i stället för att få den automatiska indelningen efter
 * ärendetyp och målgrupp.
 */
it("underkategorin väljs fritt och följer med i begäran", () => {
  const onSkapa = rita([], ["Demo"], ["Arkiv"]);

  skrivNamn("Hålla ett föredrag");
  fireEvent.change(screen.getByPlaceholderText(/En rad per spår/), {
    target: { value: "Behov → Håll föredraget" },
  });
  fireEvent.change(screen.getByLabelText("Kategori i katalogen"), { target: { value: "Demo" } });
  // En NY underkategori skrivs in; de befintliga går att välja i listan.
  fireEvent.change(screen.getByLabelText("Underkategori"), { target: { value: "__ny__" } });
  fireEvent.change(screen.getByLabelText("Namn på den nya underkategorin"), {
    target: { value: "Utbildning" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Skapa process" }));

  expect(onSkapa).toHaveBeenCalledWith("flowchart", {
    namn: "Hålla ett föredrag",
    kategori: "Demo",
    underkategori: "Utbildning",
    text: "Behov → Håll föredraget",
    start: "regler",
  });
});

it("en befintlig underkategori går att välja utan att stavas om", () => {
  const onSkapa = rita([], ["Demo"], ["Arkiv", "Utbildning"]);

  skrivNamn("Ny rutin");
  fireEvent.change(screen.getByPlaceholderText(/En rad per spår/), {
    target: { value: "A → B" },
  });
  fireEvent.change(screen.getByLabelText("Underkategori"), { target: { value: "Arkiv" } });
  fireEvent.click(screen.getByRole("button", { name: "Skapa process" }));

  expect(onSkapa.mock.calls[0][1]).toMatchObject({ underkategori: "Arkiv" });
});
