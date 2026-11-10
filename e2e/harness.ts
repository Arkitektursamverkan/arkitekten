/**
 * Riggen för webbläsartesterna.
 *
 * Varför de finns: layouten är enhetstestad i detalj och kan vara helt korrekt
 * samtidigt som skärmen är tom. Det hände – banhöjden räknades rätt, men
 * kameran följde inte med när diagrammet växte, och innehållet gled ur bild.
 * Ingen av de 200+ enhetstesterna kunde se skillnad på "layouten är rätt" och
 * "det syns". Det är precis den luckan de här testerna täcker.
 *
 * De körs INTE av `npm test`. Kör dem med `npm run test:browser`, och de hoppas
 * över med ett tydligt meddelande om ingen Chromium finns på maskinen.
 */

import { cpSync, existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright-core";
import { mallkatalog } from "./testdata";

/* -------------------------------------------------------------------- */
/* Chromium                                                             */
/* -------------------------------------------------------------------- */

/**
 * Letar upp en Chromium att köra. `playwright-core` laddar medvetet inte ned
 * någon binär – vi använder den som redan finns (Playwright-cachen eller en
 * systeminstallation) och hoppar över testerna om det inte finns någon.
 * ARK_CHROME pekar ut en egen sökväg.
 */
export function findChromium(): string | null {
  if (process.env.ARK_CHROME && existsSync(process.env.ARK_CHROME)) return process.env.ARK_CHROME;

  const cache = join(homedir(), ".cache", "ms-playwright");
  if (existsSync(cache)) {
    // Nyaste versionen först – katalogerna heter chromium-1228, chromium-1181 …
    const kataloger = readdirSync(cache)
      .filter((d) => d.startsWith("chromium"))
      .sort((a, b) => (Number(b.split("-")[1]) || 0) - (Number(a.split("-")[1]) || 0));
    for (const d of kataloger) {
      for (const rel of [
        "chrome-linux64/chrome",
        "chrome-linux/chrome",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-win/chrome.exe",
        "chrome-linux64/headless_shell",
        "chrome-linux/headless_shell",
      ]) {
        const p = join(cache, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }

  for (const p of [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/chrome",
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Finns flödet i testinstallationen? Exempelpaketet har bara neutrala
 * processer; tester som gäller en installations egna kräver ARK_E2E_INNEHALL
 * (e2e/testdata.ts) och hoppar annars över. Läses när testfilen samlas in –
 * globalSetup har då redan lagt mallen i ordning.
 */
export function harFlöde(id: string): boolean {
  const rot = process.env.ARK_E2E_ROT;
  return !!rot && existsSync(join(mallkatalog(rot), "flows", `${id}.json`));
}

/**
 * Öppnar ett flöde ur sidomenyns träd, som en användare gör. Sökfältet fäller
 * ut grenarna med träffar, så testet behöver inte veta var i trädet flödet
 * ligger – och väljer det vid NAMN, inte "första" eller "sista" raden, som
 * pekar på något annat så fort katalogen har fler processer.
 */
export async function öppnaUrMenyn(page: Page, namn: string): Promise<void> {
  await page.fill(".ark-meny-filter", namn);
  await page.locator(".ark-flow-menyval", { hasText: namn }).first().click();
}

/** Rubrikens tillägg när ett test hoppar över för att innehållet saknas. */
export const KRÄVER_INNEHÅLL = " (hoppar över: kräver ARK_E2E_INNEHALL med installationens flöden)";

/* -------------------------------------------------------------------- */
/* Dev-server + sida                                                    */
/* -------------------------------------------------------------------- */

export interface Rigg {
  page: Page;
  /** Fel som webbläsaren rapporterat sedan sidan laddades. */
  fel: string[];
  /** Riggens egna kataloger – en kopia av exempelinstallationen (e2e/testdata.ts). */
  data: { flowsDir: string; ramarDir: string };
  /**
   * Flödenas fingeravtryck när riggen lämnade över sidan (efter att en ny
   * process skapats – den sparas direkt). Testerna klickar aldrig Spara, så
   * det ska vara detsamma när de är klara.
   */
  flödenFöre: string;
  /** Flödenas fingeravtryck nu. */
  flöden: () => string;
  stäng: () => Promise<void>;
}

/**
 * En egen installation för riggen, kopierad ur mallen som globalSetup lagt i
 * ordning. Vite-servern läser katalogerna ur miljön när den startar, så de
 * pekas om här – före createServer.
 */
function egenInstallation(): Rigg["data"] {
  const rot = process.env.ARK_E2E_ROT;
  if (!rot) throw new Error("ARK_E2E_ROT saknas – kör testerna med npm run test:browser");
  const dir = mkdtempSync(join(rot, "rigg-"));
  cpSync(mallkatalog(rot), dir, { recursive: true });
  const data = { flowsDir: join(dir, "flows"), ramarDir: join(dir, "ramar") };
  process.env.FLOWS_DIR = data.flowsDir;
  process.env.RAMAR_DIR = data.ramarDir;
  process.env.STILAR_DIR = join(dir, "stilar");
  process.env.ARK_DIR = join(dir, ".ark");
  process.env.ARK_KONTON = join(dir, "konton.json");
  return data;
}

/**
 * Startar appen i en egen Vite-server på en ledig port och öppnar den.
 *
 * Vi startar en egen i stället för att förlita oss på att `npm run dev` råkar
 * vara igång: testet ska ge samma svar oavsett vad som körs på maskinen. Vites
 * riktiga config används, så ark-bryggan finns med och flödena läses från disk.
 */
/**
 * Exempeltexterna som verktygen hade inlästa när appen öppnade mitt i
 * flödesschemat. Appen börjar numera i startvyn, så riggen skapar processen
 * själv – genom vyn "Ny process", som en användare gör – och sparar den aldrig.
 */
export const SYSTEMPROCESS_EXEMPEL = `Driftfråga ny
Fel uppkommer → Medarbetare → Startar Portalen → Väljer ny driftfråga från startsidan → Fyller i formulär för driftfråga → Väljer skicka in formuläret för driftfråga → Handläggare utses automatiskt utifrån det system som valts → Kommer till en sida med tack för ditt ärende → Får via mejl bekräftelse på att driftfråga har inkommit

Driftfråga inkommer i SP-listan "Inkorgen" → Power Automate flödet "DRF nytt ärende" triggas (↓ Om klassificering = Hög prioritet → Teamschatt skapas med alla handläggare på IT → Chattmeddelande genereras för det specifika ärendet) → Mejlbekräftelse skickas till användaren → Mejl skickas till handläggaren → Loggpost skapas`;

export const AFFARSPROCESS_EXEMPEL = `Rekrytera medarbetare
Behov av rekrytering uppstår → Skapa kravprofil [Roll: Rekryterande chef U] [Krav: Kompetensbaserad rekrytering] → Annonsera tjänst [Roll: HR U] [IT: ReachMee] [Ut: Ansökningar] → Genomför urval [Roll: Rekryterande chef H, HR K] [Krav: Öka mångfald] (↓ Om kandidat godkänd → Lämna anställningserbjudande [Roll: Rekryterande chef U] [Tid: Inom 5 dagar]) → Avsluta rekrytering [IT: ReachMee]`;

export interface NyProcessVal {
  verktyg: "Systemprocess" | "Affärsprocess";
  /** Hela beskrivningen; första raden blir processens namn. */
  text: string;
  /** Hur processen börjar – rubriken på valkortet i "Ny process". */
  start?: "Beskriv i text" | "Fyll i en mall" | "Börja från tomt";
}

export interface StartOptions {
  /**
   * Selektorn riggen väntar på innan den lämnar över sidan. Standard är
   * menyns kategorirader, alltså "katalogen är inläst"; med `ny` eller
   * `process` är det ett uppritat diagram.
   */
  väntaPå?: string;
  /** Skapa en ny (osparad) process och lämna över den i redigeringsläget. */
  ny?: NyProcessVal;
  /** Öppna ett sparat flöde via dess länk (`#/process/<id>`) – i läsläge. */
  process?: string;
}

/** Skapar en process genom vyn "Ny process". Den sparas inte. */
export async function skapaNyProcess(page: Page, val: NyProcessVal): Promise<void> {
  const [namn, ...rader] = val.text.split("\n");
  const start = val.start ?? "Beskriv i text";
  await page.getByRole("button", { name: /Ny process/ }).first().click();
  await page.locator(".ark-ny-verktyg .ark-valkort", { hasText: val.verktyg }).click();
  await page.fill(".ark-ny-namn", namn);
  await page.locator(".ark-ny-start .ark-valkort", { hasText: start }).click();
  if (start === "Beskriv i text") await page.fill(".ark-ny-text", rader.join("\n"));
  await page.getByRole("button", { name: "Skapa process" }).click();
}

/** Vad ett diagram i respektive verktyg ritar – det riggen väntar på. */
const NODKLASS: Record<NyProcessVal["verktyg"], string> = {
  Systemprocess: ".react-flow__node-process",
  Affärsprocess: ".ark-ap-nod",
};

export async function startaAppen(
  opts: StartOptions = {},
): Promise<Rigg & { server: ViteDevServer; browser: Browser }> {
  const exe = findChromium();
  if (!exe) throw new Error("ingen Chromium hittad");
  const data = egenInstallation();

  /**
   * Egen port, och `strictPort: false` som uttryckligt undantag från
   * vite.config.ts. Appen körs som en tjänst på den bokmärkta porten 5173 med
   * strictPort – utan undantaget ärvde testservern både porten och kravet, och
   * hela sviten föll på "Port 5173 is already in use" så fort appen var uppe.
   */
  const server = await createServer({
    server: { port: 0, strictPort: false },
    logLevel: "error",
  });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error("Vite gav ingen lokal adress");

  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  const fel: string[] = [];
  page.on("pageerror", (e) => fel.push(`PAGEERROR: ${e.message}`));
  page.on("console", (m) => {
    // 404 för favicon o.d. säger inget om appen.
    if (m.type() === "error" && !m.text().includes("404")) fel.push(`CONSOLE: ${m.text()}`);
  });

  const adress = opts.process ? `${url}#/process/${encodeURIComponent(opts.process)}` : url;
  await page.goto(adress, { waitUntil: "networkidle" });
  // Menyn först: då är katalogen inläst, och "Ny process" vet vilka namn som är tagna.
  await page.waitForSelector(".ark-meny-kategori-titel", { timeout: 20_000 });
  const antalFöre = readdirSync(data.flowsDir).length;
  if (opts.ny) await skapaNyProcess(page, opts.ny);
  const väntaPå =
    opts.väntaPå ??
    (opts.ny ? NODKLASS[opts.ny.verktyg] : opts.process ? ".react-flow__node" : ".ark-meny-kategori-titel");
  await page.waitForSelector(väntaPå, { timeout: 20_000 });
  // En ny process sparas när den skapas. Vänta in filen, så att den ingår i
  // fingeravtrycket – annars ser den ut som något testet ändrat.
  if (opts.ny) {
    const t0 = Date.now();
    while (readdirSync(data.flowsDir).length === antalFöre && Date.now() - t0 < 10_000) {
      await page.waitForTimeout(100);
    }
  }

  return {
    page,
    fel,
    data,
    flödenFöre: flödenFingeravtryck(data.flowsDir),
    flöden: () => flödenFingeravtryck(data.flowsDir),
    server,
    browser,
    stäng: async () => {
      await browser.close();
      await server.close();
    },
  };
}

/* -------------------------------------------------------------------- */
/* Avläsning                                                            */
/* -------------------------------------------------------------------- */

export interface Vystatus {
  /** Antal processobjekt i DOM:en. */
  noder: number;
  /** Hur många av dem som faktiskt syns i fönstret. */
  iVy: number;
  /** Kamerans transform – avslöjar om vyn följt med eller stått stilla. */
  kamera: string;
  /** Diagrammets höjd, mätt på banbandens underkant. */
  höjd: number;
  /** Högsta banhöjden, för att se om en bana krympt eller växt. */
  störstaBana: number;
}

/** Läser av vad som RITAS – inte vad layouten räknade fram. */
export function läsVy(page: Page): Promise<Vystatus> {
  return page.evaluate(() => {
    const vp = document.querySelector<HTMLElement>(".react-flow__viewport");
    const noder = [...document.querySelectorAll<HTMLElement>(".react-flow__node-process")];
    // MÅLADE objekt, inte bara objekt med en rektangel. En nod som React Flow
    // gömt (visibility: hidden i väntan på mätning) har fortfarande full rect –
    // räknar man bara rektanglar ser en helt tom ryta ut som om allt syntes.
    const iVy = noder.filter((n) => {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
      return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    }).length;
    const banor = [...document.querySelectorAll<HTMLElement>(".react-flow__node-lane")];
    const höjder = banor.map((l) => parseFloat(l.style.height) || l.getBoundingClientRect().height);
    const botten = banor.map((l, i) => {
      const t = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(l.style.transform);
      return (t ? +t[2] : 0) + (höjder[i] || 0);
    });
    return {
      noder: noder.length,
      iVy,
      kamera: vp?.style.transform ?? "",
      höjd: Math.round(Math.max(0, ...botten)),
      störstaBana: Math.round(Math.max(0, ...höjder)),
    };
  });
}

/**
 * Är banbandet `index` synligt i fönstret? Efter ett drag ska man ha kvar sin
 * plats – att HELA dokumentet syns går inte att kräva, för ett diagram som
 * vuxit ryms inte ens vid minZoom.
 */
export function bandSynligt(page: Page, index: number): Promise<boolean> {
  return page.evaluate((i) => {
    const el = document.querySelectorAll<HTMLElement>(".react-flow__node-lane")[i];
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }, index);
}

/** Antal objekt som React Flow gömt i väntan på mätning. Ska alltid vara noll. */
export function gömdaObjekt(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>(".react-flow__node")].filter(
        (n) => getComputedStyle(n).visibility === "hidden",
      ).length,
  );
}

/** Objektens transform, i ritytans koordinater – oberoende av var kameran står. */
export function objektPositioner(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const ut: Record<string, string> = {};
    for (const n of document.querySelectorAll<HTMLElement>(".react-flow__node-process")) {
      ut[n.getAttribute("data-id") ?? ""] = n.style.transform;
    }
    return ut;
  });
}

/**
 * Drar det första processobjekt som muspekaren faktiskt NÅR, och returnerar
 * dess id samt transform före och efter.
 *
 * Att bara ta `.first()` räcker inte: objektet kan ligga under panelen, i
 * kanten av rutan eller bakom ett annat lager, och då hamnar musnedslaget
 * någon annanstans och testet påstår att draget inte fungerade. Vi kontrollerar
 * med elementFromPoint innan vi drar.
 */
export async function draObjekt(
  page: Page,
): Promise<{ id: string; före: string; efter: string }> {
  const kandidater = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".react-flow__node-process")]
      .map((n) => {
        const r = n.getBoundingClientRect();
        return { id: n.getAttribute("data-id") ?? "", x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width };
      })
      // Håll god marginal till fönsterkanterna, annars går det inte att dra.
      .filter((k) => k.w > 8 && k.x > 620 && k.x < innerWidth - 200 && k.y > 120 && k.y < innerHeight - 200)
      .filter((k) => {
        const träff = document.elementFromPoint(k.x, k.y);
        return !!träff?.closest(`.react-flow__node-process[data-id="${k.id}"]`);
      }),
  );
  if (!kandidater.length) throw new Error("hittade inget dragbart objekt i vyn");
  const mål = kandidater[0];

  const läs = () =>
    page.evaluate(
      (id) =>
        document.querySelector<HTMLElement>(`.react-flow__node-process[data-id="${id}"]`)?.style.transform ?? "",
      mål.id,
    );
  const före = await läs();

  await page.mouse.move(mål.x, mål.y);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) {
    await page.mouse.move(mål.x + i * 6, mål.y + i * 3);
    await page.waitForTimeout(10);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);

  return { id: mål.id, före, efter: await läs() };
}

