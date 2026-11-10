// @vitest-environment happy-dom
/**
 * Komponenttest för statusvalet i sparraden.
 *
 * Varför ett riktigt DOM-test: numreringen och lagringen är enhetstestade var
 * för sig, men det säger ingenting om det som faktiskt kan gå fel i UI:t – att
 * fastslagenhet inte ärvs av nästa sparning, att förhandsbeskedet ("sparningen
 * blir 2.0") stämmer med vad lagringen sedan gör, och att bekräftelsen inte går
 * att förbi. Det är i den luckan en oavsiktlig huvudversion skapas.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { FlowLibrary, type FlowLibraryHandle } from "./FlowLibrary";
import { textToDraft } from "./parser/toDraft";
import type { SavedFlow } from "@/core/flow-store";

const TEXT = `Driftfråga ny
Fel uppkommer → Startar Portalen → Mejl skickas till handläggaren`;
const DRAFT = textToDraft(TEXT);
const VIEW = { perspective: "system" as const, pageFormat: "free", scale: 1 };

/** Lagringen i minnet – samma gränssnitt som disk och localStorage. */
function minnesLager() {
  const filer = new Map<string, SavedFlow>();
  return {
    filer,
    store: {
      kind: "local" as const,
      list: async () =>
        [...filer.values()].map((f) => ({
          id: f.id,
          name: f.name,
          savedAt: f.savedAt,
          stepCount: f.draft.steps.length,
          versionCount: f.versions.length,
        })),
      load: async (id: string) => {
        const f = filer.get(id);
        if (!f) throw new Error("Flödet finns inte.");
        return f;
      },
      save: async (f: SavedFlow) => void filer.set(f.id, f),
      remove: async (id: string) => void filer.delete(id),
    },
  };
}

let lager = minnesLager();

vi.mock("@/core/flow-store", async () => {
  const riktig = await vi.importActual<typeof import("@/core/flow-store")>("@/core/flow-store");
  return { ...riktig, getFlowStore: async () => lager.store };
});

/** Renderar biblioteket för ett flöde som redigeras (eller ett nytt). */
async function visa(props: Partial<Parameters<typeof FlowLibrary>[0]> = {}) {
  const onSaved = vi.fn();
  render(
    <FlowLibrary
      name="Driftfråga ny"
      onNameChange={() => {}}
      kategori=""
      onKategoriChange={() => {}}
      underkategori=""
      onUnderkategoriChange={() => {}}
      rawText={TEXT}
      aiText=""
      draft={DRAFT}
      view={VIEW}
      dirty={false}
      currentId={null}
      onSaved={onSaved}
      onOpen={() => {}}
      onNew={() => {}}
      {...props}
    />,
  );
  await waitFor(() => expect(screen.getByText("Status på sparningen")).toBeTruthy());
  return { onSaved };
}

const spara = () => fireEvent.click(screen.getByRole("button", { name: /^Spara/ }));
const välj = (etikett: string) => fireEvent.click(screen.getByRole("button", { name: etikett }));
const besked = () => screen.getByText(/Sparningen blir|Inget nytt att spara/).textContent ?? "";

