import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { latestRelease } from './latest.ts';
import type { Manifest } from './release.ts';

const release: Manifest = {
  version: '1.2.3',
  archives: {
    'linux-x64': {
      file: 'multi-vpn-client-1.2.3-linux-x64.tar.gz',
      sha256: 'a'.repeat(64),
      size: 180_000_000,
    },
  },
};

/** npm's registry, answering for /latest (a package with a release), /old (one without) and /down (an error). */
const server = createServer((request, response) => {
  if (request.url === '/latest') {
    return void response.end(
      JSON.stringify({ name: 'multi-vpn-client', version: '1.2.3', release }),
    );
  }
  if (request.url === '/old') {
    return void response.end(JSON.stringify({ name: 'multi-vpn-client', version: '0.1.0' }));
  }
  response.writeHead(503).end();
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
afterAll(() => void server.close());
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

describe("npm's newest release", () => {
  it('is the release in the latest package.json', async () => {
    expect(await latestRelease(`${url}/latest`)).toEqual(release);
  });

  it("says why when npm can't tell", async () => {
    await expect(latestRelease(`${url}/old`)).rejects.toThrow("doesn't say what to download");
    await expect(latestRelease(`${url}/down`)).rejects.toThrow('npm answered HTTP 503');
    await expect(latestRelease('http://127.0.0.1:1/latest')).rejects.toThrow("Couldn't reach npm");
  });
});
