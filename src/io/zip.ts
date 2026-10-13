// A minimal ZIP writer: files are stored uncompressed (method 0), which every reader accepts,
// including Office for .vsdx packages. Pure, no DOM.

export interface ZipEntry {
  /** Path inside the archive, with forward slashes. */
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
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
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Builds a ZIP archive containing `entries`, in order. */
export function zip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const parts = entries.map((e) => ({ name: enc.encode(e.name), data: e.data, crc: crc32(e.data) }));
  const localSize = parts.reduce((s, p) => s + 30 + p.name.length + p.data.length, 0);
  const centralSize = parts.reduce((s, p) => s + 46 + p.name.length, 0);
  const out = new Uint8Array(new ArrayBuffer(localSize + centralSize + 22));
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (v: number) => {
    view.setUint16(at, v, true);
    at += 2;
  };
  const u32 = (v: number) => {
    view.setUint32(at, v, true);
    at += 4;
  };
  const bytes = (b: Uint8Array) => {
    out.set(b, at);
    at += b.length;
  };
  // Fixed DOS timestamp (1 Jan 2020, 00:00): keeps output deterministic.
  const TIME = 0;
  const DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
  const UTF8 = 0x0800;

  const offsets: number[] = [];
  for (const p of parts) {
    offsets.push(at);
    u32(0x04034b50);
    u16(20); // version needed
    u16(UTF8);
    u16(0); // stored
    u16(TIME);
    u16(DATE);
    u32(p.crc);
    u32(p.data.length);
    u32(p.data.length);
    u16(p.name.length);
    u16(0);
    bytes(p.name);
    bytes(p.data);
  }
  const centralStart = at;
  parts.forEach((p, i) => {
    u32(0x02014b50);
    u16(20); // version made by
    u16(20); // version needed
    u16(UTF8);
    u16(0);
    u16(TIME);
    u16(DATE);
    u32(p.crc);
    u32(p.data.length);
    u32(p.data.length);
    u16(p.name.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk
    u16(0); // internal attrs
    u32(0); // external attrs
    u32(offsets[i]);
    bytes(p.name);
  });
  const centralLength = at - centralStart;
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(parts.length);
  u16(parts.length);
  u32(centralLength);
  u32(centralStart);
  u16(0);
  return out;
}

/**
 * Reads back an archive written by `zip` (stored entries only), checking each CRC. Used to
 * inspect generated packages in tests.
 */
export function readZip(buf: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = buf.length - 22;
  if (v.getUint32(end, true) !== 0x06054b50) throw new Error('Not a ZIP archive (or it has a comment)');
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  // Strict readers (Office, Python) locate the directory from its size too.
  if (at + v.getUint32(end + 12, true) !== end) throw new Error('Central directory size/offset mismatch');
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new Error('Bad central directory');
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch in ${name}`);
    out.set(name, data);
    at += 46 + nameLen + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  return out;
}
