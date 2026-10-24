import { nativeTheme } from "electron";
import { countLabel, type Layer, numeral, point, tunnelLayers } from "./glyph.ts";
import { imageOf } from "./images.ts";
import type { TrayPlatform } from "./index.ts";
import { countHeadline } from "./menu.ts";

/**
 * Windows: the tray doesn't recolor icons, so it's drawn white or black for the taskbar's theme. The taskbar has no
 * count badge, so the count is a red overlay drawn on the app's button. A click on the tray icon opens the window.
 */
export const win32Tray: TrayPlatform = {
  registerDesktopApp() {},
  icon: (count) => imageOf(tunnelLayers(count, nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ? [255, 255, 255] : [0, 0, 0]), 16),
  badge(count, window) {
    window.setOverlayIcon(count > 0 ? imageOf(badgeLayers(count), 16) : null, count > 0 ? countHeadline(count) : "");
  },
  clickOpens: true,
  quitShortcut: undefined,
};

/** The taskbar badge: a red disc with a dark rim, so it stays apart from the app icon under it, and the white count. */
function badgeLayers(count: number): Layer[] {
  const label = countLabel(count);
  const digits = label.length > 1 ? { strokes: numeral(label, 32, 42, 0.75), width: 5 } : { strokes: numeral(label, 32, 45, 1), width: 6 };
  return [
    { strokes: [point(32, 32)], width: 64, color: [28, 28, 28] },
    { strokes: [point(32, 32)], width: 56, color: [209, 52, 56] },
    { ...digits, color: [255, 255, 255] },
  ];
}
