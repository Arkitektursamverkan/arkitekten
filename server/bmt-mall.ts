/**
 * MALLEN för BMT-exporten (`src/tools/affarsprocess/bmt.ts`): en vanlig
 * modellexport ur mål-repositoryt, som installationen pekar ut med
 * `ARK_BMT_MALL` (sökväg till filen). Utan den finns ingen export – knappen
 * visas inte. Filen läses vid varje begäran, som logotypen, så att en ny mall
 * gäller utan omstart.
 *
 * Mallen bär repositoryts profil, scheman, språk och användare. Den behöver
 * inte innehålla någon process – en export av en tom modell räcker – och ska
 * vara LITEN: en export av hela repositoryt fungerar men skickas till
 * webbläsaren vid varje export.
 */

import fs from "node:fs";

/** Övre gräns – en mall är en enda modell, sällan över någon megabyte. */
export const MAX_MALL = 40 * 1024 * 1024;

export function bmtMallFil(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.ARK_BMT_MALL?.trim() || undefined;
}

/** Mallens innehåll, eller null när ingen mall är angiven eller filen inte går att läsa. */
export function läsBmtMall(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const fil = bmtMallFil(env);
  if (!fil) return null;
  try {
    const st = fs.statSync(fil);
    if (!st.isFile() || st.size === 0 || st.size > MAX_MALL) return null;
    const data = fs.readFileSync(fil);
    // Ett zip-arkiv börjar med "PK\x03\x04".
    return data.readUInt32LE(0) === 0x04034b50 ? data : null;
  } catch {
    return null;
  }
}
