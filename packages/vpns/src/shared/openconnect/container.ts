import {
  INSTALL_SING_BOX,
  installScripts,
  KEEP_FALLBACK_DNS,
  PREFIX,
  SH_MARKERS,
  TCL_MARKERS,
  USE_PUSHED_DNS,
  VPCD_PORT,
  VPCD_RELAY_SOURCE,
  vpnImage,
} from '@repo/vpn-sdk/container';

/** OpenConnect: stdin answers its prompts in order (see engine.ts). */
export const START_OPENCONNECT = `#!/bin/sh
exec openconnect "$@" --script /usr/local/bin/mvpn-oc-script --passwd-on-stdin < /run/mvpn/auth
`;

/**
 * OpenConnect --script, called per phase ($reason). vpnc-script sets up the interface and
 * routes; DNS is handled here instead (vpnc-script would try to replace resolv.conf, which
 * Docker mounts). Ready comes after the routes are in place.
 *
 * On connect, the server's split routes (CISCO_SPLIT_INC_<i>_ADDR/_MASKLEN) are recorded for the app,
 * "all" when it doesn't split. Then they're dropped in every phase, so vpnc-script routes everything the
 * host sends here through the tunnel (keeping the gateway itself on the original route): a site the user
 * added, or "all my traffic", works too.
 */
export const OC_SCRIPT = `#!/bin/sh
${USE_PUSHED_DNS}
${KEEP_FALLBACK_DNS}
${PREFIX}
if [ "$reason" = connect ]; then
  use_pushed_dns \${INTERNAL_IP4_DNS:-}
  if [ -n "\${CISCO_SPLIT_INC:-}" ]; then
    i=0
    while [ "$i" -lt "$CISCO_SPLIT_INC" ]; do
      eval "echo \\"\\\${CISCO_SPLIT_INC_\${i}_ADDR}/\\\${CISCO_SPLIT_INC_\${i}_MASKLEN}\\""
      i=$((i + 1))
    done
    own_network "\${INTERNAL_IP4_ADDRESS:-}" "\${INTERNAL_IP4_NETMASK:-}"
  else
    echo all
  fi > /run/mvpn/pushed-routes
  gateway=$(ip -4 route show default | awk '{ print $3; exit }')
  # The gateway's address, which the host must keep off every tunnel (a tunnel inside itself loops).
  echo "\${VPNGATEWAY:-}" > /run/mvpn/endpoint
fi
unset INTERNAL_IP4_DNS INTERNAL_IP6_DNS CISCO_DEF_DOMAIN CISCO_SPLIT_DNS
for name in $(env | sed -n 's/^\\(CISCO_SPLIT_[A-Za-z0-9_]*\\)=.*/\\1/p; s/^\\(CISCO_IPV6_SPLIT_[A-Za-z0-9_]*\\)=.*/\\1/p'); do unset "$name"; done
/etc/vpnc/vpnc-script
if [ "$reason" = connect ]; then
  keep_fallback_dns "\${gateway:-}"
  /usr/local/bin/mvpn-ready
fi
`;

/**
 * OpenConnect signing in with the smart card in the computer's reader (e.g. an ID card), whose certificate
 * URI comes first. Without --passwd-on-stdin, which would answer the PIN prompt, openconnect asks on a
 * terminal, under expect (see OC_CARD_WRAPPER).
 */
export const START_OPENCONNECT_CARD = `#!/bin/sh
set -eu
# Signs in with the smart card in the computer's reader (e.g. an ID card), whose certificate URI comes
# first. The app's card bridge lends the card to pcscd's virtual reader (vsmartcard's vpcd): it connects
# to vpcd's port from inside the container, which can take a few seconds after the start. vpcd listens
# on every interface (Debian's can't connect out instead), so its ports only take connections from the
# relay, which connects from its own loopback address; otherwise another container, the VPN's network, or
# the container's SOCKS proxy (which a VPN's DNS could point at 127.0.0.1) could pose as the card.
# Without --passwd-on-stdin, which would answer the PIN prompt, openconnect asks on a terminal.
if ! nft "add table inet mvpn; add chain inet mvpn input { type filter hook input priority 0; };
    add rule inet mvpn input tcp dport { ${VPCD_PORT}, ${VPCD_PORT + 1} } iifname \\"lo\\" ip saddr ${VPCD_RELAY_SOURCE} accept;
    add rule inet mvpn input tcp dport { ${VPCD_PORT}, ${VPCD_PORT + 1} } drop"; then
  echo "${SH_MARKERS.error} the card's virtual reader couldn't be shielded from the network"; exit 1
fi
cert="$1"; shift
mkdir -p /run/pcscd
pcscd --foreground --disable-polkit > /dev/null 2>&1 &
# openconnect looks for the key at the certificate's URI with type=private. A short URI (like the default)
# names no token, and that search across all of the card's tokens fails after the PIN login ("PKCS #11
# error in data"). So the card's full URI is used: the first certificate that has all of the given
# attributes, which names its token and id.
card_cert() {
  set -f # the attributes below are split unquoted, and one may contain "*"
  p11tool --list-all-certs --only-urls 'pkcs11:' 2> /dev/null | while read -r url; do
    match=yes
    for attr in $(printf '%s' "\${cert#pkcs11:}" | tr ';' ' '); do
      case ";\${url#pkcs11:};" in *";$attr;"*) ;; *) match=no ;; esac
    done
    if [ "$match" = yes ]; then echo "$url"; break; fi
  done
}
deadline=$(($(date +%s) + 30))
until full=$(card_cert) && [ -n "$full" ]; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    certs=$(p11tool --list-all-certs --only-urls 'pkcs11:' 2> /dev/null | grep 'type=cert' | tr '\\n' ' ')
    if [ -z "$certs" ]; then echo "${SH_MARKERS.error} no certificates were found on the card"; exit 1; fi
    echo "${SH_MARKERS.error} the card has no certificate $cert. It has: $certs"; exit 1
  fi
  sleep 1
done
echo "Signing in with the card's certificate $full"
exec expect -f /usr/local/bin/mvpn-oc-card openconnect "--certificate=$full" "$@" --script /usr/local/bin/mvpn-oc-script
`;

