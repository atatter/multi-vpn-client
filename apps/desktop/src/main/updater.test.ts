import type { Manifest } from '@repo/release';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '../shared/ipc-contract.ts';
import { createUpdater } from './updater.ts';

const release = (version: string): Manifest => ({
  version,
  archives: {
    'linux-x64': {
      file: `multi-vpn-client-${version}-linux-x64.tar.gz`,
      sha256: 'a'.repeat(64),
      size: 180_000_000,
    },
  },
});

/** An updater for 0.1.0 over a fake npm and download: `npm` is what npm answers next. */
function setup({
  packaged = true,
  npm = (): Promise<Manifest> => Promise.resolve(release('0.2.0')),
  wait = (_ms: number) => Promise.resolve(),
  now = (): number => 1000,
} = {}) {
  const states: UpdateState[] = [];
  const downloads: {
    version: string;
    finish: () => void;
    fail: (error: Error) => void;
    progress: (done: number) => void;
  }[] = [];
  const updater = createUpdater({
    version: '0.1.0',
    packaged,
    target: 'linux-x64',
    latest: () => npm(),
    download: (manifest, progress) =>
      new Promise((resolve, reject) =>
        downloads.push({
          version: manifest.version,
          finish: () => resolve(undefined),
          fail: reject,
          progress,
        }),
      ),
    onChange: (state) => states.push(state),
    now,
    wait,
  });
  return { updater, states, downloads };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('checking for a newer version', () => {
  it('never happens in a development build', async () => {
    let asked = 0;
    const { updater, states } = setup({
      packaged: false,
      npm: () => (asked++, Promise.resolve(release('0.2.0'))),
    });
    updater.start();
    updater.windowFocused();
    await updater.check();
    expect(asked).toBe(0);
    expect(updater.state()).toEqual({ state: 'off' });
    expect(states).toEqual([]);
  });

  it('offers a newer version on npm, with its size, and downloads nothing yet', async () => {
    const { updater, states, downloads } = setup();
    await updater.check();
    expect(states).toEqual([
      { state: 'checking' },
      { state: 'available', version: '0.2.0', size: 180_000_000 },
    ]);
    expect(downloads).toEqual([]);
  });

  it("is up to date when npm's newest is this version or older", async () => {
    for (const version of ['0.1.0', '0.0.9']) {
      const { updater } = setup({ npm: () => Promise.resolve(release(version)) });
      await updater.check();
      expect(updater.state()).toEqual({ state: 'current', checkedAt: 1000 });
    }
  });

  it('says why it failed, and can be tried again', async () => {
    let answer = (): Promise<Manifest> =>
      Promise.reject(new Error("Couldn't reach npm. Check the internet connection."));
    const { updater } = setup({ npm: () => answer() });
    await updater.check();
    expect(updater.state()).toEqual({
      state: 'check-failed',
      error: "Couldn't reach npm. Check the internet connection.",
    });
    answer = () => Promise.resolve(release('0.2.0'));
    await updater.check();
    expect(updater.state()).toMatchObject({ state: 'available' });
  });

  it("keeps saying it's checking for a second, even when npm answers at once", async () => {
    for (const npm of [
      () => Promise.resolve(release('0.2.0')),
      () => Promise.reject(new Error('offline')),
    ]) {
      let done = () => {};
      const waits: number[] = [];
      const { updater } = setup({
        npm,
        wait: (ms) => (waits.push(ms), new Promise<void>((resolve) => (done = resolve))),
      });
      const checked = updater.check();
      await settle();
      expect(updater.state()).toEqual({ state: 'checking' });
      expect(waits).toEqual([1000]);
      done();
      await checked;
      expect(updater.state().state).not.toBe('checking');
    }
  });

  it("doesn't forget a known update when asked again", async () => {
    let asked = 0;
    const { updater } = setup({ npm: () => (asked++, Promise.resolve(release('0.2.0'))) });
    await updater.check();
    await updater.check();
    expect(asked).toBe(1);
    expect(updater.state()).toMatchObject({ state: 'available' });
  });
});

describe('checking by itself', () => {
  const minutes = (n: number) => n * 60_000;

  it('shows nothing until npm answers at start, then a newer version', async () => {
    const { updater, states } = setup();
    updater.start();
    await settle();
    expect(states).toEqual([{ state: 'available', version: '0.2.0', size: 180_000_000 }]);
  });

  it("shows why the first check failed, but leaves what's shown when a later one fails", async () => {
    let clock = 0;
    let answer = (): Promise<Manifest> =>
      Promise.reject(new Error("Couldn't reach npm. Check the internet connection."));
    const { updater } = setup({ npm: () => answer(), now: () => clock });
    updater.start();
    await settle();
    expect(updater.state()).toMatchObject({ state: 'check-failed' });
    answer = () => Promise.resolve(release('0.1.0'));
    clock = minutes(15);
    updater.windowFocused();
    await settle();
    expect(updater.state()).toEqual({ state: 'current', checkedAt: minutes(15) });
    answer = () => Promise.reject(new Error('offline'));
    clock = minutes(30);
    updater.windowFocused();
    await settle();
    expect(updater.state()).toEqual({ state: 'current', checkedAt: minutes(15) });
  });

  it('asks when the window comes to the front, unless npm was asked in the last 15 minutes', async () => {
    let clock = 0;
    let asked = 0;
    const { updater } = setup({
      npm: () => (asked++, Promise.resolve(release('0.1.0'))),
      now: () => clock,
    });
    updater.start();
    await settle();
    clock = minutes(14);
    updater.windowFocused();
    await settle();
    expect(asked).toBe(1);
    clock = minutes(15);
    updater.windowFocused();
    await settle();
    expect(asked).toBe(2);
  });

  it('asks every hour', async () => {
    vi.useFakeTimers();
    try {
      let asked = 0;
      const { updater } = setup({ npm: () => (asked++, Promise.resolve(release('0.1.0'))) });
      updater.start();
      await vi.advanceTimersByTimeAsync(minutes(59));
      expect(asked).toBe(1);
      await vi.advanceTimersByTimeAsync(minutes(1));
      expect(asked).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers an even newer version, and downloads that one', async () => {
    let clock = 0;
    let newest = '0.2.0';
    const { updater, downloads } = setup({
      npm: () => Promise.resolve(release(newest)),
      now: () => clock,
    });
    updater.start();
    await settle();
    newest = '0.2.1';
    clock = minutes(15);
    updater.windowFocused();
    await settle();
    expect(updater.state()).toEqual({ state: 'available', version: '0.2.1', size: 180_000_000 });
    void updater.download();
    expect(downloads.map((download) => download.version)).toEqual(['0.2.1']);
  });

  it('stops once a download starts, even when npm answers after it', async () => {
    let clock = 0;
    let answer: (manifest: Manifest) => void = () => {};
    let asked = 0;
    const npm = () =>
      asked++ === 0
        ? Promise.resolve(release('0.2.0'))
        : new Promise<Manifest>((resolve) => (answer = resolve));
    const { updater } = setup({ npm, now: () => clock });
    updater.start();
    await settle();
    clock = minutes(15);
    updater.windowFocused();
    void updater.download();
    answer(release('0.2.1'));
    await settle();
    expect(updater.state()).toMatchObject({ state: 'downloading', version: '0.2.0' });
    clock = minutes(30);
    updater.windowFocused();
    expect(asked).toBe(2);
  });
});

describe('downloading it', () => {
  it('only starts once a check found a newer version', async () => {
    const { updater, downloads } = setup();
    await updater.download();
    expect(downloads).toEqual([]);
  });

  it("reports whole percents, holds 100 back until it's unpacked, then is ready to restart into", async () => {
    const { updater, states, downloads } = setup();
    await updater.check();
    const done = updater.download();
    const [download] = downloads;
    for (const share of [0.004, 0.42, 0.421, 0.9, 1]) {
      download?.progress(share);
    }
    download?.finish();
    await done;
    expect(states.slice(2)).toEqual([
      { state: 'downloading', version: '0.2.0', percent: 0 },
      { state: 'downloading', version: '0.2.0', percent: 42 },
      { state: 'downloading', version: '0.2.0', percent: 90 },
      { state: 'downloading', version: '0.2.0', percent: 99 },
      { state: 'ready', version: '0.2.0' },
    ]);
  });

  it('ignores more clicks and checks while it runs', async () => {
    const { updater, downloads } = setup();
    await updater.check();
    void updater.download();
    await updater.download();
    await updater.check();
    expect(downloads).toHaveLength(1);
    expect(updater.state()).toMatchObject({ state: 'downloading' });
  });

  it('fails with the reason and the version, and downloads again when tried again', async () => {
    const { updater, downloads } = setup();
    await updater.check();
    void updater.download();
    downloads[0]?.fail(new Error("The download doesn't match its checksum."));
    await settle();
    expect(updater.state()).toEqual({
      state: 'download-failed',
      version: '0.2.0',
      error: "The download doesn't match its checksum.",
    });
    void updater.download();
    expect(downloads).toHaveLength(2);
  });
});

describe('restarting into it', () => {
  it("happens once, and only once it's downloaded", async () => {
    const { updater, downloads } = setup();
    await updater.check();
    expect(updater.markRestarting()).toBeUndefined();
    const done = updater.download();
    downloads[0]?.finish();
    await done;
    expect(updater.markRestarting()).toBe('0.2.0');
    expect(updater.state()).toEqual({ state: 'restarting', version: '0.2.0' });
    expect(updater.markRestarting()).toBeUndefined();
  });
});
