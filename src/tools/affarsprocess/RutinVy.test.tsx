// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { compileAp, renameSatellit, satellitId, setStepAp, sättRutin } from "@/core/affarsprocess";
import { emptyDraft, makeLane, type ProcessDraft } from "@/core/draft";
import { apNodeSvg } from "./former";
import { knytIhop, läggTillObjekt } from "./lagg-till";
import { RutinVy } from "./RutinVy";
import { rutinUrSvar } from "./ai-rutin";

afterEach(cleanup);

const KRAV = "Rutin för eDiscovery Search";

function underlag(): ProcessDraft {
  const lane = makeLane("Registrator", 0);
  const bas: ProcessDraft = {
    ...emptyDraft(),
    lanes: [lane],
    steps: [
      { id: "s1", sourceIndex: 0, type: "start", text: "Begäran", laneId: lane.id },
      { id: "s2", sourceIndex: 1, type: "activity", text: "Genomför sökning", laneId: lane.id },
    ] as ProcessDraft["steps"],
  };
  return setStepAp(bas, "s2", { krav: [KRAV] });
}

describe("rutinen bakom ett krav", () => {
  const id = satellitId("krav", "s2", KRAV);

  it("lagras på draften under kravets id och når modellen", () => {
    const d = sättRutin({ ...underlag(), edgeStyles: { x: {} } }, id, "Öppna webbläsaren\nLogga in\n");
    expect(d.apRutiner).toEqual({ [id]: { text: "Öppna webbläsaren\nLogga in" } });
    expect(d.edgeStyles).toEqual({ x: {} }); // draften sprids, inget tappas
    expect(compileAp(d).nodes.find((n) => n.id === id)?.rutin).toBe("Öppna webbläsaren\nLogga in");
    expect(compileAp(underlag()).nodes.find((n) => n.id === id)?.rutin).toBeUndefined();
  });

  it("tas bort med tom text", () => {
    const d = sättRutin(sättRutin(underlag(), id, "Ett moment"), id, "  ");
    expect(d.apRutiner).toEqual({});
  });

  it("följer med när kravet döps om", () => {
    const d = renameSatellit(sättRutin(underlag(), id, "Ett moment"), "s2", "krav", KRAV, "Sökrutin");
    expect(d.apRutiner).toEqual({ [satellitId("krav", "s2", "Sökrutin")]: { text: "Ett moment" } });
  });

  it("följer med när ett fritt krav knyts till en aktivitet", () => {
    const { draft: medFri, nodId } = läggTillObjekt(underlag(), "krav", { x: 0, y: 0 });
    const friId = nodId!;
    const d = knytIhop(sättRutin(medFri, friId, "Ett moment"), friId, "s2");
    const krav = compileAp(d).nodes.filter((n) => n.kind === "krav" && n.rutin);
    expect(krav).toHaveLength(1);
    expect(krav[0].anchorId).toBe("s2");
    expect(d.apRutiner?.[friId]).toBeUndefined();
  });

  it("ger kravet rutin-ikonen – och bara när rutinen finns", () => {
    const nod = (d: ProcessDraft) => compileAp(d).nodes.find((n) => n.id === id)!;
    const utan = apNodeSvg(nod(underlag()), 0, 0, 120, 44);
    const med = apNodeSvg(nod(sättRutin(underlag(), id, "Ett moment")), 0, 0, 120, 44);
    expect(utan).not.toContain("<circle");
    expect(med).toContain("<circle");
  });
});

