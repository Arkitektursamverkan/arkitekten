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
    history.replaceState(null, "", "/?inloggningsfel=AADSTS700025%3A%20Client%20is%20public");
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
});
