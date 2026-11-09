// @vitest-environment happy-dom
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Inloggningsgrind } from "./Inloggning";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("inloggningsgrinden", () => {
  it("REGRESSION: ett misslyckat inloggningsförsök visar felet även i StrictMode – rutan kom annars tillbaka tyst, som en loop", async () => {
    history.replaceState(null, "", "/?inloggningsfel=AADSTS700025");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, läge: "entra", användare: null }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(
      <StrictMode>
        <Inloggningsgrind>
          <p>appen</p>
        </Inloggningsgrind>
      </StrictMode>,
    );
    expect(await screen.findByText(/AADSTS700025/)).toBeTruthy();
    // Felet städas bort ur adressen, så att en omladdning inte visar det igen.
    expect(location.search).toBe("");
  });

  it("REGRESSION: sidan visade vilken text som helst ur ?inloggningsfel= – nu bara en känd kod", async () => {
    history.replaceState(null, "", "/?inloggningsfel=" + encodeURIComponent("Ring supporten på 08-123 45 67"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, läge: "entra", användare: null }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(
      <Inloggningsgrind>
        <p>appen</p>
      </Inloggningsgrind>,
    );
    expect(await screen.findByText(/Inloggningen misslyckades/)).toBeTruthy();
    expect(screen.queryByText(/Ring supporten/)).toBeNull();
  });
});
