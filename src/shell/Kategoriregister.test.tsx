// @vitest-environment happy-dom
/**
 * Kategoriregistret i gränssnittet: administratören skapar, den som inte är
 * administratör föreslår, och flaggan visar förslagen som väntar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Användare } from "@/core/behorighet";
import type { Kategoriregister } from "@/core/kategoriregister";
import { AnvändarKontext } from "./Inloggning";
import { Förslagsflagga, KategoriregisterLeverantör, NyKategoriKnapp, TommaKategorier } from "./Kategoriregister";

const admin: Användare = { id: "a", namn: "Admin", roller: ["admin", "user"] };
const anna: Användare = { id: "anna", namn: "Anna", roller: ["user"] };
const FÖRSLAG = { id: "f1", namn: "Hållbarhet", motivering: "Saknas.", föreslagenAv: { id: "anna", namn: "Anna" }, föreslagenAt: "2026-11-25T12:00:00.000Z" };

/** Bryggan i miniatyr: svarar med registret och loggar det som skickas. */
function brygga(start: Kategoriregister) {
  let register = start;
  const anrop: Array<{ väg: string; kropp: any }> = [];
  const svar = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === "/__ark/flows") return svar({ ok: true, flows: [] });
      if (init.method === "POST") {
        const kropp = JSON.parse(String(init.body));
        anrop.push({ väg: url, kropp });
        if (url === "/__ark/kategorier") register = { ...register, kategorier: [...register.kategorier, { namn: kropp.namn, skapadAt: FÖRSLAG.föreslagenAt }] };
        if (url === "/__ark/kategorier/forslag") register = { ...register, förslag: [...register.förslag, { ...FÖRSLAG, namn: kropp.namn }] };
        if (url.startsWith("/__ark/kategorier/forslag/")) register = { ...register, förslag: [] };
      }
      return svar({ ok: true, register });
    }),
  );
  return anrop;
}

const rita = (användare: Användare, barn: React.ReactNode) =>
  render(
    <AnvändarKontext användare={användare} läge="entra">
      <KategoriregisterLeverantör>{barn}</KategoriregisterLeverantör>
    </AnvändarKontext>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Ny kategori", () => {
  it("administratören skapar kategorin direkt i den gemensamma katalogen", async () => {
    const anrop = brygga({ kategorier: [], förslag: [] });
    rita(admin, <><NyKategoriKnapp /><TommaKategorier yta="gemensam" upptagna={[]} /></>);
    fireEvent.click(await screen.findByText("＋ Ny kategori"));
    fireEvent.change(screen.getByLabelText("Kategorins namn"), { target: { value: "Ekonomi" } });
    fireEvent.click(screen.getByText("Skapa kategorin"));
    await waitFor(() => expect(anrop).toEqual([{ väg: "/__ark/kategorier", kropp: { namn: "Ekonomi", yta: "gemensam" } }]));
    // Den tomma kategorin syns i katalogen.
    expect(await screen.findByText("Ekonomi")).toBeTruthy();
  });

  it("den som inte är administratör föreslår – eller skapar i Mina processer", async () => {
    const anrop = brygga({ kategorier: [], förslag: [] });
    rita(anna, <NyKategoriKnapp />);
    fireEvent.click(await screen.findByText("＋ Ny kategori"));
    // Förvalet är den egna katalogen.
    expect(screen.getByText("Skapa kategorin")).toBeTruthy();
    fireEvent.click(screen.getByText("Gemensam katalog"));
    fireEvent.change(screen.getByLabelText("Kategorins namn"), { target: { value: "Hållbarhet" } });
    fireEvent.change(screen.getByLabelText("Varför behövs den? (valfritt)"), { target: { value: "Saknas." } });
    fireEvent.click(screen.getByText("Skicka förslaget"));
    await waitFor(() => expect(anrop).toEqual([{ väg: "/__ark/kategorier/forslag", kropp: { namn: "Hållbarhet", motivering: "Saknas." } }]));
    expect(await screen.findByText(/är skickat/)).toBeTruthy();
  });

  it("utan brygga finns ingen knapp", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nej", { status: 500 })));
    rita(admin, <NyKategoriKnapp />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("＋ Ny kategori")).toBeNull();
  });
});

describe("Förslagsflaggan", () => {
  it("visar administratören antalet förslag och låter hen godkänna", async () => {
    const anrop = brygga({ kategorier: [], förslag: [FÖRSLAG] });
    rita(admin, <Förslagsflagga />);
    fireEvent.click(await screen.findByLabelText("1 kategoriförslag väntar"));
    expect(screen.getByText("Hållbarhet")).toBeTruthy();
    expect(screen.getByText("Saknas.")).toBeTruthy();
    fireEvent.click(screen.getByText("Godkänn"));
    await waitFor(() => expect(anrop).toEqual([{ väg: "/__ark/kategorier/forslag/f1", kropp: { godkänn: true } }]));
    // Inget kvar att besluta om: flaggan försvinner.
    await waitFor(() => expect(screen.queryByLabelText(/kategoriförslag väntar/)).toBeNull());
  });

  it("syns inte när inga förslag väntar", async () => {
    brygga({ kategorier: [], förslag: [] });
    rita(admin, <Förslagsflagga />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("⚑")).toBeNull();
  });
});
