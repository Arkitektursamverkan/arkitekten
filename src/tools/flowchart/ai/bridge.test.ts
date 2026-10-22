/**
 * Ark-bryggans begäran.
 *
 * Bakgrund: verktyget Affärsprocess och flödesschemat delar brevlåda. Begäran bar
 * ingenting som skilde dem åt, så Claude Code svarade alltid i flödesschemats
 * form – även när användaren stod i "Affärsprocess".
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { requestClaudeCodeDraft, requestClaudeCodeUppdrag } from "./bridge";
import { AVBÖJT, registreraKostnadsfråga, type Kostnad } from "./kostnad";
import { AP_SYSTEM_PROMPT } from "./prompt";

/** Bryggan i miniatyr: POST kvitteras, GET svarar direkt med en tolkning. */
function fejkaBryggan(svar: unknown) {
  const skickat: unknown[] = [];
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/__ark/request") {
        skickat.push(JSON.parse(String(init?.body ?? "{}")));
        return json({ ok: true, id: "req_test" });
      }
      return json({ response: svar });
    }),
  );
  return skickat;
}

const SVAR = { aiText: "P\nA → B" };

afterEach(() => vi.unstubAllGlobals());

describe("requestClaudeCodeDraft", () => {
  it("REGRESSION: en affärsprocessbegäran bär diagramtypen OCH metodens regler", async () => {
    const skickat = fejkaBryggan(SVAR);
    await requestClaudeCodeDraft({ rawText: "Håll föredrag", diagramType: "affarsprocess" });

    const begäran = skickat[0] as { diagramType: string; instruction: string };
    expect(begäran.diagramType).toBe("affarsprocess");
    expect(begäran.instruction).toContain(AP_SYSTEM_PROMPT);
  });

  it("flödesschemat skickar tom instruktion som förr", async () => {
    const skickat = fejkaBryggan(SVAR);
    await requestClaudeCodeDraft({ rawText: "Håll föredrag" });

    const begäran = skickat[0] as { diagramType: string; instruction: string };
    expect(begäran.diagramType).toBe("flowchart");
    expect(begäran.instruction).toBe("");
  });

  it("användarens eget önskemål ligger sist och överröstar husreglerna", async () => {
    const skickat = fejkaBryggan(SVAR);
    await requestClaudeCodeDraft({
      rawText: "Håll föredrag",
      diagramType: "affarsprocess",
      instruction: "Slå ihop stegen i portalen",
    });

    const instruction = (skickat[0] as { instruction: string }).instruction;
    expect(instruction.indexOf("Slå ihop stegen i portalen")).toBeGreaterThan(
      instruction.indexOf('verktyget "Affärsprocess"'),
    );
  });
});

describe("requestClaudeCodeUppdrag", () => {
  it("begäran märks med uppdraget och källan, och svaret lämnas orört", async () => {
    const svar = { förenklad: { aiText: "P\nA → B" }, presentation: { ramar: [] } };
    const skickat = fejkaBryggan(svar);
    const fick = await requestClaudeCodeUppdrag({
      uppdrag: "presentation",
      payload: "{}",
      instruction: "Förenkla",
      källa: { flödeId: "ap-p", namn: "P" },
      diagramType: "affarsprocess",
    });

    expect(skickat[0]).toMatchObject({
      uppdrag: "presentation",
      diagramType: "affarsprocess",
      källa: { flödeId: "ap-p", namn: "P" },
    });
    expect(fick).toEqual(svar);
  });
});

describe("serverns felsvar", () => {
  it("REGRESSION-skydd: ett { fel } från serverns API-anrop blir ett fel i appen, inte en tom tolkning", async () => {
    fejkaBryggan({ requestId: "req_test", fel: "Ogiltig API-nyckel – kontrollera ANTHROPIC_API_KEY i serverns miljö." });
    await expect(requestClaudeCodeDraft({ rawText: "P\nA → B" })).rejects.toThrow(/Ogiltig API-nyckel/);
  });

  it("önskemålet skickas också för sig, så att API-vägen slipper husreglerna i instruktionen", async () => {
    const skickat = fejkaBryggan(SVAR);
    await requestClaudeCodeDraft({ rawText: "P\nA → B", instruction: "Slå ihop stegen", diagramType: "affarsprocess" });
    expect(skickat[0]).toMatchObject({ önskemål: "Slå ihop stegen" });
  });
});

describe("kostnaden godkänns innan ett betalt anrop", () => {
  /** Servern har API-nyckeln: status säger "api". */
  function betaldBrygga(svar: unknown) {
    const skickat = fejkaBryggan(svar);
    const vanlig = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        url === "/__ark/status"
          ? new Response(JSON.stringify({ ok: true, besvaras: "api" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          : vanlig(url, init),
      ),
    );
    return skickat;
  }

  it("avböjer man skickas ingen begäran alls", async () => {
    const skickat = betaldBrygga(SVAR);
    const frågor: Kostnad[] = [];
    const av = registreraKostnadsfråga(async (k) => (frågor.push(k), null));
    try {
      await expect(requestClaudeCodeDraft({ rawText: "P\nA → B" })).rejects.toThrow(AVBÖJT);
    } finally {
      av();
    }
    expect(skickat).toHaveLength(0);
    expect(frågor[0].belopp).toBe("ca 1 kr");
  });

  it("presentationen anges till ca 3 kr, och godkänner man går begäran iväg", async () => {
    const skickat = betaldBrygga({ förenklad: {} });
    const frågor: Kostnad[] = [];
    const av = registreraKostnadsfråga(async (k) => (frågor.push(k), "api"));
    try {
      await requestClaudeCodeUppdrag({ uppdrag: "presentation", payload: "{}", instruction: "" });
    } finally {
      av();
    }
    expect(frågor[0].belopp).toBe("ca 3 kr");
    expect(skickat).toHaveLength(1);
    expect(skickat[0]).toMatchObject({ via: "api" });
  });

  it("svarar Claude Code (ingen nyckel) kostar det ingenting och ingen fråga ställs", async () => {
    const skickat = fejkaBryggan(SVAR);
    const fråga = vi.fn(async () => null);
    const av = registreraKostnadsfråga(fråga);
    try {
      await requestClaudeCodeDraft({ rawText: "P\nA → B" });
    } finally {
      av();
    }
    expect(fråga).not.toHaveBeenCalled();
    expect(skickat).toHaveLength(1);
  });

  it("väljer man Claude Code i rutan märks begäran så att servern inte anropar API:t", async () => {
    const skickat = betaldBrygga(SVAR);
    const av = registreraKostnadsfråga(async () => "claude-code");
    try {
      await requestClaudeCodeDraft({ rawText: "P\nA → B" });
    } finally {
      av();
    }
    expect(skickat).toHaveLength(1);
    expect(skickat[0]).toMatchObject({ via: "claude-code" });
  });
});
