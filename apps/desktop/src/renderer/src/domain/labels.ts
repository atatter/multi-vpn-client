import { type RouteRule, routeTarget, type TrafficMode, type Vpn, vpnAddress } from "@repo/core";
import { signsInWith } from "./kind-copy.ts";

export const TRAFFIC_LABEL: Record<TrafficMode, string> = { official: "Same as the official app", sites: "Only sites I choose", all: "All my traffic" };

/** What a VPN carrying all traffic does to IPv6, which no VPN here carries (the helper refuses it). */
export const IPV6_BLOCKED = "IPv6 is blocked while it's on, so apps use IPv4 through it.";

/** "10.143.1.20/32" reads as "10.143.1.20": a single address doesn't need its mask. */
export const shortTarget = (rule: RouteRule) => routeTarget(rule).replace(/\/32$/, "");

/** The account a VPN signs in with, if it names one: an ID card or a username. */
export const accountName = (vpn: Vpn): string | undefined => signsInWith(vpn) ?? ("username" in vpn && vpn.username ? vpn.username : undefined);

/** Which account a VPN signs in with, so several accounts on one server stay apart; its address without one. */
export const accountLabel = (vpn: Vpn): string => accountName(vpn) ?? vpnAddress(vpn);

/** Display name, with a fallback while the name field is empty. */
export const vpnLabel = (vpn: Pick<Vpn, "name">) => vpn.name.trim() || "Unnamed VPN";
