import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureInstalled, installedVersions, removeOlderVersions } from './install.ts';
import { executableIn, type Manifest } from './release.ts';

const platform = process.platform;
const target = `${platform}-${process.arch}`;
const tar =
  platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';

/** A release archive shaped like Linux's: the app inside one folder named after the archive. */
async function fakeArchive() {
  const dir = await mkdtemp(join(tmpdir(), 'mvpn-launcher-'));
  const app = join(dir, 'src', 'multi-vpn-client-1.2.3');
  const exe = executableIn(app, platform);
  await mkdir(join(exe, '..'), { recursive: true });
  await writeFile(exe, 'app');
  const file = 'multi-vpn-client-1.2.3.tar.gz';
  await promisify(execFile)(tar, [
    '-czf',
    join(dir, file),
    '-C',
    join(dir, 'src'),
    'multi-vpn-client-1.2.3',
  ]);
  const sha256 = createHash('sha256')
    .update(await readFile(join(dir, file)))
    .digest('hex');

  return { dir, file, sha256 };
}

const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((server) => server.close()));

/** Serves `dir` over HTTP and counts the requests. Paths under /moved/ redirect to the file, as GitHub's assets do. */
async function serve(dir: string) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    if (request.url?.startsWith('/moved/')) {
      return void response.writeHead(302, { location: request.url.slice('/moved'.length) }).end();
    }

    readFile(join(dir, (request.url ?? '').slice(1))).then(
      (body) => response.end(body),
      () => response.writeHead(404).end(),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

const manifestFor = (file: string, sha256: string): Manifest => ({
  version: '1.2.3',
  archives: { [target]: { file, sha256, size: 1 } },
});

/** A complete unpacked version, as ensureInstalled leaves it. */
async function unpacked(versions: string, version: string) {
  const exe = executableIn(join(versions, version), platform);
  await mkdir(join(exe, '..'), { recursive: true });
  await writeFile(exe, 'app');
}

describe('installing a version', () => {
  it('downloads, checks and unpacks the archive once, then reuses it', async () => {
    const { dir, file, sha256 } = await fakeArchive();
    const { url, requests } = await serve(dir);
    const versions = join(dir, 'versions');
    await mkdir(join(versions, '1.0.0'), { recursive: true });
    const progress: number[] = [];
    const options = {
      manifest: manifestFor(file, sha256),
      target,
      dir: versions,
      platform,
      env: { MVPN_RELEASE_URL: url },
      onProgress: (share: number) => void progress.push(share),
    };

    const exe = await ensureInstalled(options);
    expect(exe).toBe(executableIn(join(versions, '1.2.3'), platform));
    expect(await readFile(exe, 'utf8')).toBe('app');
    expect(await ensureInstalled(options)).toBe(exe);
    expect(requests).toEqual([`/${file}`]);
    // Out of the length the server sent, not the manifest's (wrong) size.
    expect(progress.at(-1)).toBe(1);
    // Other versions stay (one may be running), and no temporary folders are left behind.
    expect((await readdir(versions)).toSorted()).toEqual(['1.0.0', '1.2.3']);
  });

  it("refuses an archive that doesn't match its checksum, and leaves nothing installed", async () => {
    const { dir, file } = await fakeArchive();
    const { url } = await serve(dir);
    const versions = join(dir, 'versions');
    const options = {
      manifest: manifestFor(file, '0'.repeat(64)),
      target,
      dir: versions,
      platform,
      env: { MVPN_RELEASE_URL: url },
    };

    await expect(ensureInstalled(options)).rejects.toThrow("doesn't match its checksum");
    expect(existsSync(join(versions, '1.2.3'))).toBe(false);
    expect(await readdir(versions)).toEqual([]);
  });

  it('follows a redirect to where the archive is', async () => {
    const { dir, file, sha256 } = await fakeArchive();
    const { url, requests } = await serve(dir);
    const options = {
      manifest: manifestFor(file, sha256),
      target,
      dir: join(dir, 'versions'),
      platform,
      env: { MVPN_RELEASE_URL: `${url}/moved` },
    };
    expect(await readFile(await ensureInstalled(options), 'utf8')).toBe('app');
    expect(requests).toEqual([`/moved/${file}`, `/${file}`]);
  });

  it("says which machines a release supports when this one isn't among them", async () => {
    const options = {
      manifest: manifestFor('x.tar.gz', '0'.repeat(64)),
      target: 'aix-ppc64',
      dir: tmpdir(),
      platform,
      env: {},
    };
    await expect(ensureInstalled(options)).rejects.toThrow(
      `isn't available for aix-ppc64. It's built for ${target}.`,
    );
  });
});

describe('the versions on disk', () => {
  it('are the completely unpacked ones', async () => {
    const versions = await mkdtemp(join(tmpdir(), 'mvpn-versions-'));
    await unpacked(versions, '0.2.0');
    await unpacked(versions, '0.10.0');
    await mkdir(join(versions, '0.3.0'));
    await mkdir(join(versions, '.download-x'));
    expect((await installedVersions(versions, platform)).toSorted()).toEqual(['0.10.0', '0.2.0']);
    expect(await installedVersions(join(versions, 'missing'), platform)).toEqual([]);
  });

  it('lose only the versions older than the running one', async () => {
    const versions = await mkdtemp(join(tmpdir(), 'mvpn-versions-'));

    for (const version of ['0.1.0', '0.9.0', '0.10.0', '0.11.0']) {
      await unpacked(versions, version);
    }

    await mkdir(join(versions, '.download-x'));
    await removeOlderVersions(versions, '0.10.0', (path) =>
      rm(path, { recursive: true, force: true }),
    );
    expect((await readdir(versions)).toSorted()).toEqual(['.download-x', '0.10.0', '0.11.0']);
  });
});
