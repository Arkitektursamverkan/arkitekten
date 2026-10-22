/**
 * EA-PORTALENS API, sett från Arkitektens server – det enda stället som talar
 * med portalen.
 *
 * Nyckeln (`EA_API_KEY`) är portalens tjänstenyckel och ger i praktiken
 * administratörsrätt. Den står i serverns miljö och lämnar aldrig
 * servern; webbläsaren talar bara med bryggan (`/__ark/ea/*` i
 * `server/brygga.ts`), precis som med AI-nyckeln.
 *
 * Fem saker görs, inga fler:
 *   1. läsa processträdet (noder av typen Process),
 *   2. läsa applikationerna (noder av typen Application) – målet när en
 *      Systemprocess publiceras. De förvaltas i portalen och skapas aldrig
 *      härifrån,
 *   3. skapa en NY process under en vald förälder – när processen inte finns
 *      i portalens processkarta,
 *   4. uppdatera ägare och beskrivning på en process VI skapat (en nod med
 *      extern källa skrivs över av portalens synk och rörs därför aldrig),
 *   5. be portalen hämta flödesschemana nu (`POST /arkflows/sync`) i stället
 *      för att vänta på plattformens schema.
 *
 * Själva flödesschemat skickas INTE hit: det går som förut genom
 * flödestjänsten och integrationsplattformen, så att portalen aldrig äger en
 * layoutregel (server/README.md).
 */

export interface EaKonfig {
  /** Bas-URL till portalens API, t.ex. http://localhost:8000/api/v1 */
  url: string;
  nyckel: string;
  /** Utbytbar i tester. */
  fetch?: typeof fetch;
}

import type { EaApplikation, EaProcess } from "../src/core/publicering";
export type { EaApplikation, EaProcess };

export function eaKonfigUrMiljö(env: NodeJS.ProcessEnv = process.env): EaKonfig | null {
  const nyckel = env.EA_API_KEY?.trim();
  if (!nyckel) return null;
  return { url: (env.EA_API_URL?.trim() || "http://localhost:8000/api/v1").replace(/\/+$/, ""), nyckel };
}

