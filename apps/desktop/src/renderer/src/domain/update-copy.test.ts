import { describe, expect, it } from 'vitest';
import {
  restartProgress,
  restartQuestion,
  updateNotice,
  updateTooltip,
  versionRow,
} from './update-copy.ts';

const NOW = 10 * 60 * 60_000;

describe('the Version row', () => {
  it('says when it last checked, in words', () => {
    const line = (msAgo: number) =>
      versionRow({ state: 'current', checkedAt: NOW - msAgo }, NOW).line;
    expect(line(20_000)).toBe('Up to date, checked just now');
    expect(line(60_000)).toBe('Up to date, checked a minute ago');
    expect(line(5 * 60_000)).toBe('Up to date, checked 5 minutes ago');
    expect(line(70 * 60_000)).toBe('Up to date, checked an hour ago');
    expect(line(5 * 60 * 60_000)).toBe('Up to date, checked 5 hours ago');
  });

  it('names the size in whole megabytes, when the release says', () => {
    expect(versionRow({ state: 'available', version: '0.2.0', size: 180_400_000 }, NOW)).toEqual({
      line: '0.2.0 is available, 180 MB',
      action: { label: 'Update', run: 'download' },
    });
    expect(versionRow({ state: 'available', version: '0.2.0', size: undefined }, NOW).line).toBe(
      '0.2.0 is available',
    );
  });

  it('retries what failed: the download when there was one, the check otherwise', () => {
    expect(
      versionRow({ state: 'download-failed', version: '0.2.0', error: 'HTTP 404.' }, NOW),
    ).toEqual({ line: 'HTTP 404.', failed: true, action: { label: 'Retry', run: 'download' } });
    expect(
      versionRow({ state: 'check-failed', error: "Couldn't reach npm." }, NOW).action?.run,
    ).toBe('check');
  });

  it('has no action while it downloads or in a development build', () => {
    expect(versionRow({ state: 'downloading', version: '0.2.0', percent: 42 }, NOW)).toEqual({
      line: 'Downloading 0.2.0… 42%',
    });
    expect(versionRow({ state: 'off' }, NOW).action).toBeUndefined();
  });
});

describe("the window's update button", () => {
  it("only shows while there's an update to act on", () => {
    expect(updateTooltip({ state: 'available', version: '0.2.0', size: undefined })).toBe(
      'Update 0.2.0 ready to download',
    );
    expect(updateTooltip({ state: 'download-failed', version: '0.2.0', error: 'x' })).toBe(
      "Couldn't download 0.2.0. Click to try again.",
    );
    expect(updateTooltip({ state: 'check-failed', error: "Couldn't reach npm." })).toBeUndefined();
    expect(updateTooltip({ state: 'current', checkedAt: NOW })).toBeUndefined();
  });

  it('puts only a failed download in the error strip', () => {
    expect(updateNotice({ state: 'download-failed', version: '0.2.0', error: 'HTTP 404.' })).toBe(
      "Couldn't download 0.2.0: HTTP 404.",
    );
    expect(updateNotice({ state: 'check-failed', error: "Couldn't reach npm." })).toBeUndefined();
  });
});

describe('the restart question', () => {
  it('says which VPNs go off', () => {
    expect(restartQuestion('0.2.0', 0).body).toBe('No VPNs are on.');
    expect(restartQuestion('0.2.0', 1).body).toBe(
      "This turns off the VPN that's on. Turn it back on after.",
    );
    expect(restartQuestion('0.2.0', 2).body).toBe(
      'This turns off the 2 VPNs that are on. Turn them back on after.',
    );
  });

  it('turns into each VPN going off, then the new version starting', () => {
    const steps = (vpns: Parameters<typeof restartProgress>[1]) =>
      restartProgress('0.2.0', vpns).steps;
    const off = { state: 'disconnected' as const, log: [] };
    expect(
      steps([
        { name: 'Client B', status: off },
        { name: 'Client A', status: { state: 'connected', since: 0, warning: undefined, log: [] } },
      ]),
    ).toEqual([
      { label: 'Client B is off', state: 'done' },
      { label: 'Turning off Client A…', state: 'active' },
      { label: 'Start 0.2.0', state: 'todo' },
    ]);
    expect(steps([{ name: 'Client B', status: off }]).at(-1)).toEqual({
      label: 'Starting 0.2.0…',
      state: 'active',
    });
    // Failed or never connected (waiting for setup): main has nothing to turn off.
    expect(
      steps([
        { name: 'Client B', status: { state: 'error', message: 'Gateway refused.', log: [] } },
        { name: 'Client C', status: undefined },
      ]),
    ).toEqual([
      { label: 'Client B is off', state: 'done' },
      { label: 'Client C is off', state: 'done' },
      { label: 'Starting 0.2.0…', state: 'active' },
    ]);
    expect(steps([])).toEqual([{ label: 'Starting 0.2.0…', state: 'active' }]);
  });
});
