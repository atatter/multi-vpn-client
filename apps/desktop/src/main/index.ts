import { createSecretStore, defaultSecretsPath } from "@repo/core/secret-store";
import { defaultConfigPath, loadConfig, moveAppDir } from "@repo/core/store";
import { createConnectionManager } from "@repo/engine";
import { app, BrowserWindow, shell } from "electron";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { bundledBinary } from "./binaries.ts";
import { broadcast } from "./broadcast.ts";
import { saveServerRoutes } from "./config-writes.ts";
import { registerAppHandlers } from "./ipc/app.ts";
import { registerConfigHandlers } from "./ipc/config.ts";
import { registerSetupHandlers } from "./ipc/setup.ts";
import { registerVpnHandlers } from "./ipc/vpn.ts";
import { keychain } from "./secrets.ts";
import { APP_ICON, createWindow, focusWindow, followTheme } from "./window.ts";

// The main process's composition root: builds the services, registers the IPC handlers, runs the app's lifecycle.

// Electron keeps its own data in the app's folder too (on Windows that includes the key that encrypts secrets), so
// each OS has one folder for the app. Even with MVPN_CONFIG, so a scratch copy shares the single-instance lock and
// quits while the real app runs (two engines would remove each other's containers). Set before anything uses it.
// The folder moves before the lock is taken, because the lock lives in it: quit an older build before starting this one.
const folder = moveAppDir();
mkdirSync(folder, { recursive: true });
app.setPath("userData", folder);

// MVPN_CONFIG overrides the location.
const configPath = defaultConfigPath();
const secrets = createSecretStore(defaultSecretsPath(configPath), keychain);

const connections = createConnectionManager({
  dataDir: dirname(configPath),
  helperBinary: bundledBinary("helper"),
  cardBridgeBinary: bundledBinary("card-bridge"),
  loadConfig: () => loadConfig(configPath),
  readSecret: (vpnId, key) => secrets.read(vpnId, key),
  onChange: (statuses) => broadcast("vpn:status", statuses),
  onTraffic: (snapshot) => broadcast("traffic:update", snapshot),
  saveServerRoutes: (vpnId, serverRoutes) => saveServerRoutes(configPath, vpnId, serverRoutes),
  // Sign-in pages come from the VPN client; only https ones are opened, in the user's own browser.
  openUrl: (url) => {
    if (URL.parse(url)?.protocol === "https:") void shell.openExternal(url);
  },
});

registerConfigHandlers({ configPath, secrets, connections });
registerVpnHandlers({ configPath, connections });
registerSetupHandlers({ connections });
registerAppHandlers({ configPath });
followTheme();

// One instance only: two would fight over the helper session and each other's containers.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on("second-instance", focusWindow);

void app.whenReady().then(() => {
  if (!primaryInstance) return;
  // macOS ignores a window's icon; outside a packaged app the Dock would show Electron's. A packaged app has its own.
  if (!app.isPackaged) app.dock?.setIcon(APP_ICON);
  createWindow();
  void connections.removeLeftovers();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Disconnect everything (containers, routing helper) before quitting.
let shuttingDown = false;
app.on("before-quit", (event) => {
  if (shuttingDown) return;
  shuttingDown = true;
  event.preventDefault();
  void connections.shutdown().finally(() => app.quit());
});
