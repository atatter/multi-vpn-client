import { Hex64, HELPER_PORT, HELPER_VERSION, HELPER_WORK_DIR, HOST_DNS_PORT, LINUX_DNS_ADDRESS, NO_ROUTES, TUN_DNS_ADDRESS, type HostOs } from '@repo/core';
import { appendFileSync, statSync, truncateSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { createNrptDns, createResolvedDns, createResolverDns, type DnsAdapter } from './dns/index.ts';
import { createSingBoxBackend, stopLeftover } from './engine.ts';
import { psQuote, runPowerShell } from './powershell.ts';
import { createHelperServer } from './server.ts';

/**
 * Privileged network helper, installed once and run by the OS service manager
 * (launchd on macOS, systemd on Linux, Task Scheduler on Windows). Everything it may do is behind the helper
 * protocol; its settings are only readable by it (and administrators).
 *
 *   mvpn-helper serve      run the helper
 *   mvpn-helper --version  print the protocol version
 */

/** Written by the installer, readable only by the helper's account and administrators. `key` is the handshake key derived from the app's token (core/helper-crypto). */
const HelperConfig = z.strictObject({
  key: Hex64,
  singBoxSha256: Hex64,
});

let log = (line: string) => console.error(`${new Date().toISOString()} ${line}`);

/** Windows: Task Scheduler doesn't capture output, so the helper keeps its own log (truncated when it gets big). */
function logToFile(path: string) {
  if ((statSync(path, { throwIfNoEntry: false })?.size ?? 0) > 1_000_000) truncateSync(path);
  log = (line) => appendFileSync(path, `${new Date().toISOString()} ${line}\r\n`);
}

interface Platform {
  os: HostOs;
  configPath: string;
  workDir: string;
  singBoxPath: string;
  dns: DnsAdapter;
  /** Removes what a crashed run left behind, beyond DNS settings. */
  cleanUp?: () => Promise<void>;
}

/** Where this OS keeps the helper's settings and scratch files, and how it does per-domain DNS. */
function platform(): Platform {
  const installDir = dirname(process.execPath);
  switch (process.platform) {
    case 'darwin':
      return {
        os: 'darwin',
        configPath: join(installDir, 'helper.json'),
        workDir: HELPER_WORK_DIR,
        singBoxPath: join(installDir, 'sing-box'),
        dns: createResolverDns({ server: TUN_DNS_ADDRESS }),
        cleanUp: () => stopLeftover({ singBoxPath: join(installDir, 'sing-box'), workDir: HELPER_WORK_DIR, log }),
      };
    case 'linux': {
      // systemd hands the settings over as a credential (LoadCredential=) and owns the runtime directory.
      const { CREDENTIALS_DIRECTORY: credentials, RUNTIME_DIRECTORY: runtime } = process.env;
      if (!credentials || !runtime) throw new Error('Run the helper through its systemd service.');
      return {
        os: 'linux',
        configPath: join(credentials, 'helper.json'),
        workDir: runtime,
        singBoxPath: join(installDir, 'sing-box'),
        dns: createResolvedDns({ address: LINUX_DNS_ADDRESS, port: HOST_DNS_PORT }),
        cleanUp: () => stopLeftover({ singBoxPath: join(installDir, 'sing-box'), workDir: runtime, log }),
      };
    }
    case 'win32': {
      // The installer makes private\ and work\ readable only by SYSTEM and administrators.
      logToFile(join(installDir, 'helper.log'));
      const singBoxPath = join(installDir, 'sing-box.exe');
      return {
        os: 'win32',
        configPath: join(installDir, 'private', 'helper.json'),
        workDir: join(installDir, 'work'),
        singBoxPath,
        dns: createNrptDns({ server: TUN_DNS_ADDRESS }),
        // Stopping the task kills the helper outright, which can leave its sing-box running.
        // Finding none still marks the command failed, which would exit 1: hence the explicit exit 0.
        cleanUp: () =>
          runPowerShell(
            `Get-Process sing-box -ErrorAction SilentlyContinue | Where-Object Path -eq ${psQuote(singBoxPath)} | Stop-Process -Force\nexit 0`,
          ),
      };
    }
    default:
      throw new Error(`The helper doesn't support ${process.platform}.`);
  }
}

async function serve() {
  const { os, configPath, workDir, singBoxPath, dns, cleanUp } = platform();
  const config = HelperConfig.parse(JSON.parse(await readFile(configPath, 'utf8')));
  // Leftovers from a crash or power loss. Best effort: a stray process shouldn't keep the helper down.
  await cleanUp?.().catch((error: unknown) => log(`cleanup: ${error instanceof Error ? error.message : String(error)}`));
  await dns.clear();

  let endSession = () => {};
  const backend = createSingBoxBackend({
    os,
    singBoxPath,
    singBoxSha256: config.singBoxSha256,
    workDir,
    dns,
    log,
    onCrash: () => endSession(),
  });
  const server = createHelperServer({ key: Buffer.from(config.key, 'hex'), backend, log });
  endSession = server.endSession;
  await server.listen(HELPER_PORT);
  log(`helper v${HELPER_VERSION} listening on 127.0.0.1:${HELPER_PORT}`);

  // Tear down first: closing the server waits for open connections, and the app's session stays open.
  const shutdown = async () => {
    log('stopping');
    server.endSession();
    await backend.apply(NO_ROUTES).catch((error: unknown) => log(String(error)));
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

const [command] = process.argv.slice(2);
if (command === '--version') {
  console.log(HELPER_VERSION);
} else if (command === 'serve') {
  serve().catch((error: unknown) => {
    log(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
} else {
  console.error('Usage: mvpn-helper serve | --version');
  process.exit(2);
}
