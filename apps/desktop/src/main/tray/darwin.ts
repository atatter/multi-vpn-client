import { app } from "electron";
import { countLabel, tunnelLayers } from "./glyph.ts";
import { imageOf } from "./images.ts";
import type { TrayPlatform } from "./index.ts";

/**
 * macOS: a template image, which the menu bar colors for its light or dark look, and the Dock's own red badge.
 * `dock.setBadge` rather than `app.setBadgeCount`, which can only show a number, not "9+".
 */
export const darwinTray: TrayPlatform = {
  registerDesktopApp() {},
  icon(count, hasUpdate) {
    // Menu bar icons fill their 16 pt square; the tunnel leaves room around itself, so it's drawn a little larger.
    const image = imageOf(tunnelLayers(count, [0, 0, 0], hasUpdate), 16, -3);
    image.setTemplateImage(true);
    return image;
  },
  watchColors() {},
  badge(count) {
    app.dock?.setBadge(countLabel(count));
  },
  clickOpens: false,
  quitShortcut: "Command+Q",
};