describe("RutinVy", () => {
  it("visar momenten numrerade med underpunkter, utan redigering i läsläge", () => {
    render(
      <RutinVy namn={KRAV} text={"Ange villkor:\n  Nyckelord\n  Datum\nKör frågan"} redigerbar={false} onSpara={vi.fn()} onClose={vi.fn()} />,
    );
    const lista = screen.getByRole("dialog").querySelector("ol")!;
    expect(lista.querySelectorAll(":scope > li")).toHaveLength(2);
    expect(lista.querySelectorAll("ul > li")).toHaveLength(2);
    expect(screen.queryByText("Redigera")).toBeNull();
  });

  it("ritar en klickväg som brickor och korta alternativ som val", () => {
    render(
      <RutinVy namn={KRAV} text={"Gå till Lösningar → eDiscovery → Ärenden\nAnge villkor:\n  Nyckelord\n  Datum"} redigerbar={false} onSpara={vi.fn()} onClose={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog");
    expect([...dialog.querySelectorAll(".ark-rutin-bricka")].map((b) => b.textContent)).toEqual([
      "Gå till Lösningar",
      "eDiscovery",
      "Ärenden",
    ]);
    expect(dialog.querySelector("ul.val")?.children).toHaveLength(2);
    expect(dialog.querySelector(".ark-rutin-ikon.navigera")).toBeTruthy();
  });

  it("bockar av moment, räknar framsteget och flyttar fram var man är", () => {
    const onSpara = vi.fn();
    render(<RutinVy namn={KRAV} text={"Öppna webbläsaren\nLogga in\nKör frågan"} redigerbar={false} onSpara={onSpara} onClose={vi.fn()} />);
    const moment = () => [...screen.getByRole("dialog").querySelectorAll(".ark-rutin-moment")];
    expect(screen.getByText("0 av 3 klara")).toBeTruthy();
    expect(moment()[0].classList.contains("aktuell")).toBe(true);

    fireEvent.click(screen.getByLabelText("Moment 1: inte klart"));
    expect(screen.getByText("1 av 3 klara")).toBeTruthy();
    expect(moment()[0].classList.contains("klar")).toBe(true);
    expect(moment()[1].classList.contains("aktuell")).toBe(true);

    fireEvent.click(screen.getByText("Börja om"));
    expect(screen.getByText("0 av 3 klara")).toBeTruthy();
    // Avbockningen är läsarens, inte rutinens – ingenting sparas.
    expect(onSpara).not.toHaveBeenCalled();
  });

  it("börjar i skrivläget när kravet saknar rutin, och sparar texten", () => {
    const onSpara = vi.fn();
    render(<RutinVy namn={KRAV} redigerbar onSpara={onSpara} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Klistra in text"));
    fireEvent.change(screen.getByLabelText("Rutinens text"), { target: { value: "Öppna webbläsaren\nLogga in" } });
    fireEvent.click(screen.getByText("Skapa rutinen"));
    expect(onSpara).toHaveBeenCalledWith("Öppna webbläsaren\nLogga in");
  });

  it("tar bort rutinen och stänger", () => {
    const onSpara = vi.fn();
    const onClose = vi.fn();
    render(<RutinVy namn={KRAV} text="Ett moment" redigerbar onSpara={onSpara} onClose={onClose} />);
    fireEvent.click(screen.getByText("Ta bort rutinen"));
    expect(onSpara).toHaveBeenCalledWith(undefined);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("byggaren – rutinen moment för moment", () => {
  it("bygger en rutin med moment och underpunkter, och sparar den som text", () => {
    const onSpara = vi.fn();
    render(<RutinVy namn={KRAV} redigerbar onSpara={onSpara} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Moment 1"), { target: { value: "Ange villkor" } });
    fireEvent.click(screen.getByText("+ underpunkt"));
    fireEvent.change(screen.getByLabelText("Underpunkt 1 till moment 1"), { target: { value: "Nyckelord" } });
    // Enter i en underpunkt ger nästa underpunkt, Enter i ett moment nästa moment.
    fireEvent.keyDown(screen.getByLabelText("Underpunkt 1 till moment 1"), { key: "Enter" });
    fireEvent.change(screen.getByLabelText("Underpunkt 2 till moment 1"), { target: { value: "Datum" } });
    fireEvent.keyDown(screen.getByLabelText("Moment 1"), { key: "Enter" });
    fireEvent.change(screen.getByLabelText("Moment 2"), { target: { value: "Gå till Data -> Hämta data" } });

    fireEvent.click(screen.getByText("Skapa rutinen"));
    expect(onSpara).toHaveBeenCalledWith("Ange villkor\n  Nyckelord\n  Datum\nGå till Data -> Hämta data");
  });

  it("öppnar en befintlig rutin i byggaren, och flyttar och tar bort moment", () => {
    const onSpara = vi.fn();
    render(<RutinVy namn={KRAV} text={"Ett\nTvå\n  under två\nTre"} redigerbar onSpara={onSpara} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Redigera"));

    fireEvent.click(screen.getByLabelText("Flytta upp moment 2"));
    fireEvent.click(screen.getByLabelText("Ta bort moment 3"));
    fireEvent.click(screen.getByText("Spara rutinen"));
    // Underpunkten följer sitt moment när det flyttas.
    expect(onSpara).toHaveBeenCalledWith("Två\n  under två\nEtt");
  });

  it("byter mellan bygge och text utan att något skiljer dem åt", () => {
    render(<RutinVy namn={KRAV} redigerbar onSpara={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Klistra in text"));
    fireEvent.change(screen.getByLabelText("Rutinens text"), { target: { value: "Öppna Excel\n  Välj fil" } });
    fireEvent.click(screen.getByText("Bygg"));
    expect((screen.getByLabelText("Moment 1") as HTMLInputElement).value).toBe("Öppna Excel");
    expect((screen.getByLabelText("Underpunkt 1 till moment 1") as HTMLInputElement).value).toBe("Välj fil");
  });
});

describe("rutin ur en uppladdad fil", () => {
  it("lägger AI:ns rutin i utkastet – den sparas först när man trycker", async () => {
    const onSpara = vi.fn();
    const onAiFil = vi.fn(async () => "Logga in\nGå till Data → Hämta data");
    render(<RutinVy namn={KRAV} redigerbar onSpara={onSpara} onClose={vi.fn()} onAiFil={onAiFil} />);

    const fil = new File(["x"], "rutin.docx");
    fireEvent.change(screen.getByLabelText("Fil att skapa rutinen ur"), { target: { files: [fil] } });
    await waitFor(() => expect((screen.getByLabelText("Moment 2") as HTMLInputElement).value).toBe("Gå till Data → Hämta data"));
    expect(onAiFil).toHaveBeenCalledWith(fil, expect.any(AbortSignal));
    expect(onSpara).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Skapa rutinen"));
    expect(onSpara).toHaveBeenCalledWith("Logga in\nGå till Data → Hämta data");
  });

  it("visar felet och låter utkastet stå kvar när AI-vägen misslyckas", async () => {
    const onAiFil = vi.fn(async () => {
      throw new Error("Bryggan svarar inte.");
    });
    render(<RutinVy namn={KRAV} text="Ett moment" redigerbar onSpara={vi.fn()} onClose={vi.fn()} onAiFil={onAiFil} />);
    fireEvent.click(screen.getByText("Redigera"));
    fireEvent.change(screen.getByLabelText("Fil att skapa rutinen ur"), { target: { files: [new File(["x"], "a.pdf")] } });
    await waitFor(() => expect(screen.getByText("Bryggan svarar inte.")).toBeTruthy());
    expect((screen.getByLabelText("Moment 1") as HTMLInputElement).value).toBe("Ett moment");
  });

  it("utan AI-väg finns ingen uppladdningsknapp", () => {
    render(<RutinVy namn={KRAV} redigerbar onSpara={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText("✦ Skapa ur fil")).toBeNull();
  });

  it("tar emot svaret som text eller som moment, och vägrar ett tomt", () => {
    expect(rutinUrSvar({ rutin: "1. Logga in\n- Med adminkontot\n\nKör frågan" })).toBe("Logga in\n  Med adminkontot\nKör frågan");
    expect(rutinUrSvar({ rutin: [{ text: "Logga in", under: ["Med adminkontot"] }, "Kör frågan"] })).toBe(
      "Logga in\n  Med adminkontot\nKör frågan",
    );
    expect(() => rutinUrSvar({ aiText: "fel form" })).toThrow("ingen rutin");
  });
});
