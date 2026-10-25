import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESOLVER_MARK } from '@repo/core';
import { createResolverDns } from './darwin.ts';

const setup = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'mvpn-resolver-')), 'resolver');
  let flushes = 0;
  const dns = createResolverDns({ server: '198.18.0.2', dir, flush: async () => void flushes++ });
  return { dir, dns, flushes: () => flushes };
};

describe('resolver DNS', () => {
  it('writes one marked entry per valid domain and flushes', async () => {
    const { dir, dns, flushes } = await setup();
    await dns.set([
      'corp.example',
      'corp.example',
      '../evil',
      '.hidden',
      'with space',
      'b.internal',
    ]);
    expect((await readdir(dir)).sort()).toEqual(['b.internal', 'corp.example']);
    expect(await readFile(join(dir, 'corp.example'), 'utf8')).toBe(
      `${RESOLVER_MARK}\nnameserver 198.18.0.2\n`,
    );
    expect(flushes()).toBe(1);
  });

  it("never touches entries it didn't write", async () => {
    const { dir, dns } = await setup();
    await dns.set([]);
    await writeFile(join(dir, 'foreign.example'), 'nameserver 9.9.9.9\n');
    await dns.set(['foreign.example', 'ours.example']);
    expect(await readFile(join(dir, 'foreign.example'), 'utf8')).toBe('nameserver 9.9.9.9\n');
    await dns.clear();
    expect(await readdir(dir)).toEqual(['foreign.example']);
  });

  it('replaces its own entries on each set', async () => {
    const { dir, dns } = await setup();
    await dns.set(['a.example', 'b.example']);
    await dns.set(['b.example', 'c.example']);
    expect((await readdir(dir)).sort()).toEqual(['b.example', 'c.example']);
  });
});
