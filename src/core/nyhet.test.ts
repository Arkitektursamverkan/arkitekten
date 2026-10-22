import { expect, it } from "vitest";
import { skapadTid, ärNy } from "./nyhet";

const NU = Date.parse("2026-10-02T12:00:00.000Z");

it("en process är ny i 48 timmar efter att den lagts upp", () => {
  expect(ärNy("2026-10-02T11:00:00.000Z", NU)).toBe(true);
  expect(ärNy("2026-09-30T12:00:01.000Z", NU)).toBe(true);
  expect(ärNy("2026-09-30T12:00:00.000Z", NU)).toBe(false);
  expect(ärNy("2026-07-29T10:00:00.000Z", NU)).toBe(false);
});

it("saknad, trasig eller framtida tidpunkt är inte ny", () => {
  expect(ärNy(undefined, NU)).toBe(false);
  expect(ärNy("igår", NU)).toBe(false);
  expect(ärNy("2026-10-03T12:00:00.000Z", NU)).toBe(false);
});

/**
 * Märket gäller när processen LADES UPP, inte när den senast sparades – annars
 * hade varje gammal process blivit "ny" igen så fort någon rättade ett ord.
 */
it("skapandetiden är första versionens, inte senaste sparningens", () => {
  expect(
    skapadTid({
      savedAt: "2026-10-02T11:00:00.000Z",
      versions: [{ savedAt: "2026-07-01T08:00:00.000Z" }, { savedAt: "2026-10-02T11:00:00.000Z" }],
    }),
  ).toBe("2026-07-01T08:00:00.000Z");
});

it("en fil från före versionshistoriken faller tillbaka på flödets egen tid", () => {
  expect(skapadTid({ savedAt: "2026-07-01T08:00:00.000Z" })).toBe("2026-07-01T08:00:00.000Z");
  expect(skapadTid({ savedAt: "2026-07-01T08:00:00.000Z", versions: [] })).toBe(
    "2026-07-01T08:00:00.000Z",
  );
  expect(skapadTid({})).toBeUndefined();
});