beforeEach(() => {
  lager = minnesLager();
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("statusvalet i sparraden", () => {
  it("utkast är förvalt, och beskedet säger vad sparningen blir", async () => {
    await visa();
    expect(besked()).toContain("0.1");
  });

  it("väljer man Fastslagen blir beskedet en huvudversion", async () => {
    await visa();
    välj("Fastslagen");
    expect(besked()).toContain("1.0");
    expect(besked()).toContain("huvudversion");
  });

  it("förhandsbeskedet stämmer med vad lagringen faktiskt gör", async () => {
    const { onSaved } = await visa();
    välj("Fastslagen");
    const utlovat = besked();
    spara();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const sparad: SavedFlow = onSaved.mock.calls[0][0];
    expect(sparad.versions[0].status).toBe("fastslagen");
    expect(utlovat).toContain("1.0"); // och 1.0 är just vad en fastslagen förstaversion blir
  });

  it("REGRESSION: att mata Spara skapar inte en huvudversion per klick", async () => {
    // Fastslagningen gäller den version man just skapade. Låg valet kvar och
    // räknades om vid varje klick blev 2.0, 3.0, 4.0 … av bara farten.
    const { onSaved } = await visa();
    välj("Fastslagen");
    spara();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    spara();
    spara();
    await waitFor(() => expect(lager.filer.size).toBe(1));
    expect([...lager.filer.values()][0].versions).toHaveLength(1);
  });

  it("REGRESSION: Spara på ett ORÖRT fastslaget flöde degraderar det inte till utkast", async () => {
    // Förvalet i väljaren är utkast, och ett statusbyte räknas som en ändring.
    // Tillsammans gjorde de att ett tryck på Spara i ett flöde man inte rört
    // skrev en utkastversion 1.1 ovanpå huvudversionen 1.0.
    const flöde: SavedFlow = {
      id: "driftfraga-ny",
      name: "Driftfråga ny",
      savedAt: "2026-07-12T08:00:00.000Z",
      rawText: TEXT,
      draft: DRAFT,
      versions: [
        { id: "v1", savedAt: "2026-07-12T08:00:00.000Z", status: "fastslagen", rawText: TEXT, draft: DRAFT },
      ],
    };
    lager.filer.set(flöde.id, flöde);
    await visa({ currentId: flöde.id, dirty: false });
    await waitFor(() => expect(screen.getByText(/nu: 1\.0/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Fastslagen" }).className).toContain("active");
    spara();
    await waitFor(() => expect(lager.filer.get("driftfraga-ny")!.versions).toHaveLength(1));
    expect(lager.filer.get("driftfraga-ny")!.versions[0].status).toBe("fastslagen");
  });

  it("men så snart innehållet ÄR ändrat är förvalet utkast igen", async () => {
    const flöde: SavedFlow = {
      id: "driftfraga-ny",
      name: "Driftfråga ny",
      savedAt: "2026-07-12T08:00:00.000Z",
      rawText: TEXT,
      draft: DRAFT,
      versions: [
        { id: "v1", savedAt: "2026-07-12T08:00:00.000Z", status: "fastslagen", rawText: TEXT, draft: DRAFT },
      ],
    };
    lager.filer.set(flöde.id, flöde);
    // Ett ANNAT innehåll i editorn – det är innehållet som styr förvalet, inte
    // `dirty` (se `innehålletÄndrat` i FlowLibrary).
    const ändrad = textToDraft("Driftfråga ny\nEtt helt annat steg → Klart");
    await visa({ currentId: flöde.id, dirty: true, draft: ändrad, rawText: "annat" });
    await waitFor(() => expect(screen.getByText(/nu: 1\.0/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Utkast" }).className).toContain("active");
    expect(besked()).toContain("1.1");
  });

  it("REGRESSION: efter en återgång till en äldre version lovas inte 'inget nytt att spara'", async () => {
    // `dirty` är falskt efter en återgång (baslinjen blir den återlagda
    // versionen), men innehållet skiljer sig från historikens sista post – och
    // lagringen skriver då en version. Ett eget villkor här sa tvärtom.
    const gammal = textToDraft("Driftfråga ny\nGammalt steg → Klart");
    const flöde: SavedFlow = {
      id: "driftfraga-ny",
      name: "Driftfråga ny",
      savedAt: "2026-07-12T08:00:00.000Z",
      rawText: TEXT,
      draft: DRAFT,
      versions: [
        { id: "v1", savedAt: "2026-07-01T08:00:00.000Z", status: "utkast", rawText: "gammal", draft: gammal },
        { id: "v2", savedAt: "2026-07-12T08:00:00.000Z", status: "utkast", rawText: TEXT, draft: DRAFT },
      ],
    };
    lager.filer.set(flöde.id, flöde);
    // Editorn står på v1:s innehåll efter en återgång – men dirty är falskt.
    await visa({ currentId: flöde.id, dirty: false, draft: gammal, rawText: "gammal" });
    await waitFor(() => expect(screen.getByText(/nu: 0\.2/)).toBeTruthy());
    expect(besked()).toContain("0.3");
    expect(besked()).not.toContain("Inget nytt");
  });

  it("REGRESSION: att fastslå bekräftas, och ett Avbryt sparar ingenting", async () => {
    // Huvudversionen är det andra hänvisar till och går inte att skriva om.
    // Utan bekräftelsen skapades den av ett felklick i en toggle.
    vi.stubGlobal("confirm", vi.fn(() => false));
    const { onSaved } = await visa();
    välj("Fastslagen");
    spara();
    await waitFor(() => expect(lager.filer.size).toBe(0));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("en vanlig utkastsparning frågar inte om något", async () => {
    const bekräfta = vi.fn(() => true);
    vi.stubGlobal("confirm", bekräfta);
    const { onSaved } = await visa();
    spara();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bekräfta).not.toHaveBeenCalled();
  });

  it("ett öppnat flöde visar vilken version det står på, och att en omsparning inte ger en ny", async () => {
    const flöde: SavedFlow = {
      id: "driftfraga-ny",
      name: "Driftfråga ny",
      savedAt: "2026-07-12T08:00:00.000Z",
      rawText: TEXT,
      draft: DRAFT,
      versions: [
        { id: "v1", savedAt: "2026-07-01T08:00:00.000Z", status: "utkast", rawText: TEXT, draft: DRAFT },
        { id: "v2", savedAt: "2026-07-12T08:00:00.000Z", status: "fastslagen", rawText: TEXT, draft: DRAFT },
      ],
    };
    lager.filer.set(flöde.id, flöde);
    await visa({ currentId: flöde.id });
    await waitFor(() => expect(screen.getByText(/nu: 1\.0/)).toBeTruthy());
    // Orört flöde, förvalet = flödets egen status → ingen ny version skulle skapas.
    expect(besked()).toContain("Inget nytt att spara");
    // …men väljer man om till utkast ÄR det en ändring, även med identiskt
    // innehåll: flödet slutar gälla som fastslaget.
    välj("Utkast");
    expect(besked()).toContain("1.1");
  });

  it("versionslistan visar beteckning och status, nyast först", async () => {
    const flöde: SavedFlow = {
      id: "driftfraga-ny",
      name: "Driftfråga ny",
      savedAt: "2026-07-12T08:00:00.000Z",
      rawText: TEXT,
      draft: DRAFT,
      versions: [
        { id: "v1", savedAt: "2026-07-01T08:00:00.000Z", status: "fastslagen", rawText: TEXT, draft: DRAFT },
        { id: "v2", savedAt: "2026-07-12T08:00:00.000Z", rawText: TEXT, draft: DRAFT },
      ],
    };
    lager.filer.set(flöde.id, flöde);
    await visa({ currentId: flöde.id });
    await waitFor(() => expect(screen.getByText(/Versioner av/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Versioner av/));
    const rader = document.querySelectorAll(".ark-version-list li");
    expect([...rader].map((r) => r.querySelector(".ark-version-id")?.textContent)).toEqual([
      "1.1",
      "1.0",
    ]);
    // v2 saknar statusfält – det ska läsas som utkast, inte ärva v1:s fastslagenhet.
    expect(rader[0].textContent).toContain("Utkast");
    expect(rader[1].textContent).toContain("Fastslagen");
  });
});

/**
 * Kategorin är en uppgift om FLÖDET, som namnet – inte om versionen. Att flytta
 * en process till en annan samling ska alltså följa med sparningen utan att
 * historiken rörs.
 */
/**
 * Verktygen börjar en ny process genom att släppa id:t OCH begära en sparning
 * i samma render, och sparningen körs i en effekt – precis som ApTool och
 * FlowchartTool gör det.
 */
function Värd({ börjaNy }: { börjaNy: (starta: () => void) => void }) {
  const [flowId, setFlowId] = useState<string | null>("driftfraga-ny");
  const [namn, setNamn] = useState("Driftfråga ny");
  const [sparaNu, setSparaNu] = useState(false);
  const bibliotek = useRef<FlowLibraryHandle>(null);
  useEffect(() => {
    if (!sparaNu) return;
    setSparaNu(false);
    void bibliotek.current?.spara();
  }, [sparaNu]);
  börjaNy(() => {
    setFlowId(null);
    setNamn("Driftfråga ny 2");
    setSparaNu(true);
  });
  return (
    <FlowLibrary
      ref={bibliotek}
      name={namn}
      onNameChange={() => {}}
      kategori=""
      onKategoriChange={() => {}}
      underkategori=""
      onUnderkategoriChange={() => {}}
      rawText={TEXT}
      aiText=""
      draft={DRAFT}
      view={VIEW}
      dirty={false}
      currentId={flowId}
      onSaved={(f) => setFlowId(f.id)}
      onOpen={() => {}}
      onNew={() => {}}
    />
  );
}

it("REGRESSION: en ny process som sparas direkt blev en ny version av den som var öppen, efter frågan 'Byta namn?'", async () => {
  const gammal: SavedFlow = {
    id: "driftfraga-ny",
    name: "Driftfråga ny",
    savedAt: "2026-07-01T08:00:00.000Z",
    rawText: TEXT,
    draft: DRAFT,
    versions: [{ id: "v1", savedAt: "2026-07-01T08:00:00.000Z", status: "utkast", rawText: TEXT, draft: DRAFT }],
  };
  lager.filer.set(gammal.id, gammal);
  let starta = () => {};
  render(<Värd börjaNy={(s) => (starta = s)} />);
  await waitFor(() => expect(screen.getByText(/Versioner av "Driftfråga ny"/)).toBeTruthy());

  await act(async () => starta());

  await waitFor(() => expect(lager.filer.size).toBe(2));
  expect(lager.filer.get("driftfraga-ny")).toBe(gammal);
  expect(lager.filer.get("driftfraga-ny-2")?.name).toBe("Driftfråga ny 2");
  expect(window.confirm).not.toHaveBeenCalledWith(expect.stringContaining("Byta namn"));
});

it("kategorin följer med sparningen", async () => {
  const { onSaved } = await visa({ kategori: "Systemförvaltning" });
  spara();
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(onSaved.mock.calls[0][0].category).toBe("Systemförvaltning");
});

it("ingen kategori skriver inget fält – då gäller de inbyggda reglerna", async () => {
  const { onSaved } = await visa({ kategori: "" });
  spara();
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(onSaved.mock.calls[0][0].category).toBeUndefined();
});
