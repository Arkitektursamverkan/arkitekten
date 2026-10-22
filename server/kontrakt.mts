/**
 * Kontraktsexemplet (docs/gransnitt.md): flödestjänstens svar för en känd
 * uppsättning flöden, hämtat genom tjänstens egen hanterare – aldrig
 * återskapat för hand.
 */

import http from "node:http";
import { KONTRAKT, skapaHanterare } from "./flodestjanst.mjs";

export async function kontraktsexempel(flowsDir: string) {
  // Ingen stilkatalog: exemplet ritas i standardstilen, vad installationen än valt.
  const server = http.createServer(skapaHanterare(flowsDir, "/finns-inte"));
  await new Promise<void>((klar) => server.listen(0, "127.0.0.1", klar));
  const bas = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const lista = await (await fetch(`${bas}/api/flows`)).json();
    const scener: Record<string, unknown> = {};
    for (const f of lista.flows) scener[f.id] = await (await fetch(`${bas}/api/flows/${f.id}/scen`)).json();
    return { kontrakt: KONTRAKT, "/api/flows": lista, "/api/flows/{id}/scen": scener };
  } finally {
    await new Promise<void>((klar) => server.close(() => klar()));
  }
}
