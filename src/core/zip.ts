/**
 * ZIP-arkiv utan komprimering ("stored") – det minsta som behövs för att
 * skriva en fil som andra program packar upp, utan ett beroende.
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

/** Packar filerna (sökväg → innehåll) i ett arkiv. Ordningen följs. */
export function packaZip(filer: Record<string, string | Uint8Array>, när = new Date()): Uint8Array {
  const kod = new TextEncoder();
  const { tid, datum } = dosTid(när);
  const delar: Uint8Array[] = [];
  const katalog: Uint8Array[] = [];
  let pos = 0;

  for (const [namn, innehåll] of Object.entries(filer)) {
    const n = kod.encode(namn);
    const data = typeof innehåll === "string" ? kod.encode(innehåll) : innehåll;
    const crc = crc32(data);

    const lokal = new DataView(new ArrayBuffer(30));
    lokal.setUint32(0, 0x04034b50, true);
    lokal.setUint16(4, 20, true); // version som behövs
    lokal.setUint16(6, 0x0800, true); // UTF-8-namn
    lokal.setUint16(8, 0, true); // stored
    lokal.setUint16(10, tid, true);
    lokal.setUint16(12, datum, true);
    lokal.setUint32(14, crc, true);
    lokal.setUint32(18, data.length, true);
    lokal.setUint32(22, data.length, true);
    lokal.setUint16(26, n.length, true);
    lokal.setUint16(28, 0, true);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true); // skapad av
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, tid, true);
    central.setUint16(14, datum, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, n.length, true);
    central.setUint32(42, pos, true); // lokala huvudets plats

    delar.push(new Uint8Array(lokal.buffer), n, data);
    katalog.push(new Uint8Array(central.buffer), n);
    pos += 30 + n.length + data.length;
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
