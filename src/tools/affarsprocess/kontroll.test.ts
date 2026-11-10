/**
 * Tester för affärsprocesskontrollen (fas 6).
 *
 * Kontrakt: kontrollen pekar ut VAD som brister och VAR (nodId för klick-
 * markering), skiljer varning (regelbrott) från råd, och tiger om det
 * användaren uttryckligen valt (bortvalt ut-objekt).
 */

import { describe, expect, it } from "vitest";
import { compileAp } from "@/core/affarsprocess";
import { emptyDraft, makeLane, type DraftStep, type ProcessDraft } from "@/core/draft";
import type { NodeType } from "@/core/model";
import { granskaAp, sammanfattaKontroll, type ApAnmärkningsId } from "./kontroll";

function steg(id: string, type: NodeType, text: string, extra?: Partial<DraftStep>): DraftStep {
  return { id, type, text, laneId: "Användare", sourceIndex: 0, ...extra };
}

function draftMed(steps: DraftStep[], extra?: Partial<ProcessDraft>): ProcessDraft {
  return { ...emptyDraft(), title: "Test", lanes: [makeLane("Användare", 0)], steps, ...extra };
}

function ids(draft: ProcessDraft): ApAnmärkningsId[] {
  return granskaAp(compileAp(draft), draft).map((a) => a.id);
}

describe("granskaAp", () => {
  it("en komplett aktivitet ger inga anmärkningar", () => {
    const draft = draftMed([
      steg("a1", "activity", "Genomför urval", {
        note: "Urvalet görs kompetensbaserat.",
        ap: { roller: [{ namn: "HR", huki: "U" }] },
      }),
    ]);
    expect(ids(draft)).toEqual([]);
  });

  it("aktivitet utan roll/intressent ger varning med nodId för markering", () => {
    const draft = draftMed([steg("a1", "activity", "Genomför urval", { note: "…" })]);
    const a = granskaAp(compileAp(draft), draft);
    const rollSaknas = a.find((x) => x.id === "roll-saknas");
    expect(rollSaknas?.allvar).toBe("varning");
    expect(rollSaknas?.nodId).toBe("a1");
  });

  it("aktivitet utan beskrivning ger råd; intressent räcker som HUKI", () => {
    const draft = draftMed([
      steg("a1", "activity", "Genomför urval", {
        ap: { intressenter: [{ namn: "Kund", huki: "I" }] },
      }),
    ]);
    expect(ids(draft)).toEqual(["beskrivning-saknas"]);
  });

  it("regel utan frågetecken ger varning", () => {
    const draft = draftMed([
      steg("a1", "activity", "Granska ärende", { note: "…", ap: { roller: [{ namn: "HR" }] } }),
      steg("d1", "decision", "Hög prioritet"),
      steg("a2", "activity", "Eskalera ärende", {
        note: "…",
        branchOf: { stepId: "d1", label: "Ja" },
        ap: { roller: [{ namn: "HR" }] },
      }),
    ]);
    expect(ids(draft)).toContain("regel-utan-fraga");
  });

  it("relation från regel utan svar ger varning", () => {
    // extraEdges ger en omärkt utgång ur regeln – till ett steg som INTE redan
    // har en pil från regeln. (Tidigare pekade den på a3, som redan får
    // regelns omatchade "Nej"-utgång; den handritade pilen var alltså en
    // dubblett längs samma väg, och sådana suppimeras nu vid kompileringen.)
    const draft = draftMed(
      [
        steg("d1", "decision", "Godkänt?"),
        steg("a2", "activity", "Meddela beslut", {
          note: "…",
          branchOf: { stepId: "d1", label: "Ja" },
          ap: { roller: [{ namn: "HR" }] },
        }),
        steg("a3", "activity", "Arkivera ärende", { note: "…", ap: { roller: [{ namn: "HR" }] } }),
        steg("a4", "activity", "Meddela sökande", { note: "…", ap: { roller: [{ namn: "HR" }] } }),
      ],
      { extraEdges: [{ source: "d1", target: "a4" }] },
    );
    const a = granskaAp(compileAp(draft), draft);
    expect(a.some((x) => x.id === "svar-saknas" && x.nodId === "d1")).toBe(true);
  });

  it("bruten förädlingskedja ger råd – men TIGER när ut-objektet valts bort", () => {
    // "Utred" är ett ord → inget auto-VO kan föreslås → aktivitet→aktivitet.
    const grund = [
      steg("a1", "activity", "Utred", { note: "…", ap: { roller: [{ namn: "HR" }] } }),
      steg("a2", "activity", "Fatta beslut", { note: "…", ap: { roller: [{ namn: "Chef" }] } }),
    ];
    expect(ids(draftMed(grund))).toContain("kedja-bruten");
    // Samma kedja men med uttryckligen bortvalt ut-objekt: inget tjat.
    const bortvalt = draftMed([
      { ...grund[0], ap: { ...grund[0].ap, output: null } },
      grund[1],
    ]);
    expect(ids(bortvalt)).not.toContain("kedja-bruten");
  });

  /**
   * REGRESSION: exemplet hade "Genomför urval [In: Ansökningar]" efter
   * "Annonsera tjänst", som redan lämnar ett ut-objekt vidare i kedjan.
   * "Ansökningar" uppstod alltså ur tomma intet – ingenting pekade på det –
   * och kontrollen sa ingenting ("Men ansökningar bara uppstår från
   * tomma intet?"). Nu ges ett råd, men bara när aktiviteten REDAN får ett
   * objekt ur kedjan.
   */
  it("REGRESSION: ett andra in-objekt utan ursprung ger råd", () => {
    const draft = draftMed([
      steg("a1", "activity", "Annonsera tjänst", { note: "…", ap: { roller: [{ namn: "HR" }] } }),
      steg("a2", "activity", "Genomför urval", {
        note: "…",
        ap: { roller: [{ namn: "HR" }], input: "Ansökningar" },
      }),
    ]);
    const a = granskaAp(compileAp(draft), draft);
    const rådet = a.find((x) => x.id === "objekt-utan-ursprung");
    expect(rådet?.allvar).toBe("info");
    expect(rådet?.nodId).toBe("vo_in_a2"); // klick markerar objektet
    expect(rådet?.text).toContain("Ansökningar");
  });

  it("processens INGÅNG är inget fel – där tiger kontrollen", () => {
    // Första objektet i kedjan har alltid noll inkommande kopplingar, och ett
    // in-objekt till en aktivitet som inte får något annat är ett medvetet
    // "kommer utifrån".
    const start = draftMed([
      steg("s0", "start", "Behov uppstår"),
      steg("a1", "activity", "Genomför urval", { note: "…", ap: { roller: [{ namn: "HR" }] } }),
    ]);
    expect(ids(start)).not.toContain("objekt-utan-ursprung");

    const utifrån = draftMed([
      steg("a1", "activity", "Registrera handling", {
        note: "…",
        ap: { roller: [{ namn: "HR" }], input: "Handling från Lantmäteriet" },
      }),
    ]);
    expect(ids(utifrån)).not.toContain("objekt-utan-ursprung");
  });

  it("enordsaktivitet får rådet verb + substantiv", () => {
    const draft = draftMed([
      steg("a1", "activity", "Utred", { note: "…", ap: { roller: [{ namn: "HR" }], output: null } }),
    ]);
    expect(ids(draft)).toContain("namn-utan-objekt");
  });
});

