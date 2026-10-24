import { nativeTheme } from "electron";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { countLabel, type Layer, numeral, point, tunnelLayers } from "./glyph.ts";
import { imageOf } from "./images.ts";
import type { TrayPlatform } from "./index.ts";
import { countHeadline } from "./menu.ts";

const REG = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
const PERSONALIZE = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";

/** Whether the taskbar is dark, from `reg query <PERSONALIZE> /v SystemUsesLightTheme`; undefined when it doesn't say. */
export function taskbarIsDark(regOutput: string): boolean | undefined {
  const value = /SystemUsesLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(regOutput)?.[1];
  return value === undefined ? undefined : Number.parseInt(value, 16) === 0;
}

const WM_SETTINGCHANGE = 0x001a;

/** The registry's last answer; undefined when it gave none, and Electron's stands in. */
let darkTaskbar: boolean | undefined;

/**
 * Windows: the tray doesn't recolor icons, so it's drawn white or black for the taskbar's theme. The taskbar has no
 * count badge, so the count is a red overlay drawn on the app's button. A click on the tray icon opens the window.
 */
export const win32Tray: TrayPlatform = {
  registerDesktopApp() {},
  icon(count, hasUpdate) {
    const dark = darkTaskbar ?? nativeTheme.shouldUseDarkColorsForSystemIntegratedUI;
    return imageOf(tunnelLayers(count, dark ? [255, 255, 255] : [0, 0, 0], hasUpdate), 16);
  },
  // The taskbar follows Windows mode and apps follow app mode, which can differ. Electron answers with app mode until
  // app mode changes, and Chromium reports no change of Windows mode alone, so the registry is read here instead:
  // at startup and on every WM_SETTINGCHANGE, which Windows broadcasts when either mode changes.
  watchColors(redraw, window) {
    const read = () =>
      execFile(REG, ["query", PERSONALIZE, "/v", "SystemUsesLightTheme"], { windowsHide: true, timeout: 5_000 }, (error, stdout) => {
        darkTaskbar = error ? undefined : taskbarIsDark(stdout);
        redraw();
      });
    read();
    window.hookWindowMessage(WM_SETTINGCHANGE, read);
    nativeTheme.on("updated", redraw);
  },
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
