// @vitest-environment happy-dom
/**
 * Flytten ska gå att nå DÄR MAN STÅR.
 *
 * Knappen på katalogens kort fanns, men den som står i den öppna processen såg
 * den inte – och hittade därmed ingen väg alls (synpunkt 2026-09-07).
 * Processens huvud har därför samma knapp och samma dialog.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FlowSummary } from "@/core/flow-store";
import { FlyttaKnapp } from "./FlyttaKnapp";
import { AnvändarKontext } from "./Inloggning";

const FLÖDEN: FlowSummary[] = [
  {
    id: "ap-arkiv",
    name: "Arkivering av ritningar",
    savedAt: "2026-09-01T09:00:00.000Z",
    stepCount: 6,
    versionCount: 2,
    status: "utkast",
    beteckning: "0.2",
    category: "Demo",
    subcategory: "Utbildning",
  },
];

afterEach(cleanup);

describe("Flytta i katalogen, från processens huvud", () => {
  it("öppnar dialogen och rapporterar den nya placeringen", async () => {
    const onFlytta = vi.fn().mockResolvedValue(undefined);
    render(<FlyttaKnapp flowId="ap-arkiv" flöden={FLÖDEN} onFlytta={onFlytta} />);

    fireEvent.click(screen.getByRole("button", { name: /Flytta i katalogen/ }));
    // Dialogen säger var processen ligger NU – annars vågar man inte flytta.
    expect(screen.getByText(/Ligger nu i/).textContent).toContain("Demo");

    fireEvent.change(screen.getByLabelText("Kategori i katalogen"), {
      target: { value: "__ny__" },
    });
    fireEvent.change(screen.getByLabelText("Namn på den nya kategorin"), {
      target: { value: "Systemförvaltning" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Flytta" }));

    expect(onFlytta).toHaveBeenCalledWith(
      "ap-arkiv",
      { category: "Systemförvaltning", subcategory: "Utbildning" },
      undefined, // samma yta – ingen flytt mellan ytor
    );
  });

  it("finns inte för en process som ännu inte sparats", () => {
    // Flytten skriver placeringen på en post i biblioteket. Finns ingen post
    // finns inget att flytta – och en knapp som inte kan göra något är värre
    // än ingen knapp alls.
    const { container } = render(
      <FlyttaKnapp flowId={null} flöden={FLÖDEN} onFlytta={vi.fn()} />,
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("finns inte heller för ett id som saknas i biblioteket", () => {
    const { container } = render(
      <FlyttaKnapp flowId="finns-inte" flöden={FLÖDEN} onFlytta={vi.fn()} />,
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("Flytta mellan ytor", () => {
  it("ägaren flyttar sin egen process till den gemensamma katalogen", () => {
    const testa = { id: "test", namn: "Test Testsson", roller: ["user" as const] };
    const egen: FlowSummary = {
      id: "ap-mitt",
      name: "Mitt",
      savedAt: "2026-10-14T10:00:00Z",
      stepCount: 2,
      versionCount: 1,
      category: "Utkast",
      ägare: { id: "test", namn: "Test Testsson" },
    };
    const gemensam: FlowSummary = { ...egen, id: "ap-delad", name: "Delad", category: "Affärsprocesser", ägare: undefined };
    const onFlytta = vi.fn();
    render(
      <AnvändarKontext användare={testa} läge="entra">
        <FlyttaKnapp flowId="ap-mitt" flöden={[egen, gemensam]} onFlytta={onFlytta} />
      </AnvändarKontext>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Flytta i katalogen/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Gemensam katalog/ }));
    fireEvent.change(screen.getByLabelText("Kategori i katalogen"), { target: { value: "Affärsprocesser" } });
    fireEvent.click(screen.getByRole("button", { name: "Flytta till gemensam katalog" }));
    expect(onFlytta).toHaveBeenCalledWith(
      "ap-mitt",
      { category: "Affärsprocesser", subcategory: "" },
      "gemensam",
    );
  });

  it("en användare får ingen flyttknapp i den gemensamma katalogen", () => {
    const prova = { id: "prov", namn: "Prov Provsson", roller: ["user" as const] };
    const gemensam: FlowSummary = {
      id: "ap-delad",
      name: "Delad",
      savedAt: "2026-10-14T10:00:00Z",
      stepCount: 2,
      versionCount: 1,
      category: "Affärsprocesser",
    };
    render(
      <AnvändarKontext användare={prova} läge="entra">
        <FlyttaKnapp flowId="ap-delad" flöden={[gemensam]} onFlytta={vi.fn()} />
      </AnvändarKontext>,
    );
    expect(screen.queryByRole("button", { name: /Flytta i katalogen/ })).toBeNull();
  });
});
