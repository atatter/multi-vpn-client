import { describe, expect, it } from 'vitest';
import { run } from '../process.ts';
import { launchdPlist, macInstallScript, macUninstallScript } from './darwin.ts';

describe('helper install scripts', () => {
  // Runs the script through /bin/sh, which Windows doesn't have. CI runs it on Linux and macOS.
  it.skipIf(process.platform === 'win32')('are valid sh and quote paths with spaces', async () => {
    const install = macInstallScript({
      helperBinary: '/Users/a/dev/multi vpn/packages/helper/dist/mvpn-helper-darwin-arm64',
      helperSha256: 'a'.repeat(64),
      singBox: {
        path: '/Users/a/Library/Application Support/multi-vpn-client/bin/sing-box-1.14.3/sing-box',
        sha256: 'b'.repeat(64),
      },
      configFile: '/private/var/folders/x/T/mvpn-helper-1/helper.json',
    });
    expect(install).toContain(
      `cp '/Users/a/Library/Application Support/multi-vpn-client/bin/sing-box-1.14.3/sing-box' "$DIR/sing-box"`,
    );
    expect(install).not.toContain('key');
    expect((await run('/bin/sh', ['-n'], install)).code).toBe(0);
    expect((await run('/bin/sh', ['-n'], macUninstallScript())).code).toBe(0);
  });

  it('registers a launchd daemon that runs the helper', () => {
    const plist = launchdPlist();
    expect(plist).toContain(
      '<string>/Library/PrivilegedHelperTools/dev.multi-vpn-client.helper/mvpn-helper</string><string>serve</string>',
    );
    expect(plist).toContain('<key>KeepAlive</key><true/>');
  });
});
