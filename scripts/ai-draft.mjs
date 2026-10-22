/**
 * CLI: generera en AI-tolkad ProcessDraft utan att öppna appen.
 *
 *   npm run ai:draft -- <infil.txt> [-o utfil.json] [--model <id>]
 *   node --import tsx scripts/ai-draft.mjs <infil.txt>
 *
 * VAL AV LÖSNING: prompt och schema får ALDRIG dupliceras – då glider CLI:t
 * och appen isär. Vi återanvänder därför modulerna i src/ rakt av och kör
 * scriptet genom `tsx`, som både kompilerar TypeScript on-the-fly och
 * respekterar path-aliaset `@/` från tsconfig.json. npm-scriptet
 * "ai:draft" startar node med `--import tsx`, så inget bygg-steg behövs.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const USAGE = "Användning: npm run ai:draft -- <infil.txt> [-o utfil.json] [--model <id>]";

function parseArgs(argv) {
  const args = { input: null, output: null, model: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--output") args.output = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "-h" || a === "--help") args.help = true;
    else if (!args.input) args.input = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.input) {
    console.error(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY saknas i miljön. Sätt den först, t.ex.:\n" +
        "  export ANTHROPIC_API_KEY=sk-ant-...",
    );
    process.exit(1);
  }

  let rawText;
  try {
    rawText = await readFile(resolve(process.cwd(), args.input), "utf8");
  } catch {
    console.error(`Kunde inte läsa infilen: ${args.input}`);
    process.exit(1);
  }

  // Importeras dynamiskt så att argument- och miljöfel rapporteras snabbt,
  // innan tsx behöver kompilera src-modulerna.
  const { generateAiDraft } = await import("../src/tools/flowchart/ai/client.ts");

  let draft;
  try {
    draft = await generateAiDraft({ apiKey, rawText, model: args.model });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const json = JSON.stringify(draft, null, 2);
  if (args.output) {
    await writeFile(resolve(process.cwd(), args.output), json + "\n", "utf8");
    console.error(`Skrev ${draft.steps.length} steg till ${args.output}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

main();
