import { APP_NAME, HELPER_LABEL, HELPER_WORK_DIR, RESOLVER_MARK } from "@repo/core";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, shQuote } from "../process.ts";
import type { InstallPlan, PlatformInstaller } from "./index.ts";

/**
 * macOS: a launchd daemon in root-owned locations, installed through the standard
 * admin prompt (osascript). Binaries are copied first and their checksums verified there, as root.
 */

export const HELPER_INSTALL_DIR = `/Library/PrivilegedHelperTools/${HELPER_LABEL}`;
export const HELPER_PLIST = `/Library/LaunchDaemons/${HELPER_LABEL}.plist`;
const HELPER_LOG = "/Library/Logs/multi-vpn-client-helper.log";

const b64 = (text: string) => Buffer.from(text).toString("base64");

export function launchdPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${HELPER_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${HELPER_INSTALL_DIR}/mvpn-helper</string><string>serve</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${HELPER_LOG}</string>
  <key>StandardErrorPath</key><string>${HELPER_LOG}</string>
</dict>
</plist>
`;
}

/** Root script that removes the helper and everything it created. */
export function macUninstallScript(): string {
  return `set -u
launchctl bootout system/${HELPER_LABEL} 2>/dev/null || true
rm -f ${shQuote(HELPER_PLIST)}
rm -rf ${shQuote(HELPER_INSTALL_DIR)} ${shQuote(HELPER_WORK_DIR)}
rm -f ${shQuote(HELPER_LOG)}
for f in /etc/resolver/*; do
  [ -f "$f" ] && [ "$(head -n1 "$f")" = ${shQuote(RESOLVER_MARK)} ] && rm -f "$f"
done
killall -HUP mDNSResponder 2>/dev/null || true
`;
}

/**
 * Root script that (re)installs the helper; aborts and cleans up if a checksum doesn't match.
 * The settings (with the handshake key) come from a private file, so the key never shows up in
 * a command line, which other processes can read.
 */
export function macInstallScript(p: Omit<InstallPlan, "configJson"> & { configFile: string }): string {
  // umask 077: helper.json (the handshake key) must never exist with looser permissions, even briefly.
  return `set -eu
umask 077
DIR=${shQuote(HELPER_INSTALL_DIR)}
fail() { rm -rf "$DIR"; echo "$1" >&2; exit 1; }
launchctl bootout system/${HELPER_LABEL} 2>/dev/null || true
rm -rf "$DIR"
mkdir -p "$DIR"
cp ${shQuote(p.helperBinary)} "$DIR/mvpn-helper"
cp ${shQuote(p.singBox.path)} "$DIR/sing-box"
[ "$(shasum -a 256 "$DIR/mvpn-helper" | cut -d' ' -f1)" = ${shQuote(p.helperSha256)} ] || fail "helper checksum mismatch"
[ "$(shasum -a 256 "$DIR/sing-box" | cut -d' ' -f1)" = ${shQuote(p.singBox.sha256)} ] || fail "sing-box checksum mismatch"
cat ${shQuote(p.configFile)} > "$DIR/helper.json"
chown -R root:wheel "$DIR"
chmod 755 "$DIR" "$DIR/mvpn-helper" "$DIR/sing-box"
chmod 600 "$DIR/helper.json"
xattr -c "$DIR/mvpn-helper" "$DIR/sing-box" 2>/dev/null || true
echo ${b64(launchdPlist())} | /usr/bin/base64 --decode > ${shQuote(HELPER_PLIST)}
chown root:wheel ${shQuote(HELPER_PLIST)}
chmod 644 ${shQuote(HELPER_PLIST)}
launchctl bootstrap system ${shQuote(HELPER_PLIST)}
`;
}

/** Runs a script as root via the standard macOS admin prompt and waits for it to finish. */
async function runAsAdmin(script: string, reason: string): Promise<void> {
  // Base64 keeps the script free of quotes, so it can sit inside the AppleScript string as-is.
  const appleScript =
    `do shell script "echo ${b64(script)} | /usr/bin/base64 --decode | /bin/sh" ` +
    `with prompt ${JSON.stringify(reason)} with administrator privileges`;
  const result = await run("/usr/bin/osascript", ["-e", appleScript]);
  if (result.code !== 0) {
    if (result.stderr.includes("-128")) throw new Error("Administrator access was cancelled.");
    throw new Error(result.stderr.trim() || "The administrator script failed.");
  }
}

export const darwinInstaller: PlatformInstaller = {
  logHint: HELPER_LOG,
  isInstalled: () => existsSync(HELPER_PLIST),
  async install({ configJson, ...plan }) {
    // tmpdir() is per-user (0700) on macOS; the file itself is 0600 too.
    const staging = await mkdtemp(join(tmpdir(), "mvpn-helper-"));
    try {
      const configFile = join(staging, "helper.json");
      await writeFile(configFile, configJson, { mode: 0o600 });
      await runAsAdmin(macInstallScript({ ...plan, configFile }), `${APP_NAME} wants to install its network helper. You'll only be asked once.`);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  },
  uninstall: () => runAsAdmin(macUninstallScript(), `${APP_NAME} wants to remove its network helper.`),
};
