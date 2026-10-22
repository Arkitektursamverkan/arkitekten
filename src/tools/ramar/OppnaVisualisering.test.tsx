// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ÖppnaVisualisering } from "./OppnaVisualisering";

afterEach(cleanup);

const serie = (id: string, flödeId: string) => ({ id, namn: `Serie ${id}`, flödeId, savedAt: "", antalRamar: 4 });

describe("Öppna i Visualisering", () => {
  it("syns bara när en visualisering bygger på den öppna processen", () => {
    render(<ÖppnaVisualisering flowId="ap-x" serier={[serie("a", "ap-annan")]} onÖppna={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Öppna i Visualisering/ })).toBeNull();
  });

  it("öppnar den enda visualiseringen direkt", () => {
    const onÖppna = vi.fn();
    render(<ÖppnaVisualisering flowId="ap-x" serier={[serie("a", "ap-x")]} onÖppna={onÖppna} />);
    fireEvent.click(screen.getByRole("button", { name: /Öppna i Visualisering/ }));
    expect(onÖppna).toHaveBeenCalledWith("a");
  });

  it("låter en välja när det finns flera", () => {
    const onÖppna = vi.fn();
    render(
      <ÖppnaVisualisering flowId="ap-x" serier={[serie("a", "ap-x"), serie("b", "ap-x")]} onÖppna={onÖppna} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Öppna i Visualisering/ }));
    fireEvent.click(screen.getByRole("button", { name: /Serie b/ }));
    expect(onÖppna).toHaveBeenCalledWith("b");
  });
});
