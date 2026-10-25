import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { countLabel, encodePng, rasterize, tunnelLayers } from './glyph.ts';

/** How much ink a 32px tray icon has inside the tunnel, where the count goes. */
const inkInside = (count: number) => {
  const pixels = rasterize(tunnelLayers(count, [0, 0, 0], false), 32);
  let ink = 0;

  for (let row = 12; row < 30; row++) {
    for (let column = 8; column < 24; column++) {
      ink += pixels[(row * 32 + column) * 4 + 3] ?? 0;
    }
  }

  return ink;
};

describe('the count', () => {
  it('reads as nothing at 0, the number up to 9, and 9+ from 10', () => {
    expect([0, 1, 9, 10, 42].map(countLabel)).toEqual(['', '1', '9', '9+', '9+']);
  });

  it('leaves the tunnel empty at 0 and fills it otherwise', () => {
    expect(inkInside(0)).toBe(0);

    for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(inkInside(count)).toBeGreaterThan(0);
    }
  });

  it('looks different for every label', () => {
    const drawn = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((count) =>
      Buffer.from(rasterize(tunnelLayers(count, [0, 0, 0], false), 32)).toString('base64'),
    );
    expect(new Set(drawn).size).toBe(drawn.length);
  });
});

describe('the update dot', () => {
  it("sits on the arch's top-right shoulder, and only while there's an update", () => {
    // The alpha of one pixel of a 32px icon: row 3, column 27, outside the arch.
    const shoulder = (update: boolean) =>
      rasterize(tunnelLayers(2, [0, 0, 0], update), 32)[(3 * 32 + 27) * 4 + 3];
    expect(shoulder(false)).toBe(0);
    expect(shoulder(true)).toBe(255);
  });
});

describe('encodePng', () => {
  it('writes a PNG that holds exactly the pixels', () => {
    const pixels = rasterize(tunnelLayers(3, [255, 255, 255], false), 16);
    const png = encodePng(pixels, 16);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([16, 16]);
    // Chunks after the header: IHDR (13 bytes + 12 framing), then IDAT.
    const idatLength = png.readUInt32BE(33);
    expect(png.toString('latin1', 37, 41)).toBe('IDAT');
    const rows = inflateSync(png.subarray(41, 41 + idatLength));
    const unfiltered = Buffer.concat(
      Array.from({ length: 16 }, (_, row) => rows.subarray(row * 65 + 1, (row + 1) * 65)),
    );
    expect(unfiltered.equals(Buffer.from(pixels))).toBe(true);
  });
});
