import { APP_NAME, type Config, type ConnectionStatus } from "@repo/core";
import { type BrowserWindow, Menu, type NativeImage, nativeTheme, Tray } from "electron";
import type { AppInfo } from "../../shared/ipc-contract.ts";
import { platform } from "../window.ts";
import { darwinTray } from "./darwin.ts";
import { dotLayers } from "./glyph.ts";
import { imageOf } from "./images.ts";
import { linuxTray } from "./linux.ts";
import { countHeadline, idsOn, namesOn, trayMenu } from "./menu.ts";
import { win32Tray } from "./win32.ts";

/** What each OS does its own way: the tray icon's colors, the count on the app's own icon, a click on the tray. */
export interface TrayPlatform {
  /** Names the app to the desktop, so the dock can match its window and badge it. Runs before the app is ready. */
  registerDesktopApp(): void;
  /** The tray icon with this many VPNs on. */
  icon(count: number): NativeImage;
  /** Shows the count on the app's icon in the Dock or taskbar; 0 clears it. */
  badge(count: number, window: BrowserWindow): void;
  /** Whether a click on the tray icon opens the window. Where it doesn't, the click opens the menu. */
  clickOpens: boolean;
  /** The quit shortcut the menu shows, where the app has one. */
  quitShortcut: string | undefined;
}

const PLATFORMS: Record<AppInfo["platform"], TrayPlatform> = { darwin: darwinTray, linux: linuxTray, win32: win32Tray };
export const trayPlatform = PLATFORMS[platform()];

/**
 * The tray icon with the number of VPNs that are on, its menu, and the same count on the app's own icon. Create it
 * once the app is ready; call `update` whenever the engine's statuses change and `setConfig` whenever settings do.
 */
export function createTray(deps: {
  window: BrowserWindow;
  /** The engine's statuses: the count says only what's true. */
  statuses(): Record<string, ConnectionStatus>;
  open(): void;
  quit(): void;
}) {
  const dot = imageOf(dotLayers([52, 199, 89]), 16);
  const tray = new Tray(trayPlatform.icon(0));
  let config: Config | undefined;
  let shown: string | undefined;
  let count = 0;
  if (trayPlatform.clickOpens) tray.on("click", deps.open);
  nativeTheme.on("updated", () => tray.setImage(trayPlatform.icon(count)));
  // Windows drops the taskbar overlay while the window is hidden.
  deps.window.on("show", () => trayPlatform.badge(count, deps.window));

  function update() {
    const ids = idsOn(deps.statuses());
    const names = config ? namesOn(ids, config) : [];
    // Statuses change with every log line; redraw only when what the tray shows does.
    const showing = JSON.stringify([ids, names]);
    if (showing === shown) return;
    shown = showing;
    count = ids.length;
    tray.setImage(trayPlatform.icon(count));
    tray.setToolTip(`${APP_NAME}: ${countHeadline(count)}`);
    trayPlatform.badge(count, deps.window);
    tray.setContextMenu(Menu.buildFromTemplate(trayMenu({ count, names, dot, quitShortcut: trayPlatform.quitShortcut, open: deps.open, quit: deps.quit })));
  }

  update();
  return {
    update,
    /** The saved settings, which name the VPNs in the menu. */
    setConfig(next: Config) {
      config = next;
      update();
    },
  };
}
