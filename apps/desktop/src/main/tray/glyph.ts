import { crc32, deflateSync } from 'node:zlib';

// The tray icon, the menu's dot and the strokes win32.ts draws its taskbar badge from, at whatever size each OS asks for.
// Electron only loads PNG and JPEG, so a count can't come from an SVG; everything is round-capped strokes on a
// 64-unit square. The tunnel is resources/icon.svg's, wider and without its lanes, to fit the count.

type Point = readonly [x: number, y: number];
/** A centerline: a straight line, or a circular arc from `from` to `to` degrees, clockwise (y points down). */
type Stroke =
  | { line: readonly [Point, Point] }
  | { arc: { center: Point; radius: number; from: number; to: number } };
/** Opaque strokes of one width and color; a later layer paints over an earlier one. */
export interface Layer {
  strokes: Stroke[];
  width: number;
  color: Rgb;
}
export type Rgb = readonly [r: number, g: number, b: number];

const VIEW = 64;
const TUNNEL: Stroke[] = [
  {
    line: [
      [10, 56],
      [10, 32],
    ],
  },
  { arc: { center: [32, 32], radius: 22, from: 180, to: 360 } },
  {
    line: [
      [54, 32],
      [54, 56],
    ],
  },
];

const line = (x1: number, y1: number, x2: number, y2: number): Stroke => ({
  line: [
    [x1, y1],
    [x2, y2],
  ],
});
const arc = (center: Point, radius: number, from: number, to: number): Stroke => ({
  arc: { center, radius, from, to },
});
export const point = (x: number, y: number): Stroke => line(x, y, x, y);

// Numerals in an 18 × 26 box, baseline at 26: a rounded geometric face that matches the tunnel's strokes.
const NUMERAL_WIDTH = 18;
const NUMERAL_HEIGHT = 26;
const NUMERALS: Record<string, Stroke[]> = {
  '0': [arc([9, 9], 9, 180, 360), line(18, 9, 18, 17), arc([9, 17], 9, 0, 180), line(0, 17, 0, 9)],
  '1': [line(9, 0, 9, 26), line(9, 0, 3, 5)],
  '2': [arc([9, 9], 9, 180, 395), line(16.4, 14.2, 0, 26), line(0, 26, 18, 26)],
  '3': [line(1, 0, 17, 0), line(17, 0, 7.5, 9.1), arc([9, 17.5], 8.5, 260, 510)],
  '4': [line(13, 26, 13, 0), line(13, 0, 0, 18), line(0, 18, 18, 18)],
  '5': [line(17, 0, 2, 0), line(2, 0, 2, 12.6), arc([9, 17.5], 8.5, 215, 510)],
  '6': [line(14, 0, 1.6, 13.3), arc([9, 17.5], 8.5, 0, 360)],
  '7': [line(0, 0, 18, 0), line(18, 0, 6, 26)],
  '8': [arc([9, 5.75], 5.75, 0, 360), arc([9, 18.75], 7.25, 0, 360)],
  '9': [arc([9, 8.5], 8.5, 0, 360), line(16.4, 12.7, 4, 26)],
  '+': [line(1, 15, 17, 15), line(9, 7, 9, 23)],
};

/** What the count reads as: nothing at 0, "9+" from 10, so it always fits. */
export const countLabel = (count: number) => {
  if (count <= 0) {
    return '';
  }

  return count > 9 ? '9+' : String(count);
};

/** A label's strokes, centered on `centerX` and sitting on `baseline`, `scale` times the 18 × 26 box. */
export function numeral(label: string, centerX: number, baseline: number, scale: number): Stroke[] {
  const gap = 4;
  const width = label.length * NUMERAL_WIDTH + (label.length - 1) * gap;
  const left = centerX - (width * scale) / 2;
  const top = baseline - NUMERAL_HEIGHT * scale;
  const place = ([x, y]: Point, offset: number): Point => [
    left + (offset + x) * scale,
    top + y * scale,
  ];

  return [...label].flatMap((char, index) => {
    const offset = index * (NUMERAL_WIDTH + gap);
    return (NUMERALS[char] ?? []).map((stroke): Stroke => {
      if ('line' in stroke) {
        return { line: [place(stroke.line[0], offset), place(stroke.line[1], offset)] };
      }

      const { center, radius, from, to } = stroke.arc;
      return { arc: { center: place(center, offset), radius: radius * scale, from, to } };
    });
  });
}

