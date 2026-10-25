import { describe, expect, it } from 'vitest';
import { run } from '../process.ts';
import { linuxInstallScript, linuxUninstallScript, polkitRule, systemdUnit } from './linux.ts';

describe('helper install scripts', () => {
  // Runs the script through /bin/sh, which Windows doesn't have. CI runs it on Linux and macOS.
  it.skipIf(process.platform === 'win32')(
    'Linux: valid sh, key only inside the script (fed on stdin), and a narrowly scoped service',
    async () => {
      const install = linuxInstallScript({
        helperBinary: '/home/a/dev/multi vpn/packages/helper/dist/mvpn-helper-linux-x64',
        helperSha256: 'a'.repeat(64),
        singBox: {
          path: '/home/a/.config/multi-vpn-client/bin/sing-box-1.14.3/sing-box',
          sha256: 'b'.repeat(64),
        },
        configJson: '{"key":"x"}',
      });
      expect(install).toContain(
        `cp '/home/a/dev/multi vpn/packages/helper/dist/mvpn-helper-linux-x64' "$DIR/mvpn-helper"`,
      );
      expect((await run('/bin/sh', ['-n'], install)).code).toBe(0);
      expect((await run('/bin/sh', ['-n'], linuxUninstallScript())).code).toBe(0);
      expect(systemdUnit()).toContain(
        'User=mvpn-helper\nAmbientCapabilities=CAP_NET_ADMIN\nCapabilityBoundingSet=CAP_NET_ADMIN\n',
      );
      expect(polkitRule()).toContain(`action.lookup("interface") === "mvpn-dns"`);
    },
  );
});
