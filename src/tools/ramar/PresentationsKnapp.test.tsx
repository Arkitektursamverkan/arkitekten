// @vitest-environment happy-dom
/**
 * "Förenkla och presentera": trycket lägger uppdraget i brevlådan, och när
 * svaret kommit går resultatet att öppna – både processen och ramserien.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const begärPresentation = vi.hoisted(() => vi.fn());
vi.mock("./ai-presentation", () => ({ begärPresentation }));
vi.mock("@/core/flow-store", () => ({ getFlowStore: async () => ({}) }));
vi.mock("@/core/ram-store", () => ({ getRamStore: async () => ({}) }));

import { PresentationsKnapp } from "./PresentationsKnapp";

const KÄLLA = () => ({ flödeId: "ap-uthyrning", namn: "Uthyrning", beskrivning: "…", struktur: {} });

afterEach(() => {
  cleanup();
  begärPresentation.mockReset();
});

describe("PresentationsKnapp", () => {
  it("väntar på Claude Code, säger hur man går vidare och kvitterar med två vägar till resultatet", async () => {
    let svara!: (v: unknown) => void;
    begärPresentation.mockReturnValue(new Promise((r) => (svara = r)));
    const onArbetar = vi.fn();
    const onÖppnaFlöde = vi.fn();
    const onÖppnaRamserie = vi.fn();
    render(
      <PresentationsKnapp
        källa={KÄLLA}
        onArbetar={onArbetar}
        onÖppnaFlöde={onÖppnaFlöde}
        onÖppnaRamserie={onÖppnaRamserie}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Förenkla och presentera/ }));
    await waitFor(() => expect(begärPresentation).toHaveBeenCalled());
    expect(begärPresentation.mock.calls[0][0]).toMatchObject({ flödeId: "ap-uthyrning" });
    expect(screen.getByText(/request\.json/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Avbryt" })).toBeTruthy();
    expect(onArbetar).toHaveBeenLastCalledWith(true);

    svara({
      flöde: { id: "ap-uthyrning-presentation", name: "Uthyrning (presentation)" },
      serie: { id: "ramar-uthyrning-presentation", ramar: [{}, {}, {}] },
      anmärkningar: ["Ram 2: struket."],
    });
    await screen.findByText(/3 ramar är sparade/);
    expect(onArbetar).toHaveBeenLastCalledWith(false);
    expect(screen.getByText(/1 anmärkning/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Öppna i Visualisering/ }));
    expect(onÖppnaRamserie).toHaveBeenCalledWith("ramar-uthyrning-presentation");
    fireEvent.click(screen.getByRole("button", { name: /Öppna den förenklade processen/ }));
    expect(onÖppnaFlöde).toHaveBeenCalledWith("ap-uthyrning-presentation");
  });

  it("ett fel visas i klartext och knappen går att trycka på igen", async () => {
    begärPresentation.mockRejectedValue(new Error('Svaret saknar "presentation" med minst en ram.'));
    render(<PresentationsKnapp källa={KÄLLA} />);
    fireEvent.click(screen.getByRole("button", { name: /Förenkla och presentera/ }));
    await screen.findByText(/saknar "presentation"/);
    expect((screen.getByRole("button", { name: /Förenkla och presentera/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("är avstängd medan brevlådan är upptagen av en tolkning", () => {
    render(<PresentationsKnapp källa={KÄLLA} upptagen />);
    expect((screen.getByRole("button", { name: /Förenkla och presentera/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("avmonteras den under väntan avbryts begäran och brevlådan lämnas fri", async () => {
    begärPresentation.mockReturnValue(new Promise(() => {}));
    const onArbetar = vi.fn();
    const { unmount } = render(<PresentationsKnapp källa={KÄLLA} onArbetar={onArbetar} />);
    fireEvent.click(screen.getByRole("button", { name: /Förenkla och presentera/ }));
    await waitFor(() => expect(begärPresentation).toHaveBeenCalled());
    const signal = begärPresentation.mock.calls[0][2] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    expect(onArbetar).toHaveBeenLastCalledWith(false);
  });
});
