import type { MainApi } from '../../../preload/index.ts';
import type { UpdateState } from '../../../shared/ipc-contract.ts';

/** Every update state, by name: the harness starts in one with ?update=<name>. A check finds `available`. */
export const UPDATES = {
  idle: { state: 'idle' },
  checking: { state: 'checking' },
  current: { state: 'current', checkedAt: Date.now() - 60_000 },
  available: { state: 'available', version: '0.2.0', size: 180_000_000 },
  downloading: { state: 'downloading', version: '0.2.0', percent: 42 },
  ready: { state: 'ready', version: '0.2.0' },
  restarting: { state: 'restarting', version: '0.2.0' },
  'check-failed': { state: 'check-failed', error: "Couldn't reach npm. Check the internet connection." },
  'download-failed': { state: 'download-failed', version: '0.2.0', error: "Couldn't reach github.com. Check the internet connection and try again." },
  off: { state: 'off' },
} satisfies Record<string, UpdateState>;

/** fake-api's updater: main's update calls over a made-up npm, plus controls to set what it reports. */
export function createFakeUpdater(initial: UpdateState, pause: (ms: number) => Promise<void>) {
  let update = initial;
  let failNextDownload: string | undefined;
  const listeners = new Set<(state: UpdateState) => void>();
  const setUpdate = (next: UpdateState) => {
    update = next;
    listeners.forEach((listener) => listener(next));
  };

  const api = {
    updateState: async () => update,
    // Like main: unless a newer version is already known or on its way.
    checkForUpdate: async () => {
      if (!(update.state === 'idle' || update.state === 'current' || update.state === 'check-failed')) return;
      setUpdate(UPDATES.checking);
      await pause(800);
      setUpdate(UPDATES.available);
    },
    // Like main: only once a check found a version, and again after a failed download.
    downloadUpdate: async () => {
      if (update.state !== 'available' && update.state !== 'download-failed') return;
      const { version } = update;
      for (const percent of [0, 9, 23, 42, 61, 78, 93, 99]) {
        setUpdate({ state: 'downloading', version, percent });
        await pause(400);
      }
      const error = failNextDownload;
      failNextDownload = undefined;
      setUpdate(error ? { state: 'download-failed', version, error } : { state: 'ready', version });
    },
    // Like main, which then turns every VPN off and quits into the new version: fake-api turns them off, nothing quits.
    restartToUpdate: async () => {
      if (update.state === 'ready') setUpdate({ state: 'restarting', version: update.version });
    },
    onUpdate: (listener: (state: UpdateState) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  } satisfies Partial<MainApi>;

  return {
    api,
    /** Main reports this update state, e.g. `fake.setUpdate(UPDATES.ready)`. */
    setUpdate,
    /** The next download runs to the end, then fails with this message. */
    failNextDownload: (message: string) => void (failNextDownload = message),
  };
}
