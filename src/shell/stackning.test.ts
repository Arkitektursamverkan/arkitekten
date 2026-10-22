/**
 * Stackningen mellan verktygsraden och ritytan. Bara CSS, men felet syns inte
 * i någon komponent för sig – därför läses regeln direkt ur stilarket.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");
const regel = (väljare: string) => {
  const m = css.match(new RegExp(`(^|\\n)${väljare.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`));
  return m?.[2] ?? "";
};

describe("ritytan och verktygsradens menyer", () => {
  /**
   * REGRESSION: i den förenklade processen (presentationsbilden) tändes
   * Granska-knappen men ingen meny syntes. Bilden ligger i ritytan på z-index
   * 40 och verktygsraden på 20, så rullgardinen ritades BAKOM bilden
   * (2026-10-13). Ritytan isoleras nu – allt i den stannar under raden.
   */
  it("REGRESSION: ritytan är en egen stackningsnivå, så rullgardinerna hamnar överst", () => {
    expect(regel(".ark-tool-stage")).toMatch(/isolation:\s*isolate/);
  });
});
