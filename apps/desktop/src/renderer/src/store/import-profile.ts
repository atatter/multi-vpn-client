import { kindSpec, newVpn, VPN_KINDS, type Vpn, type VpnKind } from '@repo/core';
import { FORMS } from '@repo/vpns/ui';
import { nameFromFile, uniqueName } from '../domain/names.ts';
import { FILE_TYPES } from '../domain/provider-files.ts';
import type { AppModel } from './app-model.ts';
import type { Screen } from './screen.ts';

/** A drop on the window: one provider file opens like a chosen one; several are turned away. */
export function openDropped(app: AppModel, files: readonly File[]) {
  const [file, ...more] = files;
  if (more.length > 0) {
    return app.showNotice('Drop one file at a time.');
  }
  if (file) {
    openProfile(app, file);
  }
}

/** Opens the sign-in step for a dropped or chosen provider file, or shows why it can't be used. */
export function openProfile(app: AppModel, file: File) {
  void importProfile(file, app.config.vpns).then((result) =>
    result.ok ? app.push(result.screen) : app.showNotice(result.error),
  );
}

/** A new VPN of `kind` from the file, if it's one of that kind's; kept generic so the draft and its kind stay tied. */
const readAs = <K extends VpnKind>(kind: K, text: string, draft: { id: string; name: string }) =>
  kindSpec(kind).fromFile?.read(text, newVpn(kind, draft));

/**
 * Reads a dropped or chosen provider file into a new VPN's sign-in step. Kinds that read the file's extension
 * try it in VPN_KINDS order, and the first that reads it wins.
 */
export async function importProfile(
  file: File,
  vpns: readonly Vpn[],
): Promise<
  { ok: true; screen: Extract<Screen, { name: 'signin' }> } | { ok: false; error: string }
> {
  const lower = file.name.toLowerCase();
  const kinds = VPN_KINDS.filter((kind) =>
    kindSpec(kind).fromFile?.extensions.some((extension) => lower.endsWith(extension)),
  );
  if (kinds.length === 0) {
    return {
      ok: false,
      error: `${file.name} isn't a VPN file this app reads. It takes ${FILE_TYPES} files.`,
    };
  }
  const text = await file.text();
  const draft = { id: crypto.randomUUID(), name: uniqueName(nameFromFile(file.name), vpns) };
  let firstError: string | undefined;
  for (const kind of kinds) {
    const read = readAs(kind, text, draft);
    if (!read) {
      continue;
    }
    if (!read.ok) {
      firstError ??= `${file.name} isn't a valid ${FORMS[kind].label} file: ${read.error}`;
      continue;
    }
    return {
      ok: true,
      screen: {
        name: 'signin',
        draft: read.vpn,
        secrets: read.secrets,
        source: { from: 'file', fileName: file.name },
      },
    };
  }
  return { ok: false, error: firstError ?? `${file.name} isn't a VPN file this app reads.` };
}
