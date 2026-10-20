import type { Vpn, VpnKind, VpnOf } from "@repo/core";
import type { KindFieldsProps, MainFieldsProps } from "@repo/vpn-sdk/ui";
import { FORMS } from "@repo/vpns/ui";
import { formOf } from "../domain/kind-copy.ts";

/**
 * A VPN's main fields, from its kind's form (@repo/vpns). `kind` lets the lookup type-check without a cast; pass
 * the VPN's own `vpn.kind`, since with a non-literal kind TypeScript can't tell that the two match.
 */
export function KindMainFields<K extends VpnKind>({ kind, ...props }: MainFieldsProps<VpnOf<K>> & { kind: K }) {
  const { Main } = FORMS[kind];
  return <Main {...props} />;
}

/** A VPN's rarely needed fields, from its kind's form; nothing for kinds without any. */
export function KindMoreFields<K extends VpnKind>({ kind, ...props }: KindFieldsProps<VpnOf<K>> & { kind: K }) {
  const { More } = FORMS[kind];
  return More ? <More {...props} /> : null;
}

/** The username field's hint and placeholder for this VPN. */
export const usernameCopy = (vpn: Vpn) => formOf(vpn.kind).username?.(vpn) ?? {};
