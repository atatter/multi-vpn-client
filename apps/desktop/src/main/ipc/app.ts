import { app, shell } from "electron";
import { fitWindow, platform } from "../window.ts";
import { handle } from "./handle.ts";

/** The app itself: version and platform, the settings file, and the window's size. */
export function registerAppHandlers({ configPath }: { configPath: string }) {
  handle("app:info", async () => ({ version: app.getVersion(), packaged: app.isPackaged, platform: platform() }));
  handle("app:show-config", async () => shell.showItemInFolder(configPath));
  handle("window:fit", async (height) => fitWindow(height));
}
