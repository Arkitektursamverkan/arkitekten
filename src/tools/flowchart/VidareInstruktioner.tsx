/**
 * "Vidare instruktioner till AI" – under AI-beskrivningen i båda verktygen.
 *
 * Man har fått en tolkning och vill justera den: i stället för att skriva om
 * texten för hand beskriver man ändringarna, och de går vidare i ett nytt
 * AI-anrop. Anropet är en vanlig tolkning av samma underlag, med den
 * NUVARANDE AI-beskrivningen och justeringarna som önskemål – så det går
 * genom bryggan som allt annat (kostnadsrutan, API:t eller Claude Code).
 */

import { useState } from "react";

/**
 * Önskemålet som följer med anropet. Den nuvarande AI-beskrivningen står med,
 * för det är DEN som ska justeras – inte en ny tolkning från noll.
 */
export function vidareInstruktion(aiText: string, justeringar: string): string {
  return [
    "VIDARE INSTRUKTIONER: justera den tidigare tolkningen nedan enligt användarens instruktioner.",
    "Behåll allt som instruktionerna inte berör – samma steg, namn och satelliter – och svara med HELA den justerade tolkningen.",
    "",
    "Tidigare tolkning (AI-beskrivningen):",
    aiText.trim(),
    "",
    "Användarens instruktioner:",
    justeringar.trim(),
  ].join("\n");
}

/** Kortar ett stegnamn så att exemplet ryms på en rad. */
const kort = (s: string) => (s.length > 40 ? `${s.slice(0, 38).trimEnd()}…` : s);

/**
 * Stegen i AI-beskrivningens pilformat, i ordning: hakparenteserna
 * (satelliterna) bort, grenarna utplattade, och grenetiketterna ("Ja",
 * "Om nej") borttagna. Räcker för exempel – det är ingen tolkning.
 */
function stegIBeskrivningen(aiText: string): string[] {
  const kropp = aiText.split("\n").slice(1).join(" ");
  return kropp
    .replace(/\[[^\]]*\]/g, "")
    // En parentes utan ↓ är ett förtydligande ("(chef)") – inte en gren.
    .replace(/\((?!\s*↓)[^()]*\)/g, "")
    .replace(/\(\s*↓/g, "→")
    .replace(/[()]/g, "")
    .split("→")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s && !/^(om\s+)?(ja|nej)$/i.test(s));
}

/**
 * Exemplen i rutan, byggda ur DEN HÄR processen – så att man ser hur en
 * instruktion kan låta om just de stegen. Affärsprocessen talar om roller, flödesschemat
 * om banor.
 */
export function exempelInstruktioner(aiText: string, typ: "affarsprocess" | "flowchart"): string {
  const steg = stegIBeskrivningen(aiText);
  const mitten = steg.slice(1, -1);
  const aktiviteter = mitten.filter((s) => !s.endsWith("?"));
  const fråga = mitten.find((s) => s.endsWith("?"));
  if (!aktiviteter.length) {
    return typ === "affarsprocess"
      ? "T.ex.\n– Rollen i alla steg är …\n– Lägg till ett steg efter …"
      : "T.ex.\n– Steget … utförs av …\n– Lägg till ett steg efter …";
  }
  const första = kort(aktiviteter[0]);
  const längsta = kort([...aktiviteter].sort((a, b) => b.length - a.length)[0]);
  const sista = kort(aktiviteter[aktiviteter.length - 1]);
  const rader = [
    typ === "affarsprocess" ? `– Rollen som utför ”${första}” är …` : `– ”${första}” utförs i banan …`,
    `– Dela upp ”${längsta}” i två steg`,
    fråga ? `– Vid Nej på ”${kort(fråga)}” ska …` : `– Lägg till ett steg efter ”${sista}”`,
  ];
  return ["T.ex.", ...rader].join("\n");
}

interface Props {
  /** AI-beskrivningen som den står i rutan just nu. */
  aiText: string;
  /** Vilket verktyg – avgör om exemplen talar om roller eller banor. */
  diagramType: "affarsprocess" | "flowchart";
  /** Sant medan en AI-begäran pågår. */
  upptagen: boolean;
  /** Knapptexten medan begäran väntar ("AI:n arbetar …"/"Väntar på Claude Code …"). */
  väntarText: string;
  /** Felet från senaste anropet, när verktyget inte redan visar det här. */
  fel?: string | null;
  /** Skickar önskemålet; svarar sant när tolkningen kom tillbaka. */
  onSkicka: (instruktion: string) => Promise<boolean>;
}

export function VidareInstruktioner({ aiText, diagramType, upptagen, väntarText, fel, onSkicka }: Props) {
  const [text, setText] = useState("");
  if (!aiText.trim()) return null;

  return (
    <div className="ark-vidare">
      <label className="ark-field-label" htmlFor="ark-vidare-text">
        Vidare instruktioner till AI
      </label>
      <p className="ark-hint">
        Beskriv justeringarna du vill ha i tolkningen. Skriv in <strong>alla</strong> justeringar och skicka
        dem samtidigt – varje AI-anrop är förknippat med en kostnad.
      </p>
      <textarea
        id="ark-vidare-text"
        className="ark-textarea ark-vidare-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={exempelInstruktioner(aiText, diagramType)}
        disabled={upptagen}
      />
      <button
        className="ark-btn ark-btn--ai ark-btn--bred"
        disabled={upptagen || !text.trim()}
        onClick={async () => {
          if (await onSkicka(vidareInstruktion(aiText, text))) setText("");
        }}
      >
        {upptagen ? väntarText : "✦ Skicka instruktionerna till AI"}
      </button>
      {fel && <p className="ark-hint ark-hint--warn">{fel}</p>}
    </div>
  );
}
