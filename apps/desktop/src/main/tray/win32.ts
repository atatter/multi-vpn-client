import { nativeTheme } from "electron";
import { badgeLayers, tunnelLayers } from "./glyph.ts";
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
