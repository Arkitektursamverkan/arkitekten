import { describe, expect, it } from "vitest";

import { BERGET_MODELL, bergetFråga, tillChat } from "./berget";

/** Ett strömmat svar i OpenAI-formatet, uppdelat mitt i en rad för att pröva hopsättningen. */
function ström(bitar: unknown[], status = 200): Response {
  const text = bitar.map((b) => `data: ${typeof b === "string" ? b : JSON.stringify(b)}\n\n`).join("");
  const mitt = Math.floor(text.length / 2);
  const kod = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(kod.encode(text.slice(0, mitt)));
        c.enqueue(kod.encode(text.slice(mitt)));
        c.close();
      },
    }),
    { status },
  );
}

const bit = (content: string, finish_reason: string | null = null) => ({
  choices: [{ delta: { content }, finish_reason }],
});

function fejk(svar: () => Response) {
  const anrop: { url: string; init: RequestInit; kropp: Record<string, unknown> }[] = [];
  const hämta = (async (url: string, init: RequestInit) => {
    anrop.push({ url, init, kropp: JSON.parse(String(init.body)) });
    return svar();
  }) as unknown as typeof fetch;
  return { anrop, hämta };
}

describe("bergetFråga", () => {
  it("skickar samtalet i OpenAI-formatet med nyckeln och sätter ihop det strömmade svaret", async () => {
    const { anrop, hämta } = fejk(() => ström([bit('{"a"'), bit(":1}", "stop"), "[DONE]"]));
    const fråga = bergetFråga({ apiKey: " nyckel ", fetch: hämta });
    const svar = await fråga({
      system: "Du är noggrann.",
      meddelanden: [{ role: "user", content: "Hej" }],
      schema: { type: "object" },
    });

    expect(svar.text).toBe('{"a":1}');
    expect(svar.innehåll).toEqual([{ type: "text", text: '{"a":1}' }]);
    expect(anrop[0].url).toBe("https://api.berget.ai/v1/chat/completions");
    expect((anrop[0].init.headers as Record<string, string>).authorization).toBe("Bearer nyckel");
    expect(anrop[0].kropp).toMatchObject({
      model: BERGET_MODELL,
      stream: true,
      messages: [
        { role: "system", content: "Du är noggrann." },
        { role: "user", content: "Hej" },
      ],
      response_format: { type: "json_schema", json_schema: { strict: true, schema: { type: "object" } } },
    });
  });

  it("tar modell och adress ur inställningarna, och utan schema skickas inget svarsformat", async () => {
    const { anrop, hämta } = fejk(() => ström([bit("ok", "stop")]));
    await bergetFråga({ apiKey: "k", model: "zai-org/GLM-5.3-Flash", baseUrl: "https://egen.example/v1/", fetch: hämta })({
      system: "s",
      meddelanden: [{ role: "user", content: "x" }],
    });
    expect(anrop[0].url).toBe("https://egen.example/v1/chat/completions");
    expect(anrop[0].kropp.model).toBe("zai-org/GLM-5.3-Flash");
    expect(anrop[0].kropp).not.toHaveProperty("response_format");
  });

  it("tar bort modellens tänkande ur svaret", async () => {
    const { hämta } = fejk(() => ström([bit("<think>hm…</think>\n"), bit("Svaret.", "stop")]));
    const svar = await bergetFråga({ apiKey: "k", fetch: hämta })({ system: "s", meddelanden: [] });
    expect(svar.text).toBe("Svaret.");
  });

  it("översätter felsvaren till svenska – och pekar ut rätt miljövariabel", async () => {
    const med = (status: number) =>
      bergetFråga({
        apiKey: "k",
        fetch: fejk(() => new Response(JSON.stringify({ error: { message: "nej" } }), { status })).hämta,
      })({ system: "s", meddelanden: [] });
    await expect(med(401)).rejects.toThrow("BERGET_API_KEY");
    await expect(med(404)).rejects.toThrow("Modellen hittades inte");
    await expect(med(429)).rejects.toThrow("För många anrop");
    await expect(med(500)).rejects.toThrow("Fel från Berget AI (500): nej");
  });

  it("ett avklippt svar och ett fel mitt i strömmen blir fel, inte ett halvt svar", async () => {
    const klippt = fejk(() => ström([bit("halvt", "length")])).hämta;
    await expect(bergetFråga({ apiKey: "k", fetch: klippt })({ system: "s", meddelanden: [] })).rejects.toThrow(
      "klipptes av",
    );
    const trasig = fejk(() => ström([bit("halvt"), { error: { message: "slut på minne" } }])).hämta;
    await expect(bergetFråga({ apiKey: "k", fetch: trasig })({ system: "s", meddelanden: [] })).rejects.toThrow(
      "slut på minne",
    );
  });

  it("utan nyckel skapas ingen fråga", () => {
    expect(() => bergetFråga({ apiKey: "  " })).toThrow("API-nyckel saknas");
  });
});

describe("tillChat", () => {
  it("gör textdokument till text och bilder till image_url", () => {
    const chat = tillChat("s", [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "text", media_type: "text/plain", data: "Innehållet" }, title: "a.docx" },
          { type: "text", text: "Frågan" },
        ],
      },
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
          { type: "text", text: "Bilden" },
        ],
      },
    ]);
    expect(chat[1]).toEqual({ role: "user", content: 'Dokumentet "a.docx":\nInnehållet\n\nFrågan' });
    expect(chat[2].content).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
      { type: "text", text: "Bilden" },
    ]);
  });

  it("PDF avvisas med ett besked om vad som går i stället", () => {
    expect(() =>
      tillChat("s", [
        {
          role: "user",
          content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "QUJD" } }],
        },
      ]),
    ).toThrow("PDF kan inte läsas med Berget AI");
  });

  it("assistentens tidigare svar följer med som text, tankeblock gör det inte", () => {
    const chat = tillChat("s", [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "…", signature: "x" },
          { type: "text", text: "{}" },
        ],
      },
    ]);
    expect(chat[1]).toEqual({ role: "assistant", content: "{}" });
  });
});