/** Byter sidformat – det ligger under rullgardinen Vy i verktygsraden. */
export async function väljFormat(page: Page, etikett: string): Promise<void> {
  const vy = page.locator(".ark-rullgardin", { has: page.locator("button.ark-vrad-knapp", { hasText: /^Vy/ }) });
  const knapp = vy.locator("button.ark-vrad-knapp").first();
  if ((await knapp.getAttribute("aria-expanded")) !== "true") await knapp.click();
  await vy.locator(".ark-toggle button", { hasText: new RegExp(`^${etikett}$`) }).first().click();
  await page.keyboard.press("Escape"); // stäng panelen, så att den inte ligger över ritytan
  await page.waitForTimeout(700); // in-ramningen är animerad
}

/**
 * Index på ett banhandtag som muspekaren faktiskt når.
 *
 * `.first()` duger inte: löper en kant längs en banas kant lägger kantens
 * osynliga träffyta sig över handtaget, och då når klicket aldrig fram. Det är
 * ett verkligt problem – men ett annat än det testet mäter.
 */
export async function grabbartHandtag(page: Page): Promise<number> {
  const i = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".ark-lane-resize")].findIndex((h) => {
      const r = h.getBoundingClientRect();
      if (r.width < 40 || r.bottom < 0 || r.top > innerHeight) return false;
      // Prova EXAKT den punkt som ett klick träffar: elementets mitt. Provas
      // en annan punkt kan handtaget se åtkomligt ut och ändå vara blockerat.
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === h;
    }),
  );
  if (i < 0) throw new Error("hittade inget åtkomligt banhandtag");
  return i;
}

/**
 * Drar i en banas nederkant. `steg` är antal musrörelser, `px` per rörelse –
 * negativt drar uppåt (minskar). Det MÅSTE vara många små rörelser: en enda
 * stor hoppar över felet där varje rörelse byggde vidare på föregående.
 */
export async function draBana(
  page: Page,
  index: number,
  steg: number,
  px: number,
): Promise<void> {
  const handtag = page.locator(".ark-lane-resize").nth(index);
  const box = await handtag.boundingBox();
  if (!box) throw new Error(`banhandtag ${index} är inte synligt`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= steg; i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + i * px);
    await page.waitForTimeout(6);
  }
  await page.mouse.up();
  await page.waitForTimeout(700); // låt in-ramningen animera klart
}

/** Fingeravtryck av en flödeskatalog – testerna får aldrig ändra de sparade flödena. */
export function flödenFingeravtryck(dir: string): string {
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .sort()
    .map((f) => {
      const s = statSync(join(dir, f));
      return `${f}:${s.size}:${s.mtimeMs}`;
    })
    .join("|");
}
