import { nativeImage } from "electron";
import { encodePng, type Layer, rasterize } from "./glyph.ts";

/** Layers drawn `size` points square, sharp on 1× and 2× screens; `margin` (design units) leaves room around them. */
export function imageOf(layers: Layer[], size: number, margin = 0) {
  const image = nativeImage.createFromBuffer(encodePng(rasterize(layers, size, margin), size), { scaleFactor: 1 });
  const double = encodePng(rasterize(layers, size * 2, margin), size * 2);
  image.addRepresentation({ scaleFactor: 2, dataURL: `data:image/png;base64,${double.toString("base64")}` });
  return image;
}
