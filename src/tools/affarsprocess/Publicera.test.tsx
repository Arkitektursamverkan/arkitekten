// @vitest-environment happy-dom
/**
 * "Publicera i EA-portalen": var, vilken version, vem och vad – och att
 * publiceringen hamnar på FLÖDET utan att bli en ny version.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SavedFlow } from "@/core/flow-store";
import type { EaProcess } from "@/core/publicering";
import { PubliceraKnapp } from "./Publicera";

const PROCESSER: EaProcess[] = [
  { id: "stöd", namn: "4 Stödprocesser", prefix: "4", struktur: true, källa: "EXTERN" },
  { id: "it", namn: "4.4 IT", prefix: "4.4", förälderId: "stöd", struktur: true, källa: "EXTERN" },
  { id: "443", namn: "4.4.3  Allvarlig incident", prefix: "4.4.3", förälderId: "it", struktur: false, källa: "EXTERN" },
];

function flöde(status: "utkast" | "fastslagen"): SavedFlow {
  return {
    id: "ap-4-4-3-incident",
    name: "4.4.3 Allvarlig incident",
    savedAt: "2026-10-01T00:00:00.000Z",
    rawText: "",
    draft: { diagramType: "affarsprocess", steps: [] } as unknown as SavedFlow["draft"],
    versions: [{ id: "v1", savedAt: "2026-10-01T00:00:00.000Z", status, rawText: "", draft: {} as SavedFlow["draft"] }],
  };
}

/** Bryggan i miniatyr: flödesfiler, EA-vägarna och en logg över anropen. */
function bygg(start: SavedFlow) {
  const filer = new Map<string, SavedFlow>([[start.id, start]]);
  const anrop: Array<{ väg: string; metod: string; kropp?: any }> = [];
  const svar = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const metod = init.method ?? "GET";
      const kropp = init.body ? JSON.parse(String(init.body)) : undefined;
      anrop.push({ väg: url, metod, kropp });
      if (url === "/__ark/flows") return svar({ ok: true, flows: [] });
      if (url.startsWith("/__ark/flows/")) {
        const id = decodeURIComponent(url.slice("/__ark/flows/".length));
        if (metod === "PUT") {
          filer.set(id, kropp);
          return svar({ ok: true });
        }
        return svar({ ok: true, flow: filer.get(id) });
      }
      if (url === "/__ark/ea/status") return svar({ ok: true, konfigurerad: true, webb: "https://ea.test" });
      if (url === "/__ark/ea/processer") return svar({ ok: true, processer: PROCESSER });
      if (url === "/__ark/ea/process")
        return svar({ ok: true, process: { id: "ny-nod", namn: "4.4.3.1 Underprocess", prefix: "4.4.3.1", förälderId: "443", struktur: false, källa: "NONE" } });
      if (url === "/__ark/ea/synka") return svar({ ok: true, records_processed: 1, failed: [] });
      if (url === "/__ark/ea/arkivera") return svar({ ok: true });
      return svar({ ok: false, error: "okänd" }, 404);
    }),
  );
  return { filer, anrop };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(cleanup);

