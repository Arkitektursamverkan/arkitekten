// @vitest-environment happy-dom
/**
 * Rullgardinen är det som gör att verktygsraden kan ersätta en 320 px bred
 * spalt: raden bär frågan, panelen svaret. Då måste panelen också gå att bli av
 * med – annars har man bara bytt en spalt som alltid syns mot en som lägger sig
 * över diagrammet.
 */

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Rullgardin, VradKnapp } from "./Verktygsrad";

afterEach(cleanup);

it("panelen öppnas och stängs med knappen", () => {
  render(
    <Rullgardin titel="Vy">
      <p>Sidformat</p>
    </Rullgardin>,
  );

  expect(screen.queryByText("Sidformat")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Vy/ }));
  expect(screen.getByText("Sidformat")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Vy/ }));
  expect(screen.queryByText("Sidformat")).toBeNull();
});

it("Esc stänger panelen – samma gest som allt annat som lägger sig ovanpå", () => {
  render(
    <Rullgardin titel="Vy">
      <p>Sidformat</p>
    </Rullgardin>,
  );

  fireEvent.click(screen.getByRole("button", { name: /Vy/ }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByText("Sidformat")).toBeNull();
});

/**
 * REGRESSION: ett klick på ritytan ska både stänga panelen OCH nå ritytan.
 *
 * Med en `click`-lyssnare hann stängningen först och svalde händelsen, så
 * första klicket utanför blev bortkastat – man fick klicka två gånger för att
 * markera ett objekt. Därför `pointerdown`.
 */
it("REGRESSION: ett klick utanför stänger panelen utan att svälja klicket", () => {
  const träffad = vi.fn();
  render(
    <div>
      <Rullgardin titel="Vy">
        <p>Sidformat</p>
      </Rullgardin>
      <button onClick={träffad}>Ritytan</button>
    </div>,
  );

  fireEvent.click(screen.getByRole("button", { name: /Vy/ }));
  expect(screen.getByText("Sidformat")).toBeTruthy();

  const ritytan = screen.getByRole("button", { name: "Ritytan" });
  fireEvent.pointerDown(ritytan);
  fireEvent.click(ritytan);

  expect(screen.queryByText("Sidformat")).toBeNull();
  expect(träffad).toHaveBeenCalledTimes(1);
});

it("ett klick INUTI panelen stänger den inte – man ska kunna dra ett reglage", () => {
  render(
    <Rullgardin titel="Storlek">
      <button>Återställ</button>
    </Rullgardin>,
  );

  fireEvent.click(screen.getByRole("button", { name: /Storlek/ }));
  const inuti = screen.getByRole("button", { name: "Återställ" });
  fireEvent.pointerDown(inuti);
  fireEvent.click(inuti);
  expect(screen.getByRole("button", { name: "Återställ" })).toBeTruthy();
});

it("en knapp i raden säger om den är intryckt", () => {
  render(
    <VradKnapp aktiv title="Lås layout">
      Lås
    </VradKnapp>,
  );
  expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
});

/**
 * REGRESSION: "Spara" i huvudraden gjorde ingenting.
 *
 * Knappen anropar `bibliotek.current?.spara()`, och biblioteket bor inuti
 * rullgardinen "Versioner". Så länge panelens innehåll monterades först när
 * man öppnade den var refen null – klicket föll tyst till marken och flödet
 * stod kvar som "Inte sparat än" hur många gånger man än tryckte. Med
 * `behållBarn` är innehållet monterat hela tiden och bara DOLT när panelen är
 * stängd.
 */
it("behållBarn monterar innehållet även när panelen är stängd", () => {
  render(
    <Rullgardin titel="Versioner" behållBarn>
      <button>Spara</button>
    </Rullgardin>,
  );

  // Monterat (går att nå med en ref) men dolt för användaren.
  const knapp = screen.getByRole("button", { name: "Spara", hidden: true });
  expect(knapp).toBeTruthy();
  expect(knapp.closest(".ark-rullgardin-panel")?.getAttribute("aria-hidden")).toBe("true");
});

it("utan behållBarn är innehållet borta tills panelen öppnas – oförändrat", () => {
  render(
    <Rullgardin titel="Storlek">
      <button>Återställ</button>
    </Rullgardin>,
  );
  expect(screen.queryByRole("button", { name: "Återställ", hidden: true })).toBeNull();
});
