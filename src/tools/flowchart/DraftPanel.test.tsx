// @vitest-environment happy-dom
/**
 * Komponenttest för mellanlagrets dra-och-släpp.
 *
 * Varför ett riktigt DOM-test: flyttlogiken (moveStepTo) är enhetstestad, men
 * det säger ingenting om att GREPPET fungerar – att pekarhändelserna är kopplade,
 * att rätt rad räknas ut ur muspositionen och att släppet faktiskt landar i
 * onChange. Det var precis den luckan som gjorde att första försöket (HTML5
 * drag-and-drop) inte fungerade trots gröna enhetstester.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DraftPanel } from "./DraftPanel";
import { normalizeOrder, type ProcessDraft } from "@/core/draft";
import { textToDraft } from "./parser/toDraft";

const TEXT = `Felanmälan ny
Fel uppkommer → Startar Portalen → Fyller i formulär → Power Automate flödet triggas (↓ Om klassificering = Hög prioritet → Teamschatt skapas) → Mejl skickas till handläggaren`;

const ROW_HEIGHT = 40;

/**
 * happy-dom räknar inte ut layout – alla element rapporterar 0×0. Vi lägger därför
 * ut raderna i en fejkad, jämn kolumn så att musposition → radindex blir
 * meningsfullt. Rad i upptar y = i*40 … i*40+40.
 */
function stubLayout() {
  const rows = document.querySelectorAll<HTMLElement>(".ark-draft-row");
  rows.forEach((row, i) => {
    row.getBoundingClientRect = () =>
      ({
        top: i * ROW_HEIGHT,
        bottom: (i + 1) * ROW_HEIGHT,
        height: ROW_HEIGHT,
        left: 0,
        right: 500,
        width: 500,
        x: 0,
        y: i * ROW_HEIGHT,
        toJSON: () => ({}),
      }) as DOMRect;
  });
  return rows;
}

/** y-koordinat i övre respektive nedre halvan av rad i. */
const övreHalvan = (i: number) => i * ROW_HEIGHT + 5;
const nedreHalvan = (i: number) => i * ROW_HEIGHT + ROW_HEIGHT - 5;

/** Drar handtaget på rad `från` till y-koordinaten `till`. */
function dra(handtag: HTMLElement, till: number) {
  fireEvent.pointerDown(handtag, { clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(handtag, { clientY: till, pointerId: 1 });
  fireEvent.pointerUp(handtag, { clientY: till, pointerId: 1 });
}

describe("DraftPanel – dra och släpp", () => {
  let draft: ProcessDraft;
  let onChange: Mock<(draft: ProcessDraft) => void>;

  beforeEach(() => {
    draft = normalizeOrder(textToDraft(TEXT));
    onChange = vi.fn();
    // happy-dom saknar pointer capture – stubba så anropet inte kastar.
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  // Vitest kör utan globals, så Testing Librarys automatiska cleanup
  // registreras aldrig. Utan detta ligger föregående tests DOM kvar och
  // getAllBy* plockar handtag ur en avmonterad komponent.
  afterEach(cleanup);

  const rita = () =>
    render(<DraftPanel draft={draft} onChange={onChange} onClose={() => {}} />);

  it("visar ett dragghandtag per steg", () => {
    rita();
    const handtag = screen.getAllByLabelText("Dra för att flytta steget");
    expect(handtag).toHaveLength(draft.steps.length);
  });

  it("flyttar ett steg uppåt när man drar det", () => {
    rita();
    stubLayout();
    const handtag = screen.getAllByLabelText("Dra för att flytta steget");

    // Dra sista steget till översta radens övre halva → det ska hamna först.
    dra(handtag[handtag.length - 1], övreHalvan(0));

    expect(onChange).toHaveBeenCalledTimes(1); // ett släpp = en flytt
    const resultat: ProcessDraft = onChange.mock.calls[0][0];
    expect(resultat.steps[0].id).toBe(draft.steps[draft.steps.length - 1].id);
  });

  it("flyttar ett steg nedåt när man drar det", () => {
    rita();
    stubLayout();
    const handtag = screen.getAllByLabelText("Dra för att flytta steget");

    // Dra första steget till nedre halvan av rad 2 → hamnar efter det steget.
    dra(handtag[0], nedreHalvan(2));

    const resultat: ProcessDraft = onChange.mock.calls[0][0];
    expect(resultat.steps.findIndex((s) => s.id === draft.steps[0].id)).toBe(2);
  });

  it("släpper man i en gren blir steget en del av grenen", () => {
    rita();
    stubLayout();
    const grenIdx = draft.steps.findIndex((s) => s.branchOf);
    const beslut = draft.steps[grenIdx].branchOf!.stepId;
    const handtag = screen.getAllByLabelText("Dra för att flytta steget");

    // Dra ett tidigt huvudflödessteg till nedre halvan av grensteget.
    dra(handtag[1], nedreHalvan(grenIdx));

    const resultat: ProcessDraft = onChange.mock.calls[0][0];
    const flyttat = resultat.steps.find((s) => s.id === draft.steps[1].id)!;
    expect(flyttat.branchOf).toEqual({ stepId: beslut, label: "Ja" });
  });

  it("visar en släppindikator medan man drar, och inget innan", () => {
    const { container } = rita();
    stubLayout();
    expect(container.querySelectorAll(".drop-before, .drop-after")).toHaveLength(0);

    const handtag = screen.getAllByLabelText("Dra för att flytta steget");
    fireEvent.pointerDown(handtag[3], { clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handtag[3], { clientY: övreHalvan(1), pointerId: 1 });

    expect(container.querySelectorAll(".drop-before, .drop-after").length).toBeGreaterThan(0);
    expect(container.querySelector(".ark-draft-row.dragging")).not.toBeNull();
  });

  it("gör ingenting när man släpper på samma plats", () => {
    rita();
    stubLayout();
    const handtag = screen.getAllByLabelText("Dra för att flytta steget");

    dra(handtag[2], övreHalvan(2));

    // Ingen förändring => ingen rapportering uppåt.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("går fortfarande att skriva i textfälten (dragget kapar dem inte)", () => {
    rita();
    const fält = screen.getAllByPlaceholderText("Beskrivning av steget")[0] as HTMLInputElement;
    fireEvent.change(fält, { target: { value: "Ny text" } });

    const resultat: ProcessDraft = onChange.mock.calls[0][0];
    expect(resultat.steps[0].text).toBe("Ny text");
  });
});
