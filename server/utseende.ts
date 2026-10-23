/**
 * ORGANISATIONENS UTSEENDE – namn, logotyp och profilfärg i skalet och på
 * inloggningssidan.
 *
 * Två källor, fält för fält:
 *   1. miljön: `ARK_ORG_NAMN`, `ARK_ORG_LOGO` (sökväg till en bildfil) och
 *      `ARK_ORG_FARG` (#RRGGBB),
 *   2. portalen, när den är kopplad (`EA_API_KEY`): organisationsinställningarna
 *      under Administration → Organisation (`/org-settings/public` och
 *      `/org-settings/logo`). Så behöver organisationen bara ange dem en gång.
 * Miljön vinner; det som varken står där eller i portalen saknas, och skalet
 * visar då Arkitektens eget.
 *
 * Portalens svar sparas en stund (`TTL_MS`) – inloggningssidan läser det vid
 * varje besök. Svarar portalen inte gäller det senast lästa, annars inget:
 * utseendet får aldrig hindra inloggningen.
 */

import fs from "node:fs";
import path from "node:path";
import type { Utseende } from "../src/core/utseende";
import type { EaKonfig } from "./ea-portal";

export type { Utseende };


export interface Logotyp {
  data: Buffer;
  typ: string;
}

const FÄRG = /^#[0-9A-Fa-f]{6}$/;
const MAX_LOGO = 1024 * 1024;
const TTL_MS = 5 * 60 * 1000;
const BILDTYPER: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const text = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
const färg = (v: unknown): string | undefined => (typeof v === "string" && FÄRG.test(v.trim()) ? v.trim() : undefined);

/** Logotypen ur `ARK_ORG_LOGO`, eller null om den saknas eller inte är en bild vi visar. */
export function logoUrFil(fil: string | undefined): Logotyp | null {
  if (!fil?.trim()) return null;
  const typ = BILDTYPER[path.extname(fil).toLowerCase()];
  if (!typ) return null;
  try {
    const data = fs.readFileSync(fil);
    return data.length > 0 && data.length <= MAX_LOGO ? { data, typ } : null;
  } catch {
    return null;
  }
}

interface Portalens {
  utseende: Utseende;
  logo: Logotyp | null;
}

async function läsPortalen(k: EaKonfig): Promise<Portalens> {
  const f = k.fetch ?? fetch;
  const headers = { "x-api-key": k.nyckel };
  const res = await f(`${k.url}/org-settings/public`, { headers });
  if (!res.ok) throw new Error(`EA-portalen svarade ${res.status} på /org-settings/public`);
  const p = (await res.json()) as Record<string, unknown>;
  const utseende: Utseende = {
    namn: text(p.org_name, 120),
    kortnamn: text(p.org_short_name, 40),
    färg: färg(p.brand_color),
  };
  let logo: Logotyp | null = null;
  const version = text(p.logo_version, 40);
  if (version) {
    const l = await f(`${k.url}/org-settings/logo`, { headers });
    const typ = (l.headers.get("content-type") ?? "").split(";")[0].trim();
    const data = l.ok ? Buffer.from(await l.arrayBuffer()) : null;
    if (data && data.length <= MAX_LOGO && Object.values(BILDTYPER).includes(typ)) {
      logo = { data, typ };
      utseende.logoVersion = `p${version}`;
    }
  }
  return { utseende, logo };
}

export interface UtseendeKälla {
  utseende(): Promise<Utseende>;
  logo(): Promise<Logotyp | null>;
}

/** Utseendet ur miljön och, för det som inte står där, portalen. */
export function skapaUtseende(
  env: Record<string, string | undefined>,
  portal: EaKonfig | null,
  nu: () => number = Date.now,
): UtseendeKälla {
  const egenLogo = logoUrFil(env.ARK_ORG_LOGO);
  const egna: Utseende = {
    namn: text(env.ARK_ORG_NAMN, 120),
    kortnamn: text(env.ARK_ORG_KORTNAMN, 40),
    färg: färg(env.ARK_ORG_FARG),
    ...(egenLogo ? { logoVersion: `m${egenLogo.data.length}` } : {}),
  };
  const allaEgna = Boolean(egna.namn && egna.färg && egenLogo);

  let senast: Portalens | null = null;
  let läst = 0;
  let pågår: Promise<Portalens | null> | null = null;

  const portalens = async (): Promise<Portalens | null> => {
    if (!portal || allaEgna) return null;
    if (senast && nu() - läst < TTL_MS) return senast;
    pågår ??= läsPortalen(portal)
      .then((p) => {
        senast = p;
        return p;
      })
      .catch(() => senast)
      .finally(() => {
        läst = nu();
        pågår = null;
      });
    return pågår;
  };

  return {
    async utseende() {
      const p = (await portalens())?.utseende ?? {};
      const u: Utseende = {
        namn: egna.namn ?? p.namn,
        kortnamn: egna.kortnamn ?? p.kortnamn,
        färg: egna.färg ?? p.färg,
        logoVersion: egna.logoVersion ?? p.logoVersion,
      };
      return Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined)) as Utseende;
    },
    async logo() {
      return egenLogo ?? (await portalens())?.logo ?? null;
    },
  };
}