async function anrop(k: EaKonfig, väg: string, init: RequestInit = {}): Promise<unknown> {
  const f = k.fetch ?? fetch;
  const res = await f(`${k.url}${väg}`, {
    ...init,
    headers: { "content-type": "application/json", "x-api-key": k.nyckel, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    let detalj = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detalj = typeof j?.detail === "string" ? j.detail : JSON.stringify(j?.detail ?? j).slice(0, 300);
    } catch {
      /* inte JSON – visa texten som den är */
    }
    throw new Error(`EA-portalen svarade ${res.status} på ${väg}: ${detalj}`);
  }
  return text ? JSON.parse(text) : null;
}

interface NodeRead {
  id: string;
  name: string;
  description?: string | null;
  external_source?: string;
  is_structure?: boolean;
  admin_hidden?: boolean;
  attributes?: Record<string, unknown>;
}

function tillProcess(n: NodeRead): EaProcess {
  const a = n.attributes ?? {};
  const prefix = typeof a.prefix === "string" && a.prefix.trim() ? a.prefix.trim() : undefined;
  const förälder = typeof a.parent_id === "string" && a.parent_id ? a.parent_id : undefined;
  return {
    id: String(n.id),
    namn: n.name,
    ...(prefix ? { prefix } : {}),
    ...(förälder ? { förälderId: förälder } : {}),
    struktur: Boolean(n.is_structure),
    källa: n.external_source ?? "NONE",
  };
}

/** Processträdet, utan arkiverade noder. */
export async function listaProcesser(k: EaKonfig): Promise<EaProcess[]> {
  const noder = (await anrop(k, "/nodes?node_type=Process&archived=false&limit=10000")) as NodeRead[];
  return noder.map(tillProcess);
}

/** Applikationerna, utan arkiverade. Målet när en Systemprocess publiceras. */
export async function listaApplikationer(k: EaKonfig): Promise<EaApplikation[]> {
  const noder = (await anrop(k, "/nodes?node_type=Application&archived=false&limit=10000")) as NodeRead[];
  return noder.map((n) => {
    const status = typeof n.attributes?.status === "string" ? n.attributes.status.trim() : "";
    return { id: String(n.id), namn: n.name, ...(status ? { status } : {}) };
  });
}

export interface NyProcess {
  förälderId: string;
  namn: string;
  prefix?: string;
  ägare: string;
  beskrivning: string;
}

/**
 * Skapar en process som inte finns i portalens processkarta.
 *
 * Källan blir NONE: portalens synk gallrar bara sina egna noder, så den
 * här står kvar. Namnet får numret först, som de synkade noderna, så att trädet
 * sorterar och läser likadant. Ägaren skrivs under `owner` – nyckeln portalens
 * eget processformulär använder.
 */
export async function skapaProcess(k: EaKonfig, ny: NyProcess): Promise<EaProcess> {
  const prefix = ny.prefix?.trim();
  const nod = (await anrop(k, "/nodes", {
    method: "POST",
    body: JSON.stringify({
      type: "Process",
      name: prefix ? `${prefix} ${ny.namn.trim()}` : ny.namn.trim(),
      description: ny.beskrivning.trim(),
      attributes: {
        parent_id: ny.förälderId,
        ...(prefix ? { prefix } : {}),
        owner: ny.ägare.trim(),
        källa: "Arkitekten",
      },
    }),
  })) as NodeRead;
  return tillProcess(nod);
}

/**
 * Ny ägare och beskrivning på en process VI skapat.
 *
 * Portalens PATCH ersätter HELA `attributes` – därför läses noden först och
 * attributen slås ihop, annars försvann förälder och nummer och processen
 * hamnade utanför trädet.
 */
export async function uppdateraEgenProcess(
  k: EaKonfig,
  id: string,
  ändring: { ägare: string; beskrivning: string },
): Promise<void> {
  const nod = (await anrop(k, `/nodes/${encodeURIComponent(id)}`)) as NodeRead;
  await anrop(k, `/nodes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      description: ändring.beskrivning.trim(),
      attributes: { ...(nod.attributes ?? {}), owner: ändring.ägare.trim() },
    }),
  });
}

/**
 * Arkiverar en process som publiceringen själv skapat – när den avpubliceras.
 *
 * Arkivering och inte radering: den går att ta tillbaka i portalen, och
 * portalens radering kräver ett skäl och loggas som en borttagning. Noden
 * kontrolleras FÖRST: bara en nod som skapats ur Arkitekten (källa NONE och
 * `källa: "Arkitekten"`) får röras. En nod med extern källa är processkartans egen och
 * arkiveras aldrig härifrån, vad webbläsaren än påstår.
 */
export async function arkiveraEgenProcess(k: EaKonfig, id: string): Promise<void> {
  const nod = (await anrop(k, `/nodes/${encodeURIComponent(id)}`)) as NodeRead;
  if ((nod.external_source ?? "NONE") !== "NONE" || nod.attributes?.källa !== "Arkitekten") {
    throw new Error(`”${nod.name}” är inte skapad ur Arkitekten och arkiveras inte härifrån.`);
  }
  await anrop(k, `/nodes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ archived: true }),
  });
}

export interface SynkResultat {
  records_processed: number;
  failed: string[];
}

/** Portalen hämtar flödesschemana från plattformen NU (kör plattformens pipeline). */
export async function synkaFlödesscheman(k: EaKonfig): Promise<SynkResultat> {
  const r = (await anrop(k, "/arkflows/sync", { method: "POST" })) as Partial<SynkResultat>;
  return { records_processed: Number(r?.records_processed ?? 0), failed: r?.failed ?? [] };
}