describe("Publicera i EA-portalen", () => {
  it("finns inte för en process som inte sparats", () => {
    const { container } = render(
      <PubliceraKnapp flöde={null} osparat={false} fastslå={vi.fn()} onPublicerad={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });

  it("står på processen med samma nummer, kräver ägare och beskrivning, och publicerar utan ny version", async () => {
    const start = flöde("fastslagen");
    const { filer, anrop } = bygg(start);
    const fastslå = vi.fn();
    const onPublicerad = vi.fn();
    render(<PubliceraKnapp flöde={start} osparat={false} fastslå={fastslå} onPublicerad={onPublicerad} />);

    fireEvent.click(screen.getByRole("button", { name: /Publicera i EA-portalen/ }));
    // Förval ur namnets nummer.
    await waitFor(() => expect(screen.getByRole("option", { selected: true }).textContent).toContain("4.4.3"));
    expect(screen.getByText(/fastslagen\) publiceras/)).toBeTruthy();

    // Utan ägare och beskrivning går det inte.
    fireEvent.click(screen.getByRole("button", { name: "Publicera" }));
    expect(screen.getByText("Ange processägare.")).toBeTruthy();
    expect(anrop.some((a) => a.väg === "/__ark/ea/synka")).toBe(false);

    fireEvent.change(screen.getByLabelText("Processägare *"), { target: { value: "IT-chef" } });
    fireEvent.change(screen.getByLabelText("Beskrivning *"), { target: { value: "Så hanteras en incident." } });
    fireEvent.click(screen.getByRole("button", { name: "Publicera" }));

    await waitFor(() => expect(screen.getByText(/är publicerad under/)).toBeTruthy());
    expect(fastslå).not.toHaveBeenCalled();
    // En synkad nod rörs aldrig – ingen nod skapas eller uppdateras.
    expect(anrop.some((a) => a.väg === "/__ark/ea/process")).toBe(false);
    const sparad = filer.get(start.id)!;
    expect(sparad.publicering).toMatchObject({
      eaNodId: "443",
      eaPrefix: "4.4.3",
      ägare: "IT-chef",
      beskrivning: "Så hanteras en incident.",
    });
    expect(sparad.publicering?.egenNod).toBeUndefined();
    expect(sparad.versions).toHaveLength(1);
    expect(sparad.savedAt).toBe(start.savedAt);
    expect(onPublicerad).toHaveBeenCalledWith(sparad);
    expect(anrop.some((a) => a.väg === "/__ark/ea/synka" && a.metod === "POST")).toBe(true);
    expect(screen.getByRole("link", { name: "Öppna i EA-portalen" }).getAttribute("href")).toBe(
      "https://ea.test/processes?id=443",
    );
  });

  it("fastslår först när inget är fastslaget, och skapar en ny process under vald förälder", async () => {
    const start = flöde("utkast");
    const { filer, anrop } = bygg(start);
    const fastslagen: SavedFlow = {
      ...start,
      versions: [...start.versions, { ...start.versions[0], id: "v2", status: "fastslagen" }],
    };
    const fastslå = vi.fn(async () => {
      filer.set(start.id, fastslagen);
      return fastslagen;
    });
    render(<PubliceraKnapp flöde={start} osparat={false} fastslå={fastslå} onPublicerad={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Publicera i EA-portalen/ }));
    await waitFor(() => screen.getByRole("option", { selected: true }));
    expect(screen.getByText(/Inget är fastslaget än/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ny process under …" }));
    // Förslaget på nummer räknas fram ur föräldern.
    expect((screen.getByLabelText("Nummer") as HTMLInputElement).value).toBe("4.4.3.1");
    fireEvent.change(screen.getByLabelText("Namn på processen"), { target: { value: "Underprocess" } });
    fireEvent.change(screen.getByLabelText("Processägare *"), { target: { value: "IT-chef" } });
    fireEvent.change(screen.getByLabelText("Beskrivning *"), { target: { value: "Syftet." } });
    fireEvent.click(screen.getByRole("button", { name: "Publicera" }));

    await waitFor(() => expect(screen.getByText(/är publicerad under/)).toBeTruthy());
    expect(fastslå).toHaveBeenCalledOnce();
    expect(anrop.find((a) => a.väg === "/__ark/ea/process")?.kropp).toEqual({
      förälderId: "443",
      namn: "Underprocess",
      prefix: "4.4.3.1",
      ägare: "IT-chef",
      beskrivning: "Syftet.",
    });
    const sparad = filer.get(start.id)!;
    expect(sparad.publicering).toMatchObject({ eaNodId: "ny-nod", egenNod: true });
    // Publiceringen lades på den FASTSLAGNA posten – versionen följde med.
    expect(sparad.versions).toHaveLength(2);
  });

  it("avbryts publiceringen när man avbryter fastslagningen", async () => {
    const start = flöde("utkast");
    const { anrop } = bygg(start);
    render(<PubliceraKnapp flöde={start} osparat={false} fastslå={vi.fn(async () => null)} onPublicerad={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Publicera i EA-portalen/ }));
    await waitFor(() => screen.getByRole("option", { selected: true }));
    fireEvent.change(screen.getByLabelText("Processägare *"), { target: { value: "IT-chef" } });
    fireEvent.change(screen.getByLabelText("Beskrivning *"), { target: { value: "Syftet." } });
    fireEvent.click(screen.getByRole("button", { name: "Publicera" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Publicera" })).toBeTruthy());
    expect(anrop.some((a) => a.metod === "PUT" || a.väg.startsWith("/__ark/ea/synka"))).toBe(false);
  });

  describe("avpublicering", () => {
    const PUB = {
      eaNodId: "443",
      eaNodNamn: "4.4.3  Allvarlig incident",
      eaPrefix: "4.4.3",
      ägare: "IT-chef",
      beskrivning: "Syftet.",
      publiceradAt: "2026-10-08T10:00:00.000Z",
    };

    async function öppnaAvpublicering(start: SavedFlow) {
      fireEvent.click(screen.getByRole("button", { name: /Publicerad i EA/ }));
      await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
      fireEvent.click(screen.getByRole("button", { name: "Avpublicera …" }));
      expect(screen.getByText(/Processbilden försvinner ur portalen/)).toBeTruthy();
      return start;
    }

    it("tar bort publiceringen utan ny version och låter portalen hämta om – en synkad nod rörs inte", async () => {
      const start = { ...flöde("fastslagen"), publicering: PUB };
      const { filer, anrop } = bygg(start);
      const onPublicerad = vi.fn();
      render(<PubliceraKnapp flöde={start} osparat={false} fastslå={vi.fn()} onPublicerad={onPublicerad} />);
      await öppnaAvpublicering(start);
      expect(screen.getByText(/kommer från den synkade processkartan och står kvar/)).toBeTruthy();
      expect(screen.queryByLabelText(/Arkivera även/)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Avpublicera" }));
      await waitFor(() => expect(screen.getByText(/inte längre publicerad/)).toBeTruthy());

      const sparad = filer.get(start.id)!;
      expect(sparad.publicering).toBeUndefined();
      expect(sparad.versions).toHaveLength(1);
      expect(sparad.savedAt).toBe(start.savedAt);
      expect(onPublicerad).toHaveBeenCalledWith(sparad);
      expect(anrop.some((a) => a.väg === "/__ark/ea/arkivera")).toBe(false);
      expect(anrop.some((a) => a.väg === "/__ark/ea/synka")).toBe(true);
    });

    it("arkiverar en process som publiceringen skapade – om man inte väljer bort det", async () => {
      const start = { ...flöde("fastslagen"), publicering: { ...PUB, eaNodId: "ny-nod", egenNod: true } };
      const { anrop } = bygg(start);
      render(<PubliceraKnapp flöde={start} osparat={false} fastslå={vi.fn()} onPublicerad={vi.fn()} />);
      await öppnaAvpublicering(start);
      expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Avpublicera" }));
      await waitFor(() => expect(screen.getByText(/inte längre publicerad/)).toBeTruthy());
      expect(anrop.find((a) => a.väg === "/__ark/ea/arkivera")?.kropp).toEqual({ id: "ny-nod" });
    });

    it("låter processen stå kvar när man väljer bort arkiveringen", async () => {
      const start = { ...flöde("fastslagen"), publicering: { ...PUB, eaNodId: "ny-nod", egenNod: true } };
      const { anrop } = bygg(start);
      render(<PubliceraKnapp flöde={start} osparat={false} fastslå={vi.fn()} onPublicerad={vi.fn()} />);
      await öppnaAvpublicering(start);
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Avpublicera" }));
      await waitFor(() => expect(screen.getByText(/inte längre publicerad/)).toBeTruthy());
      expect(anrop.some((a) => a.väg === "/__ark/ea/arkivera")).toBe(false);
    });

    it("finns inte för en process som inte är publicerad", async () => {
      const start = flöde("fastslagen");
      bygg(start);
      render(<PubliceraKnapp flöde={start} osparat={false} fastslå={vi.fn()} onPublicerad={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: /Publicera i EA-portalen/ }));
      await waitFor(() => screen.getByRole("option", { selected: true }));
      expect(screen.queryByRole("button", { name: "Avpublicera …" })).toBeNull();
    });
  });
});
