// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LokalInloggning } from "./LokalaKonton";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fejkaServern(svar: Record<string, unknown>, status = 200) {
  const anrop: Array<{ väg: string; kropp: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", async (väg: string, init: RequestInit) => {
    anrop.push({ väg, kropp: JSON.parse(String(init.body ?? "{}")) });
    return new Response(JSON.stringify(svar), { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("location", { reload: vi.fn() });
  return anrop;
}

it("första kontot kräver att lösenordet skrivs två gånger likadant, och skapas hos servern", async () => {
  const anrop = fejkaServern({ ok: true });
  render(<LokalInloggning förstaKonto />);
  fireEvent.change(screen.getByLabelText("Användarnamn"), { target: { value: "admin@example.org" } });
  fireEvent.change(screen.getByLabelText("Lösenord"), { target: { value: "ett långt lösenord" } });
  fireEvent.change(screen.getByLabelText("Lösenordet igen"), { target: { value: "ett annat lösenord" } });
  fireEvent.click(screen.getByRole("button", { name: "Skapa administratören" }));
  expect(await screen.findByText("Lösenorden är inte lika.")).toBeTruthy();
  expect(anrop).toHaveLength(0);

  fireEvent.change(screen.getByLabelText("Lösenordet igen"), { target: { value: "ett långt lösenord" } });
  fireEvent.click(screen.getByRole("button", { name: "Skapa administratören" }));
  await vi.waitFor(() => expect(anrop).toHaveLength(1));
  expect(anrop[0].väg).toBe("/__ark/auth/forsta");
});

it("en misslyckad inloggning visar serverns besked", async () => {
  fejkaServern({ ok: false, error: "Fel användarnamn eller lösenord." }, 401);
  render(<LokalInloggning förstaKonto={false} />);
  fireEvent.change(screen.getByLabelText("Användarnamn"), { target: { value: "x@example.org" } });
  fireEvent.change(screen.getByLabelText("Lösenord"), { target: { value: "fel" } });
  fireEvent.click(screen.getByRole("button", { name: "Logga in" }));
  expect(await screen.findByText("Fel användarnamn eller lösenord.")).toBeTruthy();
});
