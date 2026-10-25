import { kindSpec, VPN_KINDS } from '@repo/core';
import { listOf } from '@repo/ui/format.ts';
import { FORMS } from '@repo/vpns/ui';

/** Every extension some kind reads, for the file picker. */
export const FILE_EXTENSIONS = [...new Set(VPN_KINDS.flatMap((kind) => kindSpec(kind).fromFile?.extensions ?? []))];

/** The files the window says it takes, e.g. "OpenVPN (.ovpn)": each kind that reads one, by its first extension. */
export const FILE_TYPES = listOf(
  VPN_KINDS.flatMap((kind) => {
    const extension = kindSpec(kind).fromFile?.extensions[0];
    return extension ? [`${FORMS[kind].label} (${extension})`] : [];
  }),
);
