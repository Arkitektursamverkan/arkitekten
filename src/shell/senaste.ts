/**
 * "Senast öppnade" – menyns genväg tillbaka till det man höll på med.
 *
 * Katalogen är den fullständiga vägen till ett flöde (sök, filter, gruppering),
 * men i praktiken arbetar man med en handfull processer i taget. Utan den här
 * listan hade varje återbesök krävt ett omtag i katalogen, och menyn hade inte
 * haft något att säga om var man var.
 *
 * Lagras i webbläsaren, inte i flödesfilen: det är en egenskap hos DEN HÄR
 * datorns arbetspass, inte hos processen. Två personer som delar `flows/` ska
 * inte se varandras historik.
 */

const NYCKEL = "ark.senaste";
/** Så många får plats i menyn utan att den blir en andra katalog. */
export const MAX_SENASTE = 6;

export interface SenastPost {
  id: string;
  /** Namnet som det såg ut då – posten ska gå att visa innan flödena hunnit läsas. */
  namn: string;
  /** ISO-tidpunkt för besöket. */
  när: string;
}

/** Listan, nyast först. Trasigt innehåll läses som tomt – aldrig ett kastat fel. */
export function läsSenaste(): SenastPost[] {
  try {
    const rå = localStorage.getItem(NYCKEL);
    if (!rå) return [];
    const data: unknown = JSON.parse(rå);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (p): p is SenastPost =>
          typeof p === "object" && p !== null && typeof (p as SenastPost).id === "string",
      )
      .slice(0, MAX_SENASTE);
  } catch {
    return [];
  }
}

/**
 * Lägger flödet överst. Samma flöde flyttas upp i stället för att dubbleras –
 * annars hade listan fyllts av det man just arbetade med.
 */
export function minnsFlöde(id: string, namn: string): SenastPost[] {
  const nu: SenastPost = { id, namn, när: new Date().toISOString() };
  const lista = [nu, ...läsSenaste().filter((p) => p.id !== id)].slice(0, MAX_SENASTE);
  try {
    localStorage.setItem(NYCKEL, JSON.stringify(lista));
  } catch {
    // Full eller avstängd lagring får inte hindra att flödet öppnas.
  }
  return lista;
}

/** Tar bort en post – används när ett flöde raderats ur biblioteket. */
export function glömFlöde(id: string): SenastPost[] {
  const lista = läsSenaste().filter((p) => p.id !== id);
  try {
    localStorage.setItem(NYCKEL, JSON.stringify(lista));
  } catch {
    // Se ovan.
  }
  return lista;
}
