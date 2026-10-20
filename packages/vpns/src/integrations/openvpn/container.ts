import { INSTALL_SING_BOX, installScripts, KEEP_FALLBACK_DNS, PREFIX, USE_PUSHED_DNS, vpnImage } from "@repo/vpn-sdk/container";

/** OpenVPN: options after --config override the profile; --mute 0 keeps the log complete. */
export const START_OPENVPN = `#!/bin/sh
set -eu
# Every server the profile names stays on the container's own network, so a reconnect to another one
# (or a soft restart that keeps the tunnel and its catch-all routes) never tries to reach it through the tunnel.
gateway=$(ip -4 route show default | awk '{ print $3; exit }')
for host in $(awk '$1 == "remote" { print $2 }' /run/mvpn/profile.ovpn); do
  for ip in $(getent ahostsv4 "$host" | awk '{ print $1 }' | sort -u); do
    ip route replace "$ip/32" via "$gateway" dev eth0 2>/dev/null || true
  done
done
set -- --cd /run/mvpn --config profile.ovpn --script-security 2 --up /usr/local/bin/mvpn-ovpn-up \\
  --route-up /usr/local/bin/mvpn-ovpn-route-up --mute 0 --pull-filter ignore block-outside-dns --verb 3
if [ -f /run/mvpn/auth ]; then set -- "$@" --auth-user-pass /run/mvpn/auth; fi
exec openvpn "$@"
`;

/**
 * OpenVPN --up: pushed DNS servers arrive as foreign_option_N="dhcp-option DNS x", pushed routes as
 * route_network_N/route_netmask_N (routes back to the original gateway are exclusions, not the VPN's),
 * and a pushed redirect-gateway as route_redirect_gateway_ipv4. The routes are recorded for the app:
 * "all" when the server sends everything.
 */
export const OVPN_UP = `#!/bin/sh
${USE_PUSHED_DNS}
${PREFIX}
use_pushed_dns $(env | sed -n 's/^foreign_option_[0-9]*=dhcp-option DNS //p')
if [ -n "\${route_redirect_gateway_ipv4:-}" ]; then
  echo all > /run/mvpn/pushed-routes
else
  i=1
  : > /run/mvpn/pushed-routes
  while eval "net=\\\${route_network_$i:-}"; [ -n "$net" ]; do
    eval "mask=\\\${route_netmask_$i:-} via=\\\${route_gateway_$i:-}"
    if [ "$via" != "\${route_net_gateway:-}" ]; then echo "$net/$(prefix "$mask")" >> /run/mvpn/pushed-routes; fi
    i=$((i + 1))
  done
  own_network "\${ifconfig_local:-}" "\${ifconfig_netmask:-}" >> /run/mvpn/pushed-routes
fi
`;

/**
 * OpenVPN --route-up: everything the host sends here goes through the tunnel, whatever the server routes,
 * so a site the user added, or "all my traffic", works too. The route to the server itself stays on the
 * original gateway, and both halves of the address space go into the tunnel (OpenVPN's own def1 way).
 */
export const OVPN_ROUTE_UP = `#!/bin/sh
${KEEP_FALLBACK_DNS}
if [ -n "\${trusted_ip:-}" ] && [ -n "\${route_net_gateway:-}" ]; then ip route replace "$trusted_ip/32" via "$route_net_gateway"; fi
# The server's address, which the host must keep off every tunnel (a tunnel inside itself loops).
echo "\${trusted_ip:-}" > /run/mvpn/endpoint
# Through the tunnel's gateway when it has one (TAP), else straight into the device (TUN).
via=\${route_vpn_gateway:+via $route_vpn_gateway}
ip route replace 0.0.0.0/1 $via dev "$dev"
ip route replace 128.0.0.0/1 $via dev "$dev"
keep_fallback_dns "\${route_net_gateway:-}"
exec /usr/local/bin/mvpn-ready
`;

// Built natively for the Docker host's architecture; downloads are checksum-verified.
export const OPENVPN_IMAGE = vpnImage(
  "mvpn-openvpn",
  `FROM alpine:3.24
RUN apk add --no-cache openvpn ca-certificates curl
${INSTALL_SING_BOX}
${installScripts(
  ["/usr/local/bin/mvpn-start-openvpn", START_OPENVPN],
  ["/usr/local/bin/mvpn-ovpn-up", OVPN_UP],
  ["/usr/local/bin/mvpn-ovpn-route-up", OVPN_ROUTE_UP],
)}
`,
);
