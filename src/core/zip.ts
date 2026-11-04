/**
 * ZIP-arkiv – det minsta som behövs för att skriva en fil som andra program
 * packar upp, utan ett beroende. Okomprimerat ("stored") eller komprimerat
 * ("deflate", med plattformens `CompressionStream`, som både webbläsaren och
 * Node har).
 *
 * Varje post bär sin storlek och CRC i det lokala huvudet (ingen
 * "data descriptor"), så att även en strömmande läsare (Javas
 * ZipInputStream) klarar posterna. Namnen skrivs som UTF-8 (flagga 11).
 */

const CRC_TABELL = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABELL[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS-tid och -datum för en tidpunkt (lokal tid, som zip-program läser den). */
function dosTid(d: Date): { tid: number; datum: number } {
  return {
    tid: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    datum: (Math.max(d.getFullYear() - 1980, 0) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const ström = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(ström).arrayBuffer());
}

/** Packar filerna (sökväg → innehåll) i ett arkiv. Ordningen följs. */
export async function packaZip(
  filer: Record<string, string | Uint8Array>,
  när = new Date(),
  { komprimera = false }: { komprimera?: boolean } = {},
): Promise<Uint8Array> {
  const kod = new TextEncoder();
  const { tid, datum } = dosTid(när);
  const delar: Uint8Array[] = [];
  const katalog: Uint8Array[] = [];
  let pos = 0;

  for (const [namn, innehåll] of Object.entries(filer)) {
    const n = kod.encode(namn);
    const data = typeof innehåll === "string" ? kod.encode(innehåll) : innehåll;
    const crc = crc32(data);
    const packad = komprimera ? await deflate(data) : data;
    const metod = komprimera ? 8 : 0;

    const lokal = new DataView(new ArrayBuffer(30));
    lokal.setUint32(0, 0x04034b50, true);
    lokal.setUint16(4, 20, true); // version som behövs
    lokal.setUint16(6, 0x0800, true); // UTF-8-namn
    lokal.setUint16(8, metod, true);
    lokal.setUint16(10, tid, true);
    lokal.setUint16(12, datum, true);
    lokal.setUint32(14, crc, true);
    lokal.setUint32(18, packad.length, true);
    lokal.setUint32(22, data.length, true);
    lokal.setUint16(26, n.length, true);
    lokal.setUint16(28, 0, true);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true); // skapad av
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, metod, true);
    central.setUint16(12, tid, true);
    central.setUint16(14, datum, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, packad.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, n.length, true);
    central.setUint32(42, pos, true); // lokala huvudets plats

    delar.push(new Uint8Array(lokal.buffer), n, packad);
    katalog.push(new Uint8Array(central.buffer), n);
    pos += 30 + n.length + packad.length;
  }

  const katalogStorlek = katalog.reduce((s, d) => s + d.length, 0);
  const slut = new DataView(new ArrayBuffer(22));
  slut.setUint32(0, 0x06054b50, true);
  slut.setUint16(8, Object.keys(filer).length, true);
  slut.setUint16(10, Object.keys(filer).length, true);
  slut.setUint32(12, katalogStorlek, true);
  slut.setUint32(16, pos, true);

  const alla = [...delar, ...katalog, new Uint8Array(slut.buffer)];
  const ut = new Uint8Array(alla.reduce((s, d) => s + d.length, 0));
  let i = 0;
  for (const d of alla) {
    ut.set(d, i);
    i += d.length;
  }
  return ut;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ström = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(ström).arrayBuffer());
}

/**
 * Packar upp ett arkiv (sökväg → innehåll). Läser den centrala katalogen, så
 * poster med "data descriptor" (storleken efter datat) går också bra.
 * Klarar okomprimerat och deflate – det andra program skriver. Kastar ett
 * begripligt fel för en fil som inte är ett zip-arkiv.
 */
export async function läsZip(arkiv: Uint8Array): Promise<Record<string, Uint8Array>> {
  const dv = new DataView(arkiv.buffer, arkiv.byteOffset, arkiv.byteLength);
  let slut = -1;
  for (let i = arkiv.length - 22; i >= Math.max(0, arkiv.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      slut = i;
      break;
    }
  }
  if (slut < 0) throw new Error("Filen är inte ett zip-arkiv.");
  const antal = dv.getUint16(slut + 10, true);
  let pos = dv.getUint32(slut + 16, true);
  const avkod = new TextDecoder();
  const ut: Record<string, Uint8Array> = {};
  for (let i = 0; i < antal; i++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error("Arkivets katalog är trasig.");
    const metod = dv.getUint16(pos + 10, true);
    const packadStorlek = dv.getUint32(pos + 20, true);
    const namnLängd = dv.getUint16(pos + 28, true);
    const extraLängd = dv.getUint16(pos + 30, true);
    const kommentarLängd = dv.getUint16(pos + 32, true);
    const lokal = dv.getUint32(pos + 42, true);
    const namn = avkod.decode(arkiv.subarray(pos + 46, pos + 46 + namnLängd));
    pos += 46 + namnLängd + extraLängd + kommentarLängd;
    if (namn.endsWith("/")) continue;
    const start = lokal + 30 + dv.getUint16(lokal + 26, true) + dv.getUint16(lokal + 28, true);
    const data = arkiv.subarray(start, start + packadStorlek);
    if (metod === 0) ut[namn] = data.slice();
    else if (metod === 8) ut[namn] = await inflate(data);
    else throw new Error(`Okänd komprimering i ${namn}.`);
  }
  return ut;
}
