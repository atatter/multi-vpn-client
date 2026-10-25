import { LINUX_ROUTE_TABLE, LINUX_RULE_INDEX, TUN_NAME } from '@repo/core';
import { existsSync } from 'node:fs';
import { run, shQuote } from '../process.ts';
import type { InstallPlan, PlatformInstaller } from './index.ts';

/**
 * Linux: a systemd service running as its own system user with only CAP_NET_ADMIN
 * (a root process limited to that capability could still ask systemd to start anything).
 * A polkit rule lets that user change systemd-resolved settings, for the helper's DNS
 * interface only. Installed through pkexec, the desktop's standard admin prompt.
 */

const UNIT = 'multi-vpn-client-helper.service';
const UNIT_PATH = `/etc/systemd/system/${UNIT}`;
const INSTALL_DIR = '/usr/local/lib/multi-vpn-client';
const POLKIT_RULE_PATH = '/etc/polkit-1/rules.d/50-multi-vpn-client.rules';
const USER = 'mvpn-helper';
/** Must match the helper's DNS interface (helper/dns/linux). */
const DNS_LINK = 'mvpn-dns';

const b64 = (text: string) => Buffer.from(text).toString('base64');

export function systemdUnit(): string {
  return `[Unit]
Description=multi-vpn-client network helper
Wants=modprobe@tun.service modprobe@dummy.service
After=modprobe@tun.service modprobe@dummy.service network.target

[Service]
ExecStart=${INSTALL_DIR}/mvpn-helper serve
Restart=always
RestartSec=2
User=${USER}
AmbientCapabilities=CAP_NET_ADMIN
CapabilityBoundingSet=CAP_NET_ADMIN
NoNewPrivileges=yes
LoadCredential=helper.json:${INSTALL_DIR}/helper.json
RuntimeDirectory=multi-vpn-client-helper
RuntimeDirectoryMode=0700
UMask=0077
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
DevicePolicy=closed
DeviceAllow=/dev/net/tun rw
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
SystemCallArchitectures=native
RestrictNamespaces=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes

[Install]
WantedBy=multi-user.target
`;
}

/** Lets the helper's user point its own DNS interface at its listener, and nothing else. */
export function polkitRule(): string {
  return `// Installed by multi-vpn-client.
polkit.addRule(function (action, subject) {
  var allowed = ["org.freedesktop.resolve1.set-dns-servers", "org.freedesktop.resolve1.set-domains", "org.freedesktop.resolve1.set-default-route"];
  if (subject.user === "${USER}" && allowed.indexOf(action.id) >= 0 && action.lookup("interface") === "${DNS_LINK}") {
    return polkit.Result.YES;
  }
});
`;
}

/** Root script that removes the helper and everything it created, including routing leftovers from a crash. */
export function linuxUninstallScript(): string {
  return `set -u
systemctl disable --now ${UNIT} 2>/dev/null || true
rm -f ${UNIT_PATH} ${POLKIT_RULE_PATH}
systemctl daemon-reload
ip link del ${DNS_LINK} 2>/dev/null || true
ip link del ${TUN_NAME.linux} 2>/dev/null || true
for p in $(seq ${LINUX_RULE_INDEX} ${LINUX_RULE_INDEX + 10}); do
  while ip rule del priority "$p" 2>/dev/null; do :; done
  while ip -6 rule del priority "$p" 2>/dev/null; do :; done
done
ip route flush table ${LINUX_ROUTE_TABLE} 2>/dev/null || true
rm -rf ${INSTALL_DIR}
userdel ${USER} 2>/dev/null || true
`;
}

/** Root script that (re)installs the helper; aborts and cleans up if a checksum doesn't match. */
export function linuxInstallScript(p: InstallPlan): string {
  // umask 077: helper.json (the handshake key) must never exist with looser permissions, even briefly.
  return `set -eu
umask 077
DIR=${INSTALL_DIR}
fail() { rm -rf "$DIR"; echo "$1" >&2; exit 1; }
systemctl disable --now ${UNIT} 2>/dev/null || true
systemd-sysusers --inline ${shQuote(`u ${USER} - "multi-vpn-client network helper"`)}
rm -rf "$DIR"
mkdir -p "$DIR"
cp ${shQuote(p.helperBinary)} "$DIR/mvpn-helper"
cp ${shQuote(p.singBox.path)} "$DIR/sing-box"
[ "$(sha256sum "$DIR/mvpn-helper" | cut -d' ' -f1)" = ${shQuote(p.helperSha256)} ] || fail "helper checksum mismatch"
[ "$(sha256sum "$DIR/sing-box" | cut -d' ' -f1)" = ${shQuote(p.singBox.sha256)} ] || fail "sing-box checksum mismatch"
echo ${b64(p.configJson)} | base64 -d > "$DIR/helper.json"
chown -R root:root "$DIR"
chmod 755 "$DIR" "$DIR/mvpn-helper" "$DIR/sing-box"
chmod 600 "$DIR/helper.json"
echo ${b64(systemdUnit())} | base64 -d > ${UNIT_PATH}
chmod 644 ${UNIT_PATH}
mkdir -p ${POLKIT_RULE_PATH.slice(0, POLKIT_RULE_PATH.lastIndexOf('/'))}
echo ${b64(polkitRule())} | base64 -d > ${POLKIT_RULE_PATH}
chmod 644 ${POLKIT_RULE_PATH}
systemctl daemon-reload
systemctl enable --now ${UNIT}
`;
}

/**
 * Runs a script as root through pkexec. The script goes in on stdin, not the command line,
 * since it carries the handshake key and command lines are readable by every user.
 */
async function runAsAdmin(script: string): Promise<void> {
  const result = await run('pkexec', ['/bin/sh', '-s'], script).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        throw new Error('pkexec (polkit) is needed to install the network helper.');
      }

      throw error;
    },
  );
  if (result.code === 126) {
    throw new Error('Administrator access was cancelled.');
  }
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || `The administrator script failed (exit ${result.code}).`,
    );
  }
}

export const linuxInstaller: PlatformInstaller = {
  logHint: `journalctl -u ${UNIT}`,
  isInstalled: () => existsSync(UNIT_PATH),
  install: (plan) => runAsAdmin(linuxInstallScript(plan)),
  uninstall: () => runAsAdmin(linuxUninstallScript()),
};
