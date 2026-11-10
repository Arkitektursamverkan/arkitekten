/**
 * Full kontroll över kopplingarna: ta bort vilken som helst, dra nya.
 *
 * Kanterna räknas fram ur stegens ordning, så en härledd koppling kan inte
 * "raderas" – den undertrycks. En manuellt dragen finns däremot på riktigt och
 * försvinner när den tas bort. De två fallen får inte blandas ihop, för då
 * går en borttagen egen koppling inte att dra igen.
 */

import { describe, expect, it } from "vitest";
import { addManualEdge, compileDraft, removeEdge, restoreEdge } from "./draft";
import { textToDraft } from "@/tools/flowchart/parser/toDraft";

const TEXT = `Test
A startar → B i portalen → Driftfråga inkommer i SP-listan Inkorgen → Power Automate flödet triggas → Mejl skickas till handläggaren → C avslutar`;

const utkast = textToDraft(TEXT);
const bas = compileDraft(utkast);

const nod = (m: ReturnType<typeof compileDraft>, del: string) =>
  m.nodes.find((n) => n.label.toLowerCase().includes(del))!;

describe("ta bort kopplingar", () => {
  it("ett sekvensflöde går att ta bort och ta tillbaka", () => {
    const e = bas.edges[0];
    const utan = compileDraft(removeEdge(utkast, e.source, e.target));
    expect(utan.edges.some((x) => x.source === e.source && x.target === e.target)).toBe(false);
    const åter = compileDraft(restoreEdge(removeEdge(utkast, e.source, e.target), e.source, e.target));
    expect(åter.edges.some((x) => x.source === e.source && x.target === e.target)).toBe(true);
  });

  it("REGRESSION: en dataassociation går att ta bort", () => {
    // Streckade kopplingar var helt inerta – varken valbara eller borttagbara.
    const a = bas.dataAssociations[0];
    expect(a, "testflödet saknar dataassociation").toBeDefined();
    const nyckel =
      a.direction === "write" ? [a.nodeId, a.dataStoreId] : [a.dataStoreId, a.nodeId];
    const utan = compileDraft(removeEdge(utkast, nyckel[0], nyckel[1]));
    expect(utan.dataAssociations.some((x) => x.id === a.id)).toBe(false);
    expect(utan.dataAssociations.length).toBe(bas.dataAssociations.length - 1);
  });

  it("REGRESSION: ett meddelandeflöde går att ta bort", () => {
    const f = bas.messageFlows[0];
    expect(f, "testflödet saknar meddelandeflöde").toBeDefined();
    const utan = compileDraft(removeEdge(utkast, f.nodeId, f.poolId));
    expect(utan.messageFlows.some((x) => x.id === f.id)).toBe(false);
  });

  it("att ta bort en koppling rör inte de andra", () => {
    const e = bas.edges[0];
    const utan = compileDraft(removeEdge(utkast, e.source, e.target));
    expect(utan.edges.length).toBe(bas.edges.length - 1);
    expect(utan.dataAssociations.length).toBe(bas.dataAssociations.length);
    expect(utan.messageFlows.length).toBe(bas.messageFlows.length);
  });
});

describe("dra nya kopplingar", () => {
  it("mellan två aktiviteter blir det ett sekvensflöde", () => {
    const a = nod(bas, "a startar");
    const c = nod(bas, "c avslutar");
    const m = compileDraft(addManualEdge(utkast, a.id, c.id));
    expect(m.edges.some((e) => e.source === a.id && e.target === c.id)).toBe(true);
    expect(m.dataAssociations.length).toBe(bas.dataAssociations.length);
  });

  it("till ett datalager blir det en dataassociation, inte ett sekvensflöde", () => {
    // Sorten härleds ur vad ändarna ÄR, så man bara behöver dra en linje.
    const a = nod(bas, "a startar");
    const lager = bas.dataStores[0];
    const m = compileDraft(addManualEdge(utkast, a.id, lager.id));
    expect(m.edges.some((e) => e.target === lager.id), "hamnade i sekvensflödet").toBe(false);
    const ny = m.dataAssociations.find((x) => x.nodeId === a.id && x.dataStoreId === lager.id);
    expect(ny?.direction).toBe("write");
  });

  /**
   * REGRESSION: skrivaren till ett datalager härleds redan – det är närmast
   * föregående utförare. Drog man samma linje för hand lades en ANDRA identisk
   * streckad koppling ovanpå den första: den såg ut som en tjock, skev pil och
   * gick bara att ta bort en i taget.
   */
  it("REGRESSION: att dra en koppling som redan finns härledd ger ingen dubblett", () => {
    const lager = bas.dataStores[0];
    const skrivning = bas.dataAssociations.find(
      (a) => a.dataStoreId === lager.id && a.direction === "write",
    )!;
    expect(skrivning, "testflödet saknar härledd skrivning").toBeDefined();
    const m = compileDraft(addManualEdge(utkast, skrivning.nodeId, lager.id));
    const träffar = m.dataAssociations.filter(
      (a) => a.nodeId === skrivning.nodeId && a.dataStoreId === lager.id && a.direction === "write",
    );
    expect(träffar).toHaveLength(1);
    expect(m.dataAssociations.length).toBe(bas.dataAssociations.length);
  });

  it("FRÅN ett datalager blir det en läsning", () => {
    const c = nod(bas, "c avslutar");
    const lager = bas.dataStores[0];
    const m = compileDraft(addManualEdge(utkast, lager.id, c.id));
    const ny = m.dataAssociations.find((x) => x.nodeId === c.id && x.dataStoreId === lager.id);
    expect(ny?.direction).toBe("read");
  });

  it("till en mottagarpool blir det ett meddelandeflöde", () => {
    const pool = bas.pools.find((p) => p.blackBox);
    expect(pool, "testflödet saknar mottagarpool").toBeDefined();
    const a = nod(bas, "a startar");
    const m = compileDraft(addManualEdge(utkast, a.id, pool!.id));
    expect(m.messageFlows.some((f) => f.nodeId === a.id && f.poolId === pool!.id)).toBe(true);
  });

  it("en koppling till sig själv ignoreras", () => {
    const a = nod(bas, "a startar");
    expect(addManualEdge(utkast, a.id, a.id)).toBe(utkast);
  });

  it("samma koppling två gånger ger bara en", () => {
    const a = nod(bas, "a startar");
    const c = nod(bas, "c avslutar");
    const en = addManualEdge(utkast, a.id, c.id);
    const två = addManualEdge(en, a.id, c.id);
    expect(compileDraft(två).edges.filter((e) => e.source === a.id && e.target === c.id)).toHaveLength(1);
  });

  it("REGRESSION: en egen koppling går att ta bort och dra igen", () => {
    // Togs den bara upp i removedEdges fortsatte borttagningen undertrycka
    // den nya kopplingen, och samma pil gick aldrig att få tillbaka.
    const a = nod(bas, "a startar");
    const c = nod(bas, "c avslutar");
    const lagd = addManualEdge(utkast, a.id, c.id);
    const borttagen = removeEdge(lagd, a.id, c.id);
    expect(compileDraft(borttagen).edges.some((e) => e.source === a.id && e.target === c.id)).toBe(false);
    const igen = addManualEdge(borttagen, a.id, c.id);
    expect(
      compileDraft(igen).edges.some((e) => e.source === a.id && e.target === c.id),
      "kopplingen gick inte att dra igen",
    ).toBe(true);
  });
});
