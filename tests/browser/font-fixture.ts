// A minimal TrueType font built in memory for font-loading tests: every printable ASCII character is a box.
// It replaces any font file of a dependency whose name or presence can change between versions.
const tag = (name: string) => [...name].map(c => c.charCodeAt(0));

class Writer {
  readonly bytes: number[] = [];

  u8(...values: number[]) {
    for (const v of values)
      this.bytes.push(v & 0xff);

    return this;
  }

  u16(...values: number[]) {
    for (const v of values)
      this.u8(v >> 8, v);

    return this;
  }

  u32(...values: number[]) {
    for (const v of values)
      this.u16(v >>> 16, v & 0xffff);

    return this;
  }

  zeros(count: number) {
    for (let i = 0; i < count; i++)
      this.bytes.push(0);

    return this;
  }
}

function checksum(bytes: number[]): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4)
    sum = (sum + (((bytes[i] << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0)) >>> 0)) >>> 0;

  return sum;
}

export function fixtureFont(family = 'BlazorEChartsFixture'): Buffer {
  const first = 0x20;
  const last = 0x7e;
  const glyphs = last - first + 2;

  // A clockwise box: (50,0) (50,700) (550,700) (550,0), all on-curve, 16-bit deltas.
  const box = new Writer().u16(1, 50, 0, 550, 700, 3, 0).u8(1, 1, 1, 1).u16(50, 0, 500, 0, 0, 700, 0, -700 & 0xffff).u16(0).bytes;
  const glyf = Array.from({ length: glyphs - 1 }, () => box).flat();
  const loca = new Writer().u16(0, ...Array.from({ length: glyphs }, (_, i) => i * box.length / 2)).bytes;
  const head = new Writer().u32(0x00010000, 0x00010000, 0, 0x5f0f3cf5).u16(0x000b, 1000).zeros(16).u16(50, 0, 550, 700, 0, 8, 2, 0, 0).bytes;
  const hhea = new Writer().u32(0x00010000).u16(800, -200 & 0xffff, 0, 600, 50, 50, 550, 1, 0, 0, 0, 0, 0, 0, 0, glyphs).bytes;
  const maxp = new Writer().u32(0x00010000).u16(glyphs, 4, 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0).bytes;
  const hmtx = new Writer().u16(...Array.from({ length: glyphs }, () => [600, 50]).flat()).bytes;
  const cmap = new Writer()
    .u16(0, 1, 3, 1)
    .u32(12)
    .u16(4, 32, 0, 4, 4, 1, 0, last, 0xffff, 0, first, 0xffff, (1 - first) & 0xffff, 1, 0, 0).bytes;
  const names: [number, string][] = [
    [1, family],
    [2, 'Regular'],
    [3, `${family}-Regular`],
    [4, family],
    [5, 'Version 1.0'],
    [6, `${family}-Regular`],
  ];
  const strings = names.map(([, text]) => [...text].flatMap(c => [0, c.charCodeAt(0)]));
  const name = new Writer().u16(0, names.length, 6 + 12 * names.length);
  let offset = 0;
  names.forEach(([id], i) => {
    name.u16(3, 1, 0x409, id, strings[i].length, offset);
    offset += strings[i].length;
  });
  name.u8(...strings.flat());
  const os2 = new Writer()
    .u16(4, 600, 400, 5, 0, 650, 600, 0, 75, 650, 600, 0, 350, 50, 300, 0)
    .zeros(10)
    .u32(1, 0, 0, 0)
    .u8(...tag('NONE'))
    .u16(0x40, first, last, 800, -200 & 0xffff, 0, 800, 200)
    .u32(1, 0)
    .u16(500, 700, 0, 0x20, 1).bytes;
  const post = new Writer().u32(0x00030000, 0).u16(-100 & 0xffff, 50).u32(0, 0, 0, 0, 0).bytes;

  const tables: [string, number[]][] = [
    ['OS/2', os2],
    ['cmap', cmap],
    ['glyf', glyf],
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx],
    ['loca', loca],
    ['maxp', maxp],
    ['name', name.bytes],
    ['post', post],
  ];
  const font = new Writer().u32(0x00010000).u16(tables.length, 128, 3, tables.length * 16 - 128);
  let position = 12 + 16 * tables.length;
  const body: number[] = [];
  for (const [id, data] of tables) {
    font.u8(...tag(id)).u32(checksum(data), position, data.length);
    const padded = [...data, ...new Array((4 - data.length % 4) % 4).fill(0)];
    body.push(...padded);
    position += padded.length;
  }

  const bytes = [...font.bytes, ...body];

  // head.checkSumAdjustment makes the checksum of the whole font 0xB1B0AFBA.
  const adjustment = (0xb1b0afba - checksum(bytes)) >>> 0;
  const headAt = 12 + 16 * tables.length + tables.slice(0, 3).reduce((sum, [, data]) => sum + data.length + (4 - data.length % 4) % 4, 0) + 8;
  bytes.splice(headAt, 4, adjustment >>> 24, (adjustment >>> 16) & 0xff, (adjustment >>> 8) & 0xff, adjustment & 0xff);
  return Buffer.from(bytes);
}
