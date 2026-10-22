// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { godkännKostnad, type KostnadsSvar } from "@/tools/flowchart/ai/kostnad";
import { KostnadsDialog } from "./KostnadsDialog";

/** Serverns utvecklarläge, som /__ark/status rapporterar det. */
const läge = vi.hoisted(() => ({ claudeCode: true }));
vi.mock("@/tools/flowchart/ai/bridge", async (orig) => ({
  ...(await orig<typeof import("@/tools/flowchart/ai/bridge")>()),
  claudeCodeErbjuds: () => läge.claudeCode,
}));

afterEach(() => {
  cleanup();
  läge.claudeCode = true;
});

it("rutan säger att funktionen kostar, med beloppet, och Godkänn kör med API:t", async () => {
  render(<KostnadsDialog />);
  let svar!: Promise<KostnadsSvar>;
  act(() => {
    svar = godkännKostnad("tolkning");
  });
  expect(await screen.findByText(/förknippad med en kostnad/)).toBeTruthy();
  expect(screen.getByText("ca 1 kr")).toBeTruthy();
  fireEvent.click(screen.getByText("Godkänn och kör"));
  expect(await svar).toBe("api");
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("Avbryt och Escape avböjer", async () => {
  render(<KostnadsDialog />);
  let svar!: Promise<KostnadsSvar>;
  act(() => {
    svar = godkännKostnad("presentation");
  });
  expect(await screen.findByText("ca 3 kr")).toBeTruthy();
  fireEvent.click(screen.getByText("Avbryt"));
  expect(await svar).toBeNull();

  act(() => {
    svar = godkännKostnad("presentation");
  });
  await screen.findByRole("alertdialog");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(await svar).toBeNull();
});

it("i utvecklarläget går Claude Code att välja i stället, med notisen om läget", async () => {
  render(<KostnadsDialog />);
  let svar!: Promise<KostnadsSvar>;
  act(() => {
    svar = godkännKostnad("tolkning");
  });
  expect(await screen.findByText(/bara i serverns utvecklarläge/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Skicka till Claude Code" }));
  expect(await svar).toBe("claude-code");
});

it("utan utvecklarläget erbjuds Claude Code inte – ingen läser brevlådan", async () => {
  läge.claudeCode = false;
  render(<KostnadsDialog />);
  let svar!: Promise<KostnadsSvar>;
  act(() => {
    svar = godkännKostnad("tolkning");
  });
  await screen.findByRole("alertdialog");
  expect(screen.queryByRole("button", { name: "Skicka till Claude Code" })).toBeNull();
  expect(screen.queryByText(/utvecklarläge/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Godkänn och kör" }));
  expect(await svar).toBe("api");
});