/**
 * Runs openconnect on a terminal, for a sign-in with a smart card. Complete lines pass through to the
 * log. openconnect's PIN prompt ("Enter PIN:", no newline) is relayed as a marker line naming the
 * token and saying what openconnect said before it ("Wrong PIN", tries left); the app's answer
 * arrives on the answers FIFO, as for snx-rs. Any other prompt ends the connect: openconnect only
 * asks for something else if the gateway wants more than the card. The prompt goes to the log
 * first, so the launch's own reading can explain it (e.g. the portal's choice of gateways).
 */
export const OC_CARD_WRAPPER = `log_user 0
set timeout -1
exec mkfifo -m 600 /run/mvpn/answers
set answers [open /run/mvpn/answers r+]
spawn -noecho {*}$argv
set token "the card"
set notes {}
set running 1
while {$running} {
  expect {
    -re {^([^\\n]*)\\n} {
      set line [string trimright $expect_out(1,string) "\\r"]
      if {$line ne ""} {
        puts $line
        flush stdout
        regexp {^PIN required for (.+)$} $line -> token
        if {[regexp {^(Wrong PIN|This is the final try before locking!|Only a few tries left before locking!)$} $line]} {
          lappend notes $line
        }
      }
    }
    -re {^Enter PIN: ?$} {
      puts "${TCL_MARKERS.prompt} [join [concat $notes [list "Enter the PIN for $token"]] " "]"
      flush stdout
      set notes {}
      if {[gets $answers answer] < 0} { exit 1 }
      send -- "$answer\\r"
    }
    -re {^([^\\n]*): ?$} {
      puts "$expect_out(1,string):"
      puts "${TCL_MARKERS.error} the VPN server asked for more than the card: [string trim $expect_out(1,string)]"
      flush stdout
      exit 1
    }
    eof { set running 0 }
  }
}
lassign [wait] pid spawn_id os_error code
exit $code
`;

// Built natively for the Docker host's architecture; downloads are checksum-verified.
export const OPENCONNECT_IMAGE = vpnImage(
  'mvpn-openconnect',
  `FROM alpine:3.24
RUN apk add --no-cache openconnect ca-certificates curl
${INSTALL_SING_BOX}
${installScripts(['/usr/local/bin/mvpn-start-openconnect', START_OPENCONNECT], ['/usr/local/bin/mvpn-oc-script', OC_SCRIPT])}
`,
);

/**
 * OpenConnect signing in with a smart card (see START_OPENCONNECT_CARD): Debian, which packages
 * vpcd. Debian testing (forky, pinned by digest), since current Estonian ID cards (EstEID 2018 v2,
 * and Thales' EstEID 2025) need OpenSC 0.27, and trixie has 0.26; the build fails on an older one.
 * vpnc-script goes where the other image keeps it.
 */
export const OPENCONNECT_CARD_IMAGE = vpnImage(
  'mvpn-smartcard',
  `FROM debian:forky-slim@sha256:3c80e257eff6274d593eb33a94bda5174ccd619836e6a728a73e11c97f2213e3
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl expect gnutls-bin iproute2 nftables \\
      openconnect opensc-pkcs11 pcscd socat vsmartcard-vpcd && rm -rf /var/lib/apt/lists/*
RUN dpkg --compare-versions "$(dpkg-query -W -f '\${Version}' opensc-pkcs11)" ge 0.27
RUN mkdir -p /etc/vpnc && ln -s /usr/share/vpnc-scripts/vpnc-script /etc/vpnc/vpnc-script
${INSTALL_SING_BOX}
${installScripts(
  ['/usr/local/bin/mvpn-start-openconnect-card', START_OPENCONNECT_CARD],
  ['/usr/local/bin/mvpn-oc-card', OC_CARD_WRAPPER],
  ['/usr/local/bin/mvpn-oc-script', OC_SCRIPT],
)}
`,
);
