import { describe, expect, it } from 'vitest';
import { crc32, readZip, zip } from './zip';

const enc = new TextEncoder();

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes entries that read back intact, in order, with UTF-8 names', () => {
    const buf = zip([
      { name: '[Content_Types].xml', data: enc.encode('<Types/>') },
      { name: 'dir/ünïcode.txt', data: enc.encode('héllo') },
      { name: 'empty', data: new Uint8Array() },
    ]);
    expect(buf[0]).toBe(0x50); // "PK"
    expect(buf[1]).toBe(0x4b);
    const back = readZip(buf);
    expect([...back.keys()]).toEqual(['[Content_Types].xml', 'dir/ünïcode.txt', 'empty']);
    expect([...back.values()].map((d) => new TextDecoder().decode(d))).toEqual(['<Types/>', 'héllo', '']);
  });
});
