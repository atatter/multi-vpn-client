import { createSecretStore, defaultSecretsPath } from "@repo/core/secret-store";
import { defaultConfigPath, loadConfig, moveAppDir } from "@repo/core/store";
import { createConnectionManager } from "@repo/engine";
import { ensureInstalled, executableIn, latestRelease, type Remove, removeOlderVersions, targetOf, versionsDir } from "@repo/release";
import { app, BrowserWindow, shell } from "electron";
import { mkdirSync } from "node:fs";
import { promises as originalFs } from "node:original-fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { bundledBinary } from "./binaries.ts";
import { broadcast } from "./broadcast.ts";
import { saveServerRoutes } from "./config-writes.ts";
import { registerAppHandlers } from "./ipc/app.ts";
import { registerConfigHandlers } from "./ipc/config.ts";
import { registerSetupHandlers } from "./ipc/setup.ts";
import { registerUpdateHandlers } from "./ipc/update.ts";
import { registerVpnHandlers } from "./ipc/vpn.ts";
import { keychain } from "./secrets.ts";
import { createUpdater } from "./updater.ts";
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

// Updates go where the launcher keeps versions, so the next `npx multi-vpn-client` starts the newest without a download.
const { platform } = process;
const versions = versionsDir(process.env, platform, homedir());
const target = targetOf(platform, process.arch);
// Electron's fs takes a version's app.asar for a folder and can't delete it; original-fs sees the file.
const remove: Remove = (path) => originalFs.rm(path, { recursive: true, force: true });
const updater = createUpdater({
  version: app.getVersion(),
  packaged: app.isPackaged,
  target,
  latest: latestRelease,
  download: (release, onProgress) => ensureInstalled({ manifest: release, target, dir: versions, platform, env: process.env, onProgress, remove }),
  onChange: (state) => broadcast("update:changed", state),
});

/** Quits through before-quit, which turns every VPN off, and starts the downloaded version. They stay off. */
function restartToUpdate() {
  // Once: each relaunch call would start another copy.
  const version = updater.markRestarting();
  if (!version) return;
  // Given an execPath, Electron passes only `args`: hand this run's own on (the launcher's --no-sandbox, for one).
  app.relaunch({ execPath: executableIn(join(versions, version), platform), args: process.argv.slice(1) });
  app.quit();
}

registerConfigHandlers({ configPath, secrets, connections });
registerVpnHandlers({ configPath, connections });
registerSetupHandlers({ connections });
registerAppHandlers({ configPath });
registerUpdateHandlers({ updater, restart: restartToUpdate });
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
  updater.start();
  app.on("browser-window-focus", updater.windowFocused);
  // Holding the single-instance lock, no older version can be running, so what an update replaced can go.
  if (app.isPackaged) void removeOlderVersions(versions, app.getVersion(), remove);
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
  // Quit again on a later tick. ⌘Q comes from native code, and with nothing to turn off, shutdown settles before
  // that first quit returns: quitting inside it ends up recorded as cancelled, leaving the app running without a window.
  void connections.shutdown().finally(() => setImmediate(() => app.quit()));
});
