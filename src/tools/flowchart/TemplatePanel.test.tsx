// @vitest-environment happy-dom
/**
 * Mallen frågar inte efter det man redan sagt.
 */

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TemplatePanel } from "./TemplatePanel";

afterEach(cleanup);

it("REGRESSION: mallen frågade efter flödets namn fast det just angetts i Ny process – nu ställs frågan inte, och namnet följer med", () => {
  const onApply = vi.fn();
  render(<TemplatePanel namn="Ny rutin" onClose={() => {}} onApply={onApply} />);
  expect(screen.queryByText(/Vad heter flödet/)).toBeNull();
  expect(screen.queryByPlaceholderText("T.ex. Reklamation")).toBeNull();
  // Stegen numreras om: "Vilka är med?" är första frågan.
  expect(screen.getByText(/Vilka är med/).textContent).toMatch(/^1/);

  // Också det ifyllda exemplet behåller processens namn.
  fireEvent.click(screen.getByRole("button", { name: /Visa ett ifyllt exempel/ }));
  expect(screen.queryByText("Ge flödet en titel.")).toBeNull();
});

it("utan namn ställs frågan som förut", () => {
  render(<TemplatePanel onClose={() => {}} onApply={() => {}} />);
  expect((screen.getByPlaceholderText("T.ex. Reklamation") as HTMLInputElement).value).toBe("");
  expect(screen.getByText(/Vilka är med/).textContent).toMatch(/^2/);
});

it("REGRESSION: en ifylld mall gick inte att fortsätta på – panelen börjar nu med flödets rader", () => {
  const mall = {
    titel: "Innovation",
    underrubrik: "",
    banor: ["Användare", "Chef"],
    rader: [{ id: "r1", text: "Jag har en idé", bana: "Användare", typ: "start" as const }],
  };
  render(<TemplatePanel namn="Innovation" mall={mall} onClose={() => {}} onApply={() => {}} />);
  expect(screen.getByDisplayValue("Jag har en idé")).toBeTruthy();
  expect(screen.getByDisplayValue("Chef")).toBeTruthy();
});