/**
 * The tray icon: the tunnel with the count inside, one color on transparent. `hasUpdate` adds a dot on the arch's
 * top-right shoulder. It joins the arch: a dot standing free above the right leg reads as an "i" at 16 px.
 */
export function tunnelLayers(count: number, color: Rgb, hasUpdate: boolean): Layer[] {
  const label = countLabel(count);
  const digits =
    label.length > 1
      ? { strokes: numeral(label, 32, 51, 0.46), width: 4 }
      : { strokes: numeral(label, 32, 51, 0.7), width: 5 };
  return [
    { strokes: TUNNEL, width: 7, color },
    { ...digits, color },
    ...(hasUpdate ? [{ strokes: [point(50, 14)], width: 24, color }] : []),
  ];
}

/** The menu's mark for a VPN that's on. */
export const dotLayers = (color: Rgb): Layer[] => [{ strokes: [point(32, 32)], width: 28, color }];

function distance([x, y]: Point, stroke: Stroke): number {
  if ('line' in stroke) {
    const [[ax, ay], [bx, by]] = stroke.line;
    const [dx, dy] = [bx - ax, by - ay];
    const along = Math.max(
      0,
      Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)),
    );
    return Math.hypot(x - ax - along * dx, y - ay - along * dy);
  }

  const {
    center: [cx, cy],
    radius,
    from,
    to,
  } = stroke.arc;
  const angle = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
  if ((((angle - from) % 360) + 360) % 360 <= to - from) {
    return Math.abs(Math.hypot(x - cx, y - cy) - radius);
  }

  const end = (degrees: number): Point => [
    cx + radius * Math.cos((degrees * Math.PI) / 180),
    cy + radius * Math.sin((degrees * Math.PI) / 180),
  ];

  return Math.min(
    Math.hypot(x - end(from)[0], y - end(from)[1]),
    Math.hypot(x - end(to)[0], y - end(to)[1]),
  );
}

const SAMPLES = 4;

/**
 * Rasterizes layers into a `size`-pixel square of straight (not premultiplied) RGBA, 4 × 4 samples per pixel, with
 * `margin` design units of empty space around the 64-unit square; a negative margin crops into it instead.
 */
export function rasterize(layers: Layer[], size: number, margin = 0): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const unit = (VIEW + 2 * margin) / size;

  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      let [r, g, b, covered] = [0, 0, 0, 0];

      for (let sample = 0; sample < SAMPLES * SAMPLES; sample++) {
        const at: Point = [
          (column + ((sample % SAMPLES) + 0.5) / SAMPLES) * unit - margin,
          (row + (Math.floor(sample / SAMPLES) + 0.5) / SAMPLES) * unit - margin,
        ];
        const top = layers.findLast((layer) =>
          layer.strokes.some((stroke) => distance(at, stroke) <= layer.width / 2),
        );
        if (!top) {
          continue;
        }

        [r, g, b, covered] = [r + top.color[0], g + top.color[1], b + top.color[2], covered + 1];
      }

      if (covered === 0) {
        continue;
      }

      pixels.set(
        [r / covered, g / covered, b / covered, (255 * covered) / (SAMPLES * SAMPLES)].map(
          Math.round,
        ),
        (row * size + column) * 4,
      );
    }
  }

  return pixels;
}

/** A PNG of a `size`-pixel square of RGBA, which nativeImage reads at any scale factor. */
export function encodePng(pixels: Uint8Array, size: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const framed = Buffer.alloc(body.length + 8);
    framed.writeUInt32BE(data.length, 0);
    body.copy(framed, 4);
    framed.writeUInt32BE(crc32(body), body.length + 4);

    return framed;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits per channel, RGBA, no interlacing
  // Each row starts with its filter type, 0 (none).
  const rows = Buffer.alloc(size * (size * 4 + 1));

  for (let row = 0; row < size; row++) {
    rows.set(pixels.subarray(row * size * 4, (row + 1) * size * 4), row * (size * 4 + 1) + 1);
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
