// Browser-safe: what a VPN kind's definition is made of. The engine's side is "@repo/vpn-sdk/engine" and
// "@repo/vpn-sdk/container" (Node only), the window's is "@repo/vpn-sdk/ui". "@repo/vpn-sdk/cidr" is the IPv4
// range math the field types use, which core's route compiler shares.
export * from './fields.ts';
export * from './kind.ts';
