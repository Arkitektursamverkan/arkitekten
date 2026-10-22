/**
 * Det som skiljer sig mellan organisationer men inte är ett utseende –
 * namn som annars hade stått i koden.
 *
 * Sätts av servern ur miljön (`ARK_PORTALBANA`, `ARK_SYSTEMPROCESS_KATEGORI`) och når webbläsaren via
 * inloggningsgrinden (`/__ark/organisation`), precis som symbolstilen. Allt
 * som läser värdena gör det när det behövs, aldrig vid modulens laddning – då
 * hade standardvärdet frusits fast innan installationens val kommit fram.
 */

export interface Organisation {
  /**
   * Namnet på organisationens portalsystem som bana i en systemprocess – det
   * system användaren möter. Regelmotorn lägger portalsteg där, och ett slut
   * utan inkommande bana hamnar där.
   */
  portalbana: string;
  /** Katalogens samling för systemprocesser som saknar egen kategori. */
  systemprocesskategori: string;
}

export const STANDARD_ORGANISATION: Organisation = {
  portalbana: "Portalen",
  systemprocesskategori: "Systemprocesser",
};

let aktiv: Organisation = STANDARD_ORGANISATION;

export const organisation = (): Organisation => aktiv;
export const portalbana = (): string => aktiv.portalbana;

/** Okända fält och tomma värden ignoreras; standardvärdet gäller då. */
export function sättOrganisation(o: Partial<Organisation> | null | undefined): void {
  const text = (v: unknown, standard: string) =>
    (typeof v === "string" ? v.trim().slice(0, 60) : "") || standard;
  aktiv = {
    portalbana: text(o?.portalbana, STANDARD_ORGANISATION.portalbana),
    systemprocesskategori: text(o?.systemprocesskategori, STANDARD_ORGANISATION.systemprocesskategori),
  };
}

export function organisationUrMiljö(env: Record<string, string | undefined>): Organisation {
  return {
    portalbana: env.ARK_PORTALBANA?.trim() || STANDARD_ORGANISATION.portalbana,
    systemprocesskategori: env.ARK_SYSTEMPROCESS_KATEGORI?.trim() || STANDARD_ORGANISATION.systemprocesskategori,
  };
}
