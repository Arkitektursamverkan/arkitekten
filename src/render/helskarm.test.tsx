// @vitest-environment happy-dom
/**
 * Helskärmen (visningsläget): öppnas av knappen, stängs med Esc och när
 * webbläsarens helskärm lämnas – men en ANNAN vys helskärm rörs aldrig.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useHelskärm } from "./helskarm";

afterEach(cleanup);

function Vy() {
  const h = useHelskärm();
  return (
    <div ref={h.ref} data-testid="yta" className={h.aktiv ? "ark-helskarm" : ""}>
      <button onClick={h.öppna}>Öppna</button>
      <span data-testid="byte">{h.byte}</span>
    </div>
  );
}

describe("useHelskärm", () => {
  it("öppnar, begär webbläsarens helskärm och stängs med Esc", () => {
    const begär = vi.fn(() => Promise.resolve());
    HTMLElement.prototype.requestFullscreen = begär;
    render(<Vy />);
    fireEvent.click(screen.getByText("Öppna"));
    expect(screen.getByTestId("yta").className).toBe("ark-helskarm");
    expect(begär).toHaveBeenCalled();
    expect(screen.getByTestId("byte").textContent).toBe("1");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("yta").className).toBe("");
    expect(screen.getByTestId("byte").textContent).toBe("2");
  });

  it("fyller fönstret även när webbläsaren nekar helskärm", async () => {
    HTMLElement.prototype.requestFullscreen = vi.fn(() => Promise.reject(new Error("nekad")));
    render(<Vy />);
    fireEvent.click(screen.getByText("Öppna"));
    await act(async () => {
      await Promise.resolve();
    });
    // Ingen helskärm att lämna – en fullscreenchange från någon annan stänger inte.
    fireEvent(document, new Event("fullscreenchange"));
    expect(screen.getByTestId("yta").className).toBe("ark-helskarm");
  });
});
