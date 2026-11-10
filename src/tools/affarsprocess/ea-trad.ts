/**
 * EA-portalens processträd i publiceringsrutan.
 *
 * Portalen lagrar trädet platt: varje nod pekar ut sin förälder med
 * `parent_id` och syskonen sorteras på processnumret. Samma ordning här, så att
 * rutan och portalen visar trädet likadant.
 */

import { delaNamn, type EaProcess, type Publicering } from "@/core/publicering";

export interface TrädRad {
  process: EaProcess;
  djup: number;
}

/** "4.10" efter "4.9" – numret jämförs led för led, inte som text. */
export function jämförPrefix(a?: string, b?: string): number {
  if (a && !b) return -1;
  if (!a && b) return 1;
  if (!a || !b) return 0;
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/**
 * Trädet som en platt lista i visningsordning, med djup.
 *
 * `sök` behåller träffarna OCH deras förfäder, så att man ser var en träff
 * ligger. En nod vars förälder saknas i listan (arkiverad, dold) blir rot –
 * hellre synlig på fel nivå än borta.
 */
export function byggTräd(processer: readonly EaProcess[], sök = ""): TrädRad[] {
  const finns = new Set(processer.map((p) => p.id));
  const barn = new Map<string | undefined, EaProcess[]>();
  for (const p of processer) {
    const f = p.förälderId && finns.has(p.förälderId) ? p.förälderId : undefined;
    barn.set(f, [...(barn.get(f) ?? []), p]);
  }
  for (const lista of barn.values())
    lista.sort((a, b) => jämförPrefix(a.prefix, b.prefix) || a.namn.localeCompare(b.namn, "sv"));

  const q = sök.trim().toLowerCase();
  const synlig = new Set<string>();
  if (q) {
    const förälder = new Map(processer.map((p) => [p.id, p.förälderId]));
    for (const p of processer) {
      if (!p.namn.toLowerCase().includes(q) && !(p.prefix ?? "").startsWith(q)) continue;
      for (let id: string | undefined = p.id; id && !synlig.has(id); id = förälder.get(id)) synlig.add(id);
    }
  }

  const ut: TrädRad[] = [];
  const gå = (f: string | undefined, djup: number) => {
    for (const p of barn.get(f) ?? []) {
      if (q && !synlig.has(p.id)) continue;
      ut.push({ process: p, djup });
      gå(p.id, djup + 1);
    }
  };
  gå(undefined, 0);
  return ut;
}

/**
 * Förslag på numret för en ny process under `förälderId`: nästa lediga
 * ("4.4" med barnen 4.4.1–4.4.4 → "4.4.5"). Föräldern utan nummer ger inget
 * förslag – då finns inget att räkna vidare på.
 */
export function nästaPrefix(processer: readonly EaProcess[], förälderId: string | null): string {
  const förälder = processer.find((p) => p.id === förälderId);
  if (!förälder?.prefix) return "";
  const djup = förälder.prefix.split(".").length + 1;
  let max = 0;
  for (const p of processer) {
    if (p.förälderId !== förälder.id || !p.prefix) continue;
    const led = p.prefix.split(".");
    if (led.length !== djup || !p.prefix.startsWith(förälder.prefix + ".")) continue;
    max = Math.max(max, Number(led[djup - 1]) || 0);
  }
  return `${förälder.prefix}.${max + 1}`;
}

/**
 * Vilken process rutan ska stå på när den öppnas.
 *
 * Redan publicerad → den noden. Annars noden med samma nummer som flödets
 * namn ("4.4.3 …" → 4.4.3), för så har flödena hittills kopplats och det är
 * nästan alltid rätt. Annars ingen – hellre ett aktivt val än en gissning.
 */
export function förvaldProcess(
  processer: readonly EaProcess[],
  flödesnamn: string,
  publicering?: Publicering,
): EaProcess | undefined {
  if (publicering) {
    const p = processer.find((x) => x.id === publicering.eaNodId);
    if (p) return p;
  }
  const { prefix } = delaNamn(flödesnamn);
  return prefix ? processer.find((p) => p.prefix === prefix) : undefined;
}

/** Vägen ner till noden: "4 Stödprocesser › 4.4 Drift › 4.4.3 …". */
export function vägTill(processer: readonly EaProcess[], id: string | null): string {
  const efter = new Map(processer.map((p) => [p.id, p]));
  const led: string[] = [];
  const sedda = new Set<string>();
  for (let p = id ? efter.get(id) : undefined; p && !sedda.has(p.id); p = p.förälderId ? efter.get(p.förälderId) : undefined) {
    sedda.add(p.id);
    led.unshift(p.namn.replace(/\s+/g, " ").trim());
  }
  return led.join(" › ");
}
