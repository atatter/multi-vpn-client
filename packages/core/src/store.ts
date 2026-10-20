import { existsSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Config, emptyConfig } from "./config.ts";
import { readJsonIfExists, writeJsonAtomic } from "./fs.ts";

/**
 * Node-only config persistence for the desktop main process. Import via
 * "@repo/core/store" (not from the browser bundle).
 */

/** Per-user app data: %APPDATA% on Windows, Application Support on macOS, XDG on Linux. */
function appDataBase(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  // Empty or relative values are ignored (as the XDG spec requires), never resolved against the cwd.
  const absolute = (value: string | undefined) => (value && isAbsolute(value) ? value : undefined);
  if (platform === "win32") return absolute(env.APPDATA) ?? join(homedir(), "AppData", "Roaming");
  const home = absolute(env.HOME) ?? homedir();
  if (platform === "darwin") return join(home, "Library", "Application Support");
  return absolute(env.XDG_CONFIG_HOME) ?? join(home, ".config");
}

// The app's folder, named the way each OS names them. Literal names, not derived from APP_NAME: moving the folder
// is a migration, never a side effect of renaming the app. On Windows and macOS, `moveAppDir` moves an existing
// "multi-vpn-client" folder (Linux's name) to "Multi VPN Client".
const OLD_DIR = "multi-vpn-client";
const dirName = (platform: NodeJS.Platform) => (platform === "win32" || platform === "darwin" ? "Multi VPN Client" : OLD_DIR);

const folders = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform) => {
  const base = appDataBase(env, platform);
  return { current: join(base, dirName(platform)), old: join(base, OLD_DIR) };
};

/**
 * The app's folder: config, secrets, the helper's token and Electron's own data. "Multi VPN Client" on Windows and
 * macOS, "multi-vpn-client" on Linux. Until `moveAppDir` has moved an old folder, that one is used, so the user's
 * VPNs never look gone.
 */
export function appDir(env = process.env, platform = process.platform): string {
  const { current, old } = folders(env, platform);
  return existsSync(old) && !existsSync(join(current, "config.json")) ? old : current;
}

/** The per-user config file, in the app's folder. MVPN_CONFIG overrides it (for testing). */
export function defaultConfigPath(env = process.env, platform = process.platform): string {
  return env.MVPN_CONFIG || join(appDir(env, platform), "config.json");
}

/**
 * Moves an existing "multi-vpn-client" folder to the current name on Windows and macOS, with everything in it (the
 * helper's token too, so the helper keeps working), and returns the folder the app uses. Best effort: if a file is
 * in use, the app keeps using the old folder and tries again next start.
 */
export function moveAppDir(env = process.env, platform = process.platform): string {
  const { current, old } = folders(env, platform);
  if (env.MVPN_CONFIG || current === old || appDir(env, platform) !== old) return appDir(env, platform);
  try {
    if (!existsSync(current)) renameSync(old, current);
    else {
      // The new folder holds no config yet but may hold something else (Electron's data, a .DS_Store): move the
      // old folder's entries in. Nothing is overwritten or deleted; a clash stays behind in the old folder.
      for (const entry of readdirSync(old)) if (!existsSync(join(current, entry))) renameSync(join(old, entry), join(current, entry));
      if (readdirSync(old).length === 0) rmdirSync(old);
    }
  } catch {
    // Still on the old folder; appDir keeps pointing there while it has the config.
  }
  return appDir(env, platform);
}

/** Reads and validates the config. A missing file means "no VPNs yet", not an error. */
export async function loadConfig(path = defaultConfigPath()): Promise<Config> {
  const raw = await readJsonIfExists(path);
  return raw === undefined ? emptyConfig() : Config.parse(raw);
}

/** Validates, then writes atomically. Returns the parsed (normalized) config. */
export async function saveConfig(config: Config, path = defaultConfigPath()): Promise<Config> {
  const valid = Config.parse(config);
  await writeJsonAtomic(path, valid);
  return valid;
}
