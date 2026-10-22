// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KopieraLänk, helLänk } from "./KopieraLank";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("länken är appens adress plus processens id", () => {
  expect(helLänk("bestallning-forandring")).toBe(
    location.origin + location.pathname + "#/process/bestallning-forandring",
  );
});

it("kopierar länken och kvitterar", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.stubGlobal("isSecureContext", true);
  render(<KopieraLänk flowId="bestallning-forandring" />);

  fireEvent.click(screen.getByText("Kopiera länk"));
  await waitFor(() => expect(screen.getByText("Länken kopierad")).toBeTruthy());
  expect(writeText).toHaveBeenCalledWith(helLänk("bestallning-forandring"));
});

/**
 * Appen nås oftast på en vanlig http-adress, där `navigator.clipboard` inte
 * finns. Knappen får inte vara död där – det är just där den används.
 */
it("kopierar även utan säker kontext, genom reservvägen", async () => {
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("isSecureContext", false);
  const exec = vi.fn(() => true);
  (document as unknown as { execCommand: unknown }).execCommand = exec;
  render(<KopieraLänk flowId="bestallning-forandring" />);

  fireEvent.click(screen.getByText("Kopiera länk"));
  await waitFor(() => expect(screen.getByText("Länken kopierad")).toBeTruthy());
  expect(exec).toHaveBeenCalledWith("copy");
});

it("en osparad process har ingen länk att kopiera", () => {
  render(<KopieraLänk flowId={null} />);
  expect(screen.queryByText("Kopiera länk")).toBeNull();
});
