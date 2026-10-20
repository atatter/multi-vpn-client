import { SH_MARKERS } from "./markers.ts";

// Every image: the entry point, which starts the SOCKS proxy and hands over to a VPN client, and the ready step.

/**
 * Points DNS at the resolvers the app chose, starts the SOCKS proxy (failing fast if it can't), then
 * hands the container over to the VPN client named by the first argument, through its start script
 * (mvpn-start-<client>); the rest are the client's own arguments. Each image has only its own clients'
 * start scripts, so changing one client's scripts doesn't change (and rebuild) the other images.
 */
export const ENTRY = `#!/bin/sh
set -eu
# On its own Docker network the container would ask Docker's resolver; the client's scripts expect the servers themselves.
sed 's/^/nameserver /' /run/mvpn/resolvers > /etc/resolv.conf
sing-box run -c /run/mvpn/proxy.json &
echo $! > /run/mvpn/sing-box.pid
sleep 1
if ! kill -0 $! 2>/dev/null; then echo "${SH_MARKERS.error} the SOCKS proxy failed to start"; exit 1; fi
start="/usr/local/bin/mvpn-start-$1"; shift
if [ ! -x "$start" ]; then echo "${SH_MARKERS.error} this image has no VPN client $start"; exit 1; fi
exec "$start" "$@"
`;

/**
 * Run once the tunnel's routes and DNS are in place. The proxy reloads first: its resolver
 * would otherwise keep using the pre-VPN DNS settings for a few more seconds.
 */
export const READY = `#!/bin/sh
kill -HUP "$(cat /run/mvpn/sing-box.pid)"
echo "${SH_MARKERS.ready}"
`;
