// @vitest-environment happy-dom
/**
 * Systemskissens vy: skapa, rita, spara – och att synligheten bara erbjuds
 * den som får bestämma över den.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Användare } from "@/core/behorighet";
import { AnvändarKontext } from "@/shell/Inloggning";
import { SkissVy } from "./SkissVy";

const admin: Användare = { id: "a", namn: "Admin", roller: ["admin"] };
const anna: Användare = { id: "anna", namn: "Anna", roller: ["user"] };

beforeEach(() => {
  localStorage.clear();
  // Ingen brygga i testet: lagringen faller tillbaka på localStorage.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ingen brygga")));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sparade = () =>
  Object.keys(localStorage)
    .filter((k) => k.startsWith("ark.skiss."))
    .map((k) => JSON.parse(localStorage.getItem(k)!));

async function skapa(namn: string) {
  fireEvent.change(await screen.findByLabelText("Skissens namn"), { target: { value: namn } });
  await waitFor(() => expect((screen.getByRole("button", { name: "Skapa" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Skapa" }));
  await screen.findByRole("toolbar", { name: "Lägg till" });
}

it("en ny skiss sparas direkt, och objekt man lägger till hamnar i bilden och i filen", async () => {
  render(
    <AnvändarKontext användare={admin} läge="entra">
      <SkissVy />
    </AnvändarKontext>,
  );
  await skapa("Utvecklingsmiljö");
  expect(sparade()).toHaveLength(1);

  fireEvent.click(screen.getByTitle("Lägg till: Server"));
  fireEvent.click(screen.getByTitle("Lägg till: Databas"));
  expect(document.querySelectorAll("[data-skiss-objekt]")).toHaveLength(2);
  expect(screen.getByText("Osparade ändringar")).toBeTruthy();

  // Det nya objektet är markerat: namnet skrivs i panelen och syns i bilden.
  fireEvent.change(screen.getByLabelText("Namn"), { target: { value: "Postgres 17" } });
  expect(document.querySelector(".ark-skiss-svg")!.textContent).toContain("Postgres 17");

  fireEvent.click(screen.getByRole("button", { name: "Spara" }));
  await waitFor(() => expect(screen.queryByText("Osparade ändringar")).toBeNull());
  expect(sparade()[0].objekt.map((o: { namn: string }) => o.namn)).toEqual(["Server", "Postgres 17"]);
});

it("ångra tar tillbaka det senaste objektet, och gör om lägger tillbaka det", async () => {
  render(<SkissVy />);
  await skapa("Ångra");
  fireEvent.click(screen.getByTitle("Lägg till: Server"));
  expect(document.querySelectorAll("[data-skiss-objekt]")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Ångra" }));
  expect(document.querySelectorAll("[data-skiss-objekt]")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Gör om" }));
  expect(document.querySelectorAll("[data-skiss-objekt]")).toHaveLength(1);
});

it("en administratör kan dölja skissen redan när den skapas – den märks då som dold", async () => {
  render(
    <AnvändarKontext användare={admin} läge="entra">
      <SkissVy />
    </AnvändarKontext>,
  );
  fireEvent.click(await screen.findByLabelText("Dold för andra än administratörer"));
  await skapa("Hemlig miljö");
  expect(sparade()[0].dold).toBe(true);
  expect(screen.getByText("🔒 Dold")).toBeTruthy();
});

it("den som inte är administratör erbjuds aldrig att dölja", async () => {
  render(
    <AnvändarKontext användare={anna} läge="entra">
      <SkissVy />
    </AnvändarKontext>,
  );
  await screen.findByLabelText("Skissens namn");
  expect(screen.queryByLabelText("Dold för andra än administratörer")).toBeNull();
});

it("någon annans skiss går att titta på men inte ändra", async () => {
  localStorage.setItem(
    "ark.skiss.bos",
    JSON.stringify({
      id: "bos",
      namn: "Bos skiss",
      savedAt: "2026-11-20T10:00:00.000Z",
      skapadAv: { id: "bo", namn: "Bo" },
      objekt: [{ id: "o-1", sort: "server", namn: "Server", x: 0, y: 0, b: 170, h: 64 }],
      zoner: [],
      kopplingar: [],
    }),
  );
  render(
    <AnvändarKontext användare={anna} läge="entra">
      <SkissVy />
    </AnvändarKontext>,
  );
  fireEvent.click(await screen.findByText("Bos skiss"));
  await waitFor(() => expect(document.querySelectorAll("[data-skiss-objekt]")).toHaveLength(1));
  expect(screen.queryByRole("toolbar", { name: "Lägg till" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Spara" })).toBeNull();
  expect(screen.getByText(/Bara Bo eller en administratör kan ändra den/)).toBeTruthy();
  // Exporten finns kvar för den som bara tittar.
  expect(screen.getByRole("button", { name: "SVG" })).toBeTruthy();
});

it("ett lager visas för sig: klicket gömmer det andra lagret, 'Alla' tar tillbaka det", async () => {
  localStorage.setItem(
    "ark.skiss.lager",
    JSON.stringify({
      id: "lager",
      namn: "Med lager",
      savedAt: "2026-11-20T10:00:00.000Z",
      lager: [
        { id: "l-a", namn: "Portalen" },
        { id: "l-b", namn: "iTid" },
      ],
      objekt: [
        { id: "o-1", sort: "tjanst", namn: "Portal", lager: "l-a", x: 0, y: 0, b: 170, h: 64 },
        { id: "o-2", sort: "tjanst", namn: "iTid-appen", lager: "l-b", x: 400, y: 0, b: 170, h: 64 },
        { id: "o-3", sort: "anvandare", namn: "Medarbetare", x: 0, y: 300, b: 170, h: 64 },
      ],
      zoner: [{ id: "z-1", namn: "iTid-zonen", färg: "bla", lager: "l-b", x: 380, y: -40, b: 220, h: 140 }],
      kopplingar: [{ id: "k-1", från: "o-3", till: "o-1", pil: "till", linje: "hel" }],
    }),
  );
  render(<SkissVy />);
  fireEvent.click(await screen.findByText("Med lager"));
  await waitFor(() => expect(document.querySelectorAll("[data-skiss-objekt]")).toHaveLength(3));

  fireEvent.click(screen.getByRole("button", { name: "Portalen" }));
  const bild = () => document.querySelector(".ark-skiss-svg")!.textContent ?? "";
  // Lagret och det gemensamma som är kopplat till det syns; det andra lagret – med sin zon – är borta.
  expect(document.querySelectorAll("[data-skiss-objekt]")).toHaveLength(2);
  expect(bild()).toContain("Medarbetare");
  expect(bild()).not.toContain("iTid-appen");
  expect(document.querySelectorAll("[data-skiss-zon]")).toHaveLength(0);

  // Ett nytt objekt hamnar i lagret man tittar på – och syns därför.
  fireEvent.click(screen.getByTitle("Lägg till: Databas"));
  expect(document.querySelectorAll("[data-skiss-objekt]")).toHaveLength(3);

  fireEvent.click(screen.getByRole("button", { name: "Alla" }));
  expect(document.querySelectorAll("[data-skiss-objekt]")).toHaveLength(4);
  expect(document.querySelectorAll("[data-skiss-zon]")).toHaveLength(1);
});
