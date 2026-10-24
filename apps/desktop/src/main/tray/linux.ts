import { DESKTOP_ID, desktopEntryFiles } from "@repo/core/store";
import { app } from "electron";
import { homedir } from "node:os";
import { APP_ICON } from "../window.ts";
import { syncDesktopEntry } from "./desktop-entry.ts";
import { tunnelLayers } from "./glyph.ts";
import { imageOf } from "./images.ts";
import type { TrayPlatform } from "./index.ts";

/**
 * Linux: the tray icon is white, for GNOME's top bar, which stays dark in light mode too. The count goes on the dock
 * icon through the LauncherEntry D-Bus API, in the dock's own color, which needs a desktop entry. Without a tray
 * (no AppIndicator extension), starting the app again shows the window.
 */
export const linuxTray: TrayPlatform = {
  registerDesktopApp() {
    app.setDesktopName(`${DESKTOP_ID}.desktop`);
    // Only a packaged build: a development one would point the user's app grid at a checkout.
    if (!app.isPackaged) return;
    const command: [string, ...string[]] = [process.execPath, ...(app.commandLine.hasSwitch("no-sandbox") ? ["--no-sandbox"] : [])];
    syncDesktopEntry({ files: desktopEntryFiles(process.env, homedir()), command, iconSource: APP_ICON }).catch((error: unknown) => {
      console.error("Couldn't write the desktop entry, so the dock shows no count:", error);
    });
  },
  // GNOME's symbolic icons leave room inside their 16px box; without the margin the tunnel looks a size larger.
  icon: (count, hasUpdate) => imageOf(tunnelLayers(count, [255, 255, 255], hasUpdate), 16, 6),
  badge(count) {
    app.setBadgeCount(count);
  },
  // Electron reports the desktop activating the icon as a click; a desktop that opens the menu instead sends none.
  clickOpens: true,
  quitShortcut: undefined,
};
