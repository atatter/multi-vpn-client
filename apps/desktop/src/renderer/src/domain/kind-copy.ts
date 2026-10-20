import type { Vpn, VpnKind, VpnOf } from "@repo/core";
import type { KindForm } from "@repo/vpn-sdk/ui";
import { FORMS } from "@repo/vpns/ui";

/** A kind's wording and form (@repo/vpns), typed for that kind's VPN; call it with the VPN's own kind (like core's kindSpec). */
export const formOf = <K extends VpnKind>(kind: K): KindForm<VpnOf<K>> => FORMS[kind];

/** This VPN's kind-specific settings that differ from the defaults. */
export const kindChanges = (vpn: Vpn) => formOf(vpn.kind).changed?.(vpn) ?? [];

/** What this VPN signs in with instead of a password, if anything. */
export const signsInWith = (vpn: Vpn) => formOf(vpn.kind).signsInWith?.(vpn);
