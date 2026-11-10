import { describe, expect, it } from "vitest";
import {
  arkiveraEgenProcess,
  eaKonfigUrMiljö,
  listaApplikationer,
  listaProcesser,
  skapaProcess,
  synkaFlödesscheman,
  uppdateraEgenProcess,
  type EaKonfig,
} from "./ea-portal";

/** En falsk portal som minns anropen. */
function falskPortal(svar: (väg: string, init: RequestInit) => unknown) {
  const anrop: Array<{ väg: string; metod: string; kropp?: unknown; nyckel?: string }> = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const väg = url.replace("http://ea/api/v1", "");
    const headers = init.headers as Record<string, string>;
    anrop.push({
      väg,
      metod: init.method ?? "GET",
      kropp: init.body ? JSON.parse(String(init.body)) : undefined,
      nyckel: headers["x-api-key"],
    });
    const body = svar(väg, init);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const k: EaKonfig = { url: "http://ea/api/v1", nyckel: "hemlig", fetch: f };
  return { k, anrop };
}

describe("EA-portalens klient", () => {
  it("konfigureras bara med nyckel, och URL:en får ett förval", () => {
    expect(eaKonfigUrMiljö({})).toBeNull();
    expect(eaKonfigUrMiljö({ EA_API_KEY: "x" })?.url).toBe("http://localhost:8000/api/v1");
    expect(eaKonfigUrMiljö({ EA_API_KEY: "x", EA_API_URL: "https://ea/api/v1/" })?.url).toBe("https://ea/api/v1");
    // Render ger en intern tjänsts adress som host:port.
    expect(eaKonfigUrMiljö({ EA_API_KEY: "x", EA_API_URL: "ea-api-x7k2:8000" })?.url).toBe(
      "http://ea-api-x7k2:8000/api/v1",
    );
  });

  it("läser processträdet med nyckeln och plockar ut förälder och nummer", async () => {
    const { k, anrop } = falskPortal(() => [
      { id: "a", name: "4 Stödprocesser", external_source: "EXTERN", is_structure: true, attributes: { prefix: "4" } },
      { id: "b", name: "4.4 Drift", external_source: "EXTERN", attributes: { prefix: "4.4", parent_id: "a" } },
    ]);
    const p = await listaProcesser(k);
    expect(anrop[0].väg).toBe("/nodes?node_type=Process&archived=false&limit=10000");
    expect(anrop[0].nyckel).toBe("hemlig");
    expect(p).toEqual([
      { id: "a", namn: "4 Stödprocesser", prefix: "4", struktur: true, källa: "EXTERN" },
      { id: "b", namn: "4.4 Drift", prefix: "4.4", förälderId: "a", struktur: false, källa: "EXTERN" },
    ]);
  });

  it("läser applikationerna med sin status – målet för en Systemprocess", async () => {
    const { k, anrop } = falskPortal(() => [
      { id: "x", name: "Kundportalen", attributes: { status: "I drift" } },
      { id: "y", name: "Gamla ekonomisystemet", attributes: {} },
    ]);
    const a = await listaApplikationer(k);
    expect(anrop[0].väg).toBe("/nodes?node_type=Application&archived=false&limit=10000");
    expect(a).toEqual([
      { id: "x", namn: "Kundportalen", status: "I drift" },
      { id: "y", namn: "Gamla ekonomisystemet" },
    ]);
  });

  it("skapar en ny process med numret först i namnet och ägaren under owner", async () => {
    const { k, anrop } = falskPortal((_, init) => ({
      id: "ny",
      ...JSON.parse(String(init.body)),
      external_source: "NONE",
    }));
    const p = await skapaProcess(k, {
      förälderId: "b",
      namn: " Ny process ",
      prefix: "4.4.5",
      ägare: "IT-chef",
      beskrivning: "Syftet.",
    });
    expect(anrop[0].metod).toBe("POST");
    expect(anrop[0].kropp).toEqual({
      type: "Process",
      name: "4.4.5 Ny process",
      description: "Syftet.",
      attributes: { parent_id: "b", prefix: "4.4.5", owner: "IT-chef", källa: "Arkitekten" },
    });
    expect(p).toMatchObject({ id: "ny", prefix: "4.4.5", förälderId: "b", källa: "NONE" });
  });

  /**
   * REGRESSION-SKYDD mot portalens PATCH, som ersätter HELA `attributes`:
   * skickades bara ägaren försvann förälder och nummer, och processen föll ur
   * trädet.
   */
  it("uppdaterar en egen process utan att tappa förälder och nummer", async () => {
    const { k, anrop } = falskPortal((_väg, init) =>
      init.method === "PATCH"
        ? {}
        : { id: "ny", name: "4.4.5 Ny", attributes: { parent_id: "b", prefix: "4.4.5", owner: "Gammal" } },
    );
    await uppdateraEgenProcess(k, "ny", { ägare: "Ny ägare", beskrivning: "Ny text" });
    expect(anrop[1]).toMatchObject({
      väg: "/nodes/ny",
      metod: "PATCH",
      kropp: {
        description: "Ny text",
        attributes: { parent_id: "b", prefix: "4.4.5", owner: "Ny ägare" },
      },
    });
  });

  it("arkiverar en process som skapats ur Arkitekten", async () => {
    const { k, anrop } = falskPortal((_, init) =>
      init.method === "PATCH"
        ? {}
        : { id: "ny", name: "4.4.5 Ny", external_source: "NONE", attributes: { källa: "Arkitekten" } },
    );
    await arkiveraEgenProcess(k, "ny");
    expect(anrop[1]).toMatchObject({ väg: "/nodes/ny", metod: "PATCH", kropp: { archived: true } });
  });

  it("vägrar arkivera en nod med extern källa eller en nod som skapats i portalen", async () => {
    for (const nod of [
      { id: "443", name: "4.4.3", external_source: "EXTERN", attributes: { källa: "Arkitekten" } },
      { id: "egen", name: "Handskapad", external_source: "NONE", attributes: {} },
    ]) {
      const { k, anrop } = falskPortal(() => nod);
      await expect(arkiveraEgenProcess(k, nod.id)).rejects.toThrow("arkiveras inte härifrån");
      expect(anrop.some((a) => a.metod === "PATCH")).toBe(false);
    }
  });

  it("felen från portalen blir läsbara meddelanden", async () => {
    const { k } = falskPortal(
      () => new Response(JSON.stringify({ detail: "Admin role required" }), { status: 403 }),
    );
    await expect(synkaFlödesscheman(k)).rejects.toThrow("EA-portalen svarade 403 på /arkflows/sync: Admin role required");
  });
});
