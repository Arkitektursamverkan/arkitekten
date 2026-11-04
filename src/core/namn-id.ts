/**
 * UUID ur ett NAMN (RFC 4122 version 5, SHA-1) – samma namn ger alltid samma
 * id. Det är så en export till ett annat verktyg kan uppdatera det den
 * exporterat förut i stället för att skapa en kopia: id:t härleds ur något
 * stabilt (flödets id + objektets id), aldrig ur en räknare eller slumpen
 * (invariant 2).
 */

function sha1(data: Uint8Array): Uint8Array {
  const ml = data.length * 8;
  const längd = (((data.length + 9 + 63) >> 6) << 6);
  const m = new Uint8Array(längd);
  m.set(data);
  m[data.length] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(längd - 4, ml >>> 0);
  dv.setUint32(längd - 8, Math.floor(ml / 2 ** 32));
  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  for (let off = 0; off < längd; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20
          ? [(b & c) | (~b & d), 0x5a827999]
          : i < 40
            ? [b ^ c ^ d, 0x6ed9eba1]
            : i < 60
              ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
              : [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      [e, d, c, b, a] = [d, c, rotl(b, 30) >>> 0, a, t];
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const ut = new Uint8Array(20);
  const udv = new DataView(ut.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => udv.setUint32(i * 4, h));
  return ut;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** UUID v5 för `namn` i namnrymden `rymd` (själv ett UUID). */
export function uuidUrNamn(rymd: string, namn: string): string {
  const r = rymd.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(r)) throw new Error(`Ogiltig namnrymd: ${rymd}`);
  const rb = new Uint8Array(r.match(/../g)!.map((x) => parseInt(x, 16)));
  const nb = new TextEncoder().encode(namn);
  const indata = new Uint8Array(rb.length + nb.length);
  indata.set(rb);
  indata.set(nb, rb.length);
  const h = sha1(indata).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const s = hex(h);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
