import { APP_NAME } from '@repo/core';
import { DESKTOP_ID, type desktopEntryFiles } from '@repo/core/store';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Desktop Entry spec: Exec quotes each argument and escapes ", `, $ and \ inside the quotes, and a literal % is %%.
// Every value then escapes \ and line breaks again.
const quoteArgument = (argument: string) => `"${argument.replaceAll(/["`$\\]/g, String.raw`\$&`)}"`;
const escapeValue = (value: string) =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', String.raw`\n`)
    .replaceAll('\t', String.raw`\t`)
    .replaceAll('\r', String.raw`\r`);

/** The entry that starts `command` (the executable, then its arguments) and names the app's window and icon. */
export function desktopEntry({
  command,
  icon,
}: {
  command: readonly [string, ...string[]];
  icon: string;
}) {
  const exec = command.map(quoteArgument).join(' ').replaceAll('%', '%%');
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${APP_NAME}`,
    `Exec=${escapeValue(exec)}`,
    // Hides the entry once the version it points at is gone, until the app runs again and rewrites it.
    `TryExec=${escapeValue(command[0])}`,
    `Icon=${escapeValue(icon)}`,
    'Terminal=false',
    'Categories=Network;',
    `StartupWMClass=${DESKTOP_ID}`,
    '',
  ].join('\n');
}

/** Writes `content` unless the file already holds it, via a temp file so a dock never reads half of it. Returns whether it wrote. */
async function writeIfChanged(path: string, content: Buffer) {
  const current = await readFile(path).catch(() => undefined);
  if (current?.equals(content)) {
    return false;
  }
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temp, content);
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
  return true;
}

/**
 * Keeps the current user's desktop entry and its icon pointing at the build that runs: the npm launcher unpacks each
 * version into its own folder. Returns whether the entry changed.
 */
export async function syncDesktopEntry({
  files: { entry, icon },
  command,
  iconSource,
}: {
  files: ReturnType<typeof desktopEntryFiles>;
  command: readonly [string, ...string[]];
  iconSource: string;
}) {
  // A real file: the app's own icon sits inside its archive, where a dock can't read it.
  await writeIfChanged(icon, await readFile(iconSource));
  return writeIfChanged(entry, Buffer.from(desktopEntry({ command, icon })));
}
