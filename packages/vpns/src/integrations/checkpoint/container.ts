import { install, INSTALL_SING_BOX, installScripts, TCL_MARKERS, USE_PUSHED_DNS, vpnImage } from '@repo/vpn-sdk/container';
import { SYSCTL_SHIM } from './sysctl-shim.ts';

/** snx-rs: runs on a terminal under expect, which relays its prompts (see SNX_WRAPPER). */
export const START_SNX = `#!/bin/sh
set -eu
# Picks the IPsec transport where snx-rs's own choice fails from a container, unless the VPN's Advanced
# box sets one. A gateway behind NAT (its own address is private, not the one its name resolves to) may
# drop ESP over UDP although its NAT-T port answers, so ESP goes over TCP 443 (TCPT, "Visitor Mode") to
# its internal address. Otherwise snx-rs's choice stands, except that kernel IPsec needs an xfrm
# interface, which e.g. Docker Desktop's kernel can't make (snx-rs can't tell from inside a container):
# then it's snx-rs's own ESP over UDP.
conf=/run/mvpn/snx.conf
# Everything in the container goes through the tunnel (snx-rs: default-route), from snx-rs's own routing
# table, which is consulted before the main one. Replies to Docker's network (the SOCKS port the host
# connects to) must keep using the main table.
for net in $(ip -4 route show dev eth0 scope link | awk '{ print $1 }'); do
  ip rule add to "$net" lookup main pref 17999
done
if ! grep -q '^transport-type[[:space:]]*=' "$conf"; then
  server=$(sed -n 's/^server-name=//p' "$conf" | cut -d: -f1)
  own=$(LANG=en_US.UTF-8 snx-rs -m info -c "$conf" 2>/dev/null | sed -n 's/^ *Server IP: //p')
  public=$(getent ahostsv4 "$server" | awk 'NR == 1 { print $1 }')
  case "$own" in
    10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) private=yes ;;
    *) private=no ;;
  esac
  if [ "$private" = yes ] && [ "$own" != "$public" ]; then
    echo "transport-type=tcpt" >> "$conf"
    grep -q '^use-internal-gateway-ip[[:space:]]*=' "$conf" || echo "use-internal-gateway-ip=true" >> "$conf"
    echo "The gateway is behind NAT ($public outside, $own inside), so IPsec runs over TCP 443 (Visitor Mode)."
  elif ip link add mvpn-xfrm-probe type xfrm if_id 1 2>/dev/null; then
    ip link del mvpn-xfrm-probe
  else
    echo "transport-type=udp" >> "$conf"
    echo "Kernel IPsec isn't available in this Docker, so snx-rs encrypts in user space (UDP)."
  fi
fi
exec expect -f /usr/local/bin/mvpn-snx
`;

/**
 * Runs snx-rs on a terminal, which is the only way it asks for input (passwords, SMS codes).
 * Complete lines pass through to the log. A prompt is output that ends in ": " with no newline
 * yet: it's relayed as a marker line, and the app's answer arrives on the answers FIFO, opened
 * read-write so the open doesn't wait for the app. The tunnel is up at "Tunnel connected",
 * after snx-rs printed its settings, including the DNS servers the gateway pushed.
 */
export const SNX_WRAPPER = `log_user 0
set timeout -1
exec mkfifo -m 600 /run/mvpn/answers
set answers [open /run/mvpn/answers r+]
set env(LANG) en_US.UTF-8
spawn -noecho env LD_PRELOAD=/usr/local/lib/mvpn-sysctl-shim.so snx-rs -m standalone -c /run/mvpn/snx.conf
set dns {}
set running 1
while {$running} {
  expect {
    -re {^([^\\n]*)\\n} {
      set line [string trimright $expect_out(1,string) "\\r"]
      if {$line ne ""} {
        puts $line
        flush stdout
        regexp {DNS servers: \\[([^\\]]*)\\]} $line -> dns
        if {[string match "Tunnel connected*" $line]} {
          exec /usr/local/bin/mvpn-snx-up {*}[string map {"," ""} $dns] >@stdout 2>@stderr
        }
      }
    }
    -re {^([^\\n]*): $} {
      puts "${TCL_MARKERS.prompt} [string trim $expect_out(1,string)]"
      flush stdout
      if {[gets $answers answer] < 0} { exit 1 }
      send -- "$answer\\r"
    }
    eof { set running 0 }
  }
}
lassign [wait] pid spawn_id os_error code
exit $code
`;

/** snx-rs, once connected: the DNS servers it printed, then ready. */
export const SNX_UP = `#!/bin/sh
${USE_PUSHED_DNS}
use_pushed_dns "$@"
exec /usr/local/bin/mvpn-ready
`;

/**
 * The pinned snx-rs release (Check Point client) for the Check Point VPN container. Its Linux
 * builds link against glibc, so that container is Debian-based. Digests are the SHA-256 GitHub
 * publishes for each `snx-rs-v<version>-linux-<arch>.tar.xz` asset.
 */
export const SNX_RS_VERSION = '6.5.1';
export const SNX_RS_TARBALLS = {
  x86_64: '6109cb1df8e1a0277c04b55b5d74864775a81dfe85f2d97ce94ab15254bc72b4',
  arm64: '88222f236188269963174261d11d6a94a1afe84c9b7e587faa26fa2417bfd448',
} as const;

/** Check Point through snx-rs, whose Linux builds need glibc; hence Debian, plus expect for its prompts. */
export const CHECKPOINT_IMAGE = vpnImage(
  'mvpn-checkpoint',
  `FROM debian:trixie-slim AS shim
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
RUN ${install('/tmp/shim.c', SYSCTL_SHIM)} && gcc -O2 -Wall -shared -fPIC -o /tmp/mvpn-sysctl-shim.so /tmp/shim.c -ldl

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl expect iproute2 xz-utils && rm -rf /var/lib/apt/lists/*
${INSTALL_SING_BOX}
RUN set -eu; \\
    case "$(uname -m)" in \\
      x86_64) arch=x86_64; sha=${SNX_RS_TARBALLS.x86_64};; \\
      aarch64) arch=arm64; sha=${SNX_RS_TARBALLS.arm64};; \\
      *) echo "unsupported architecture" >&2; exit 1;; \\
    esac; \\
    url="https://github.com/ancwrd1/snx-rs/releases/download/v${SNX_RS_VERSION}/snx-rs-v${SNX_RS_VERSION}-linux-$arch.tar.xz"; \\
    curl -fsSL -o /tmp/snx-rs.tar.xz "$url"; \\
    echo "$sha  /tmp/snx-rs.tar.xz" | sha256sum -c -; \\
    mkdir /tmp/snx-rs; \\
    tar -xJf /tmp/snx-rs.tar.xz -C /tmp/snx-rs --strip-components=1; \\
    mv /tmp/snx-rs/snx-rs /usr/local/bin/snx-rs; \\
    rm -rf /tmp/snx-rs*; \\
    snx-rs --version
COPY --from=shim /tmp/mvpn-sysctl-shim.so /usr/local/lib/mvpn-sysctl-shim.so
${installScripts(
  ['/usr/local/bin/mvpn-start-snx', START_SNX],
  ['/usr/local/bin/mvpn-snx', SNX_WRAPPER],
  ['/usr/local/bin/mvpn-snx-up', SNX_UP],
)}
`,
);