describe("sammanfattaKontroll", () => {
  it("skiljer varningar från råd", () => {
    expect(sammanfattaKontroll([])).toBe("Affärsprocesskontroll: OK");
    expect(
      sammanfattaKontroll([
        { id: "roll-saknas", nodId: "a", text: "", allvar: "varning" },
        { id: "beskrivning-saknas", nodId: "a", text: "", allvar: "info" },
        { id: "beskrivning-saknas", nodId: "b", text: "", allvar: "info" },
      ]),
    ).toBe("Affärsprocesskontroll: 1 varning · 2 råd");
  });
});

describe("föreslåOutput – passiv form (upptäckt under fas 6)", () => {
  it("REGRESSION: passiva stegnamn läste subjektet som verb", async () => {
    const { föreslåOutput } = await import("@/core/affarsprocess");
    // Tidigare: "Skickas till användaren mejlbekräftelsed" – rent nonsens.
    expect(föreslåOutput("Mejlbekräftelse skickas till användaren")).toBe(
      "Mejlbekräftelse skickad",
    );
    expect(föreslåOutput("Loggpost skapas")).toBe("Loggpost skapad");
    expect(föreslåOutput("Handläggare utses automatiskt")).toBe("Handläggare utsedd");
    // Imperativformerna påverkas inte.
    expect(föreslåOutput("Genomför urval")).toBe("Urval genomfört");
  });
});

describe("forum i kedjan", () => {
  const MÖTE = (note?: string) =>
    draftMed([
      steg("s1", "activity", "Förbered möte", {
        ap: { roller: [{ namn: "Avdelningschef", huki: "U" }] },
        note: "x",
      }),
      steg("s2", "activity", "Fatta beslut", {
        ap: { roller: [{ namn: "Avdelningschef", huki: "U" }], iMötesform: true },
        note,
      }),
    ]);

  it("REGRESSION: ett [Forum]-steg ritas som forum och får sitt objekt i kedjan, som en aktivitet", () => {
    const model = compileAp(MÖTE("Sker i ledningsgruppen."));
    expect(model.nodes.find((n) => n.id === "s2")?.kind).toBe("forum");
    // Mellan aktiviteten och forumet sprängs förädlingsobjektet in.
    expect(model.nodes.some((n) => n.id === "vo_s1")).toBe(true);
    expect(model.relations.some((r) => r.source === "vo_s1" && r.target === "s2")).toBe(true);
  });

  it("forumet kräver beskrivning, precis som aktiviteten", () => {
    expect(ids(MÖTE())).toContain("beskrivning-saknas");
    expect(granskaAp(compileAp(MÖTE()), MÖTE()).find((a) => a.nodId === "s2")?.text).toContain("Forumet");
    expect(ids(MÖTE("Sker i gruppen."))).not.toContain("beskrivning-saknas");
  });
});
