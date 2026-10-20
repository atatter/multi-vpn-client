// Shell functions every client's scripts share, spliced into those scripts.

/**
 * Every client: records the DNS servers the server pushed, for the app to read, and makes
 * the container resolve through them, so names routed by domain resolve on the VPN side.
 * Skipped when the app pinned DNS servers (docker --dns).
 */
export const USE_PUSHED_DNS = `use_pushed_dns() {
  printf '%s\\n' "$@" > /run/mvpn/pushed-dns
  if [ ! -e /run/mvpn/dns-pinned ] && [ "$#" -gt 0 ]; then printf 'nameserver %s\\n' "$@" > /etc/resolv.conf; fi
}`;

/**
 * Every client: keeps the DNS servers the container falls back to (when the server pushed none) on the
 * container's own network, since everything else now goes through the tunnel and a server that only
 * carries its own network wouldn't pass them on. $1 is the original gateway.
 */
export const KEEP_FALLBACK_DNS = `keep_fallback_dns() {
  # Servers set in the VPN's settings (dns-pinned) belong inside the tunnel; so do pushed ones.
  if [ -e /run/mvpn/dns-pinned ] || grep -q . /run/mvpn/pushed-dns 2>/dev/null || [ -z "$1" ]; then return; fi
  for ns in $(awk '/^nameserver/ { print $2 }' /etc/resolv.conf); do
    case "$ns" in 127.*) ;; *) ip route replace "$ns/32" via "$1" dev eth0 2>/dev/null || true ;; esac
  done
}`;

/** Every client: the prefix length of a dotted netmask, e.g. 255.255.254.0 → 23. */
export const PREFIX = `prefix() {
  bits=0
  for octet in $(echo "$1" | tr . ' '); do
    case "$octet" in 255) bits=$((bits + 8)) ;; 254) bits=$((bits + 7)) ;; 252) bits=$((bits + 6)) ;; 248) bits=$((bits + 5)) ;;
      240) bits=$((bits + 4)) ;; 224) bits=$((bits + 3)) ;; 192) bits=$((bits + 2)) ;; 128) bits=$((bits + 1)) ;; esac
  done
  echo "$bits"
}
# The tunnel's own network (address/netmask), which the vendor's client reaches without a route for it.
own_network() {
  if [ -n "$1" ] && [ -n "$2" ]; then
    len=$(prefix "$2")
    if [ "$len" -gt 0 ] && [ "$len" -lt 32 ]; then echo "$1/$len"; fi
  fi
}`;
