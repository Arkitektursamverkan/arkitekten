// @vitest-environment happy-dom
/**
 * "Publicera i EA-portalen" för en Systemprocess: vilken applikation, vilken
 * version, vem och vad – och att publiceringen hamnar på FLÖDET utan att bli
 * en ny version, och utan att någon nod i portalen skapas eller ändras.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SavedFlow } from "@/core/flow-store";
import type { EaApplikation } from "@/core/publicering";
import { sökApplikationer } from "@/core/publicering";
import { PubliceraSystemprocessKnapp } from "./PubliceraSystemprocess";

const APPAR: EaApplikation[] = [
  { id: "gammal", namn: "Arkivet", status: "Avvecklat" },
  { id: "portal", namn: "Kundportalen", status: "I drift" },
  { id: "pa", namn: "Power Automate" },
];

function flöde(publicering?: SavedFlow["publicering"]): SavedFlow {
  return {
    id: "bestallning-ny",
    name: "Ny beställning",
    savedAt: "2026-10-01T00:00:00.000Z",
    rawText: "",
    draft: { steps: [] } as unknown as SavedFlow["draft"],
    versions: [
      { id: "v1", savedAt: "2026-10-01T00:00:00.000Z", status: "fastslagen", rawText: "", draft: {} as SavedFlow["draft"] },
    ],
    ...(publicering ? { publicering } : {}),
  };
}

/** Bryggan i miniatyr: flödesfiler, EA-vägarna och en logg över anropen. */
function bygg(start: SavedFlow) {
  const filer = new Map<string, SavedFlow>([[start.id, start]]);
  const anrop: Array<{ väg: string; metod: string }> = [];
  const svar = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const metod = init.method ?? "GET";
      anrop.push({ väg: url, metod });
      if (url === "/__ark/flows") return svar({ ok: true, flows: [] });
      // Publiceringen skrivs av bryggan (server/atkomst.ts prövaPublicering) –
      // aldrig med en vanlig sparning.
      if (url.startsWith("/__ark/ea/publicering/")) {
        const id = decodeURIComponent(url.slice("/__ark/ea/publicering/".length));
        const { publicering: _gammal, ...utan } = filer.get(id)!;
        const ny = metod === "PUT" ? { ...utan, publicering: JSON.parse(String(init.body)).publicering } : utan;
        filer.set(id, ny as SavedFlow);
        return svar({ ok: true, flow: ny });
      }
      if (url.startsWith("/__ark/flows/")) {
        const id = decodeURIComponent(url.slice("/__ark/flows/".length));
        if (metod === "PUT") {
          filer.set(id, JSON.parse(String(init.body)));
          return svar({ ok: true });
        }
        return svar({ ok: true, flow: filer.get(id) });
      }
      if (url === "/__ark/ea/status") return svar({ ok: true, konfigurerad: true, webb: "https://ea.test" });
      if (url === "/__ark/ea/applikationer") return svar({ ok: true, applikationer: APPAR });
      if (url === "/__ark/ea/synka") return svar({ ok: true, records_processed: 1, failed: [] });
      return svar({ ok: false, error: "okänd" }, 404);
    }),
  );
  return { filer, anrop };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(cleanup);

describe("Publicera en Systemprocess i EA-portalen", () => {
  it("finns inte för ett flöde som inte sparats", () => {
    const { container } = render(
      <PubliceraSystemprocessKnapp flöde={null} osparat={false} fastslå={vi.fn()} onPublicerad={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });

  it("väljer en applikation, kräver ägare och beskrivning, och publicerar utan ny version", async () => {
    const start = flöde();
    const { filer, anrop } = bygg(start);
    const fastslå = vi.fn();
    const onPublicerad = vi.fn();
    render(<PubliceraSystemprocessKnapp flöde={start} osparat={false} fastslå={fastslå} onPublicerad={onPublicerad} />);

    fireEvent.click(screen.getByRole("button", { name: /Publicera i EA-portalen/ }));
    await waitFor(() => screen.getByRole("option", { name: /Kundportalen/ }));

    // Utan applikation, ägare och beskrivning går det inte.
    fireEvent.click(screen.getByRole("button", { name: "Publicera" }));
    expect(screen.getByText("Välj vilken applikation systemprocessen hör till.")).toBeTruthy();
    expect(screen.getByText("Ange ägare.")).toBeTruthy();

    fireEvent.click(screen.getByRole("option", { name: /Kundportalen/ }));
    fireEvent.change(screen.getByLabelText("Ägare *"), { target: { value: "Systemförvaltare" } });
    fireEvent.change(screen.getByLabelText("Beskrivning *"), { target: { value: "Så går en beställning." } });
    fireEvent.click(screen.getByRole("button", { name: "Publicera" }));

    await waitFor(() => expect(screen.getByText(/är publicerad hos/)).toBeTruthy());
    expect(fastslå).not.toHaveBeenCalled();
    const sparad = filer.get(start.id)!;
    expect(sparad.publicering).toMatchObject({
      eaNodId: "portal",
      eaNodNamn: "Kundportalen",
      ägare: "Systemförvaltare",
      beskrivning: "Så går en beställning.",
    });
    expect(sparad.publicering?.egenNod).toBeUndefined();
    // Ingen ny version, ingen ändrad sparad-tid (invariant 11).
    expect(sparad.versions).toHaveLength(1);
    expect(sparad.savedAt).toBe(start.savedAt);
    expect(onPublicerad).toHaveBeenCalledWith(sparad);
    // Portalen rörs bara genom att ombes hämta – ingen nod skapas.
    expect(anrop.filter((a) => a.väg.startsWith("/__ark/ea/") && a.metod === "POST").map((a) => a.väg)).toEqual([
      "/__ark/ea/synka",
    ]);
    expect(screen.getByRole("link", { name: "Öppna i EA-portalen" }).getAttribute("href")).toBe(
      "https://ea.test/systems?id=portal&flik=systemprocesser",
    );
  });

  it("avpublicerar utan ny version och utan att röra applikationen", async () => {
    const start = flöde({
      eaNodId: "portal",
      eaNodNamn: "Kundportalen",
      ägare: "Systemförvaltare",
      beskrivning: "Syftet.",
      publiceradAt: "2026-10-02T00:00:00.000Z",
    });
    const { filer, anrop } = bygg(start);
    render(<PubliceraSystemprocessKnapp flöde={start} osparat={false} fastslå={vi.fn()} onPublicerad={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Publicerad i EA/ }));
    await waitFor(() => screen.getByRole("option", { name: /publicerad här/ }));
    fireEvent.click(screen.getByRole("button", { name: "Avpublicera …" }));
    fireEvent.click(screen.getByRole("button", { name: "Avpublicera" }));

    await waitFor(() => expect(screen.getByText(/inte längre publicerad/)).toBeTruthy());
    const sparad = filer.get(start.id)!;
    expect(sparad.publicering).toBeUndefined();
    expect(sparad.versions).toHaveLength(1);
    expect(anrop.some((a) => a.väg === "/__ark/ea/arkivera")).toBe(false);
  });

  it("listar avvecklade applikationer sist", () => {
    expect(sökApplikationer(APPAR, "").map((a) => a.id)).toEqual(["portal", "pa", "gammal"]);
    expect(sökApplikationer(APPAR, "power").map((a) => a.id)).toEqual(["pa"]);
  });
});
