import { describe, expect, it } from "vitest";
import { textToDraft } from "@/tools/flowchart/parser/toDraft";
import { compileAp } from "@/core/affarsprocess";
import { uuidUrNamn } from "@/core/namn-id";
import { crc32, packaZip } from "@/core/zip";
import { layoutAp } from "./layout-affarsprocess";
import { byggBmtFiler } from "./bmt";

const SPRÅK = "11111111-2222-4333-8444-555555555555";
const TYP = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function filer(text: string, flödeId = "ap-prov") {
  const d = { ...textToDraft(text), diagramType: "affarsprocess" as const };
  return byggBmtFiler(layoutAp(compileAp(d)), { flödeId, namn: "Prov", sparad: new Date(1_790_000_000_000) }, { språk: SPRÅK, beskrivningstyp: TYP });
}

const TEXT =
  "Prov\nBehov finns → Uppdatera brandväggar [Roll: Intern IT H] [IT: Fortinet] [Krav: Rutin – ☐ Ta backup ☐ Ladda ner firmware] → Verifiera åtgärd [Roll: Intern IT U] → Klart";

describe("namn-id och zip", () => {
  it("ger samma UUID v5 som RFC 4122:s exempel", () => {
    expect(uuidUrNamn("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "python.org")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
  });
  it("räknar CRC32 rätt och skriver ett arkiv som börjar och slutar som zip", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const z = packaZip({ "a.txt": "hej" });
    expect([...z.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(new DataView(z.buffer).getUint32(z.length - 22, true)).toBe(0x06054b50);
  });
});

describe("byggBmtFiler", () => {
  const f = filer(TEXT);
  const modell = Object.entries(f).find(([k]) => k.startsWith("models/"))![1];
  const symboler = Object.entries(f).filter(([k]) => k.startsWith("symbols/")).map(([, v]) => v);

  it("har en modell, språket och 2c8:s kringfiler", () => {
    expect(Object.keys(f)).toEqual(expect.arrayContaining([`languages/${SPRÅK}.xml`, "version-info.txt", "data.xml", "breakdowns.xml", "removal-history.xml"]));
    expect(modell).toContain('type="PROCESS_MODEL"');
  });

  it("översätter metoden: HUKI blir RACI, IT-stödet pekar på aktiviteten, kravet adresserar", () => {
    expect(modell).toContain('type="RACI_ACCOUNTABLE"');
    expect(modell).toContain('type="RACI_RESPONSIBLE"');
    expect(modell).toContain('type="INTERRELATES_WITH"');
    expect(modell).toContain('type="ADRESSES"');
    expect(modell).toContain('type="FLOW"');
  });

  it("en roll på två aktiviteter är ETT objekt i 2c8 med två rutor", () => {
    const roll = symboler.filter((s) => s.includes('type="ROLE"'));
    expect(roll).toHaveLength(1);
    const sid = roll[0].match(/uuid="([^"]+)"/)![1];
    expect(modell.split(`symbol="${sid}"`).length - 1).toBe(2);
  });

  it("kravets rutin blir en numrerad lista i beskrivningen", () => {
    const krav = symboler.find((s) => s.includes('type="REQUIREMENT"'))!;
    expect(krav).toContain(`type="${TYP}"`);
    expect(krav).toContain("&lt;ol&gt;&lt;li&gt;Ta backup&lt;/li&gt;");
  });

  it("samma flöde ger samma id:n – en ny export uppdaterar i stället för att kopiera", () => {
    expect(filer(TEXT)).toEqual(f);
    expect(Object.keys(filer(TEXT, "ap-annat")).find((k) => k.startsWith("models/"))).not.toBe(
      Object.keys(f).find((k) => k.startsWith("models/")),
    );
  });
});
