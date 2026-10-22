import { APP_NAME } from "@repo/core";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

/**
 * Linux docks badge only an app with a desktop entry, and match its window to the entry by this id: Electron's
 * desktop name, which is also the window's app id on Wayland and its WM_CLASS on X11.
 */
export const DESKTOP_ID = "dev.multi-vpn-client";

/** $XDG_DATA_HOME, or its default. A relative path is invalid there and ignored (XDG Base Directory spec). */
export const xdgDataHome = (env: NodeJS.ProcessEnv, home: string) => {
  const value = env.XDG_DATA_HOME;
  return value && isAbsolute(value) ? value : join(home, ".local", "share");
};

// Desktop Entry spec: Exec quotes each argument and escapes ", `, $ and \ inside the quotes, and a literal % is %%.
// Every value then escapes \ and line breaks again.
const quoteArgument = (argument: string) => `"${argument.replaceAll(/["`$\\]/g, String.raw`\$&`)}"`;
const escapeValue = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("\n", String.raw`\n`).replaceAll("\t", String.raw`\t`).replaceAll("\r", String.raw`\r`);

/** The entry that starts `command` (the executable, then its arguments) and names the app's window and icon. */
export function desktopEntry({ command, icon }: { command: readonly [string, ...string[]]; icon: string }) {
  const exec = command.map(quoteArgument).join(" ").replaceAll("%", "%%");
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${APP_NAME}`,
    `Exec=${escapeValue(exec)}`,
    // Hides the entry once the version it points at is gone, until the app runs again and rewrites it.
    `TryExec=${escapeValue(command[0])}`,
    `Icon=${escapeValue(icon)}`,
    "Terminal=false",
    "Categories=Network;",
    `StartupWMClass=${DESKTOP_ID}`,
    "",
  ].join("\n");
}

/** Writes `content` unless the file already holds it, via a temp file so a dock never reads half of it. Returns whether it wrote. */
async function writeIfChanged(path: string, content: Buffer) {
  const current = await readFile(path).catch(() => undefined);
  if (current?.equals(content)) return false;
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, content);
  await rename(temp, path);
  return true;
}

/**
 * Keeps the current user's desktop entry and its icon pointing at the build that runs: the npm launcher unpacks each
 * version into its own folder. Returns whether the entry changed.
 */
export async function syncDesktopEntry({ dataHome, command, iconSource }: { dataHome: string; command: readonly [string, ...string[]]; iconSource: string }) {
  // A real file: the app's own icon sits inside its archive, where a dock can't read it.
  const icon = join(dataHome, "icons", "hicolor", "512x512", "apps", `${DESKTOP_ID}.png`);
  await writeIfChanged(icon, await readFile(iconSource));
  return writeIfChanged(join(dataHome, "applications", `${DESKTOP_ID}.desktop`), Buffer.from(desktopEntry({ command, icon })));
}
