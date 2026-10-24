import { compareVersions, type Manifest } from "@repo/release";
import type { UpdateState } from "../shared/ipc-contract.ts";

/** How often a running app asks npm for a newer version. Settings → About says it in words. */
const CHECK_EVERY_MS = 60 * 60 * 1000;
/** Bringing the window to the front asks npm too, unless it was asked this recently. */
const ASKED_RECENTLY_MS = 15 * 60 * 1000;
/** npm often answers within a frame or two: "Checking npm…" stays at least this long, so a click visibly did something. */
const CHECKING_AT_LEAST_MS = 1000;

export type Updater = ReturnType<typeof createUpdater>;

/**
 * Updating the app in place. npm says what's newest; the release is downloaded into the launcher's versions folder
 * the way the launcher does it, only when the user asks, and the next start (a restart or `npx multi-vpn-client`)
 * runs it. The edges come in as functions, so the decisions here run in tests without npm or a disk.
 */
export function createUpdater(deps: {
  version: string;
  /** Development builds report a release's version, but never update. */
  packaged: boolean;
  /** "linux-x64" etc.: whose archive's size to show. */
  target: string;
  latest: () => Promise<Manifest>;
  /** Downloads, checks and unpacks a release (at once, when it already is), reporting the share done (0 to 1). */
  download: (release: Manifest, onProgress: (share: number) => void) => Promise<unknown>;
  onChange: (state: UpdateState) => void;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}) {
  const { now = Date.now, wait = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } = deps;
  let state: UpdateState = deps.packaged ? { state: "idle" } : { state: "off" };
  let release: Manifest | undefined;
  let askedAt = Number.NEGATIVE_INFINITY;

  const set = (next: UpdateState) => {
    state = next;
    deps.onChange(next);
  };
  const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const ask = () => {
    askedAt = now();
    return deps.latest();
  };

  /** What npm's newest means: an offer when it's newer than this version and than one already offered. */
  function found(latest: Manifest) {
    if (compareVersions(latest.version, deps.version) > 0) {
      if (state.state === "available" && compareVersions(latest.version, state.version) <= 0) return;
      release = latest;
      set({ state: "available", version: latest.version, size: latest.archives[deps.target]?.size });
    } else if (state.state !== "available") set({ state: "current", checkedAt: now() });
  }

  /** The Check button: says it's checking, then what npm said. Not while a newer version is known or on its way. */
  async function check() {
    if (!(state.state === "idle" || state.state === "current" || state.state === "check-failed")) return;
    set({ state: "checking" });
    const answer = ask();
    await Promise.allSettled([answer, wait(CHECKING_AT_LEAST_MS)]);
    try {
      found(await answer);
    } catch (error) {
      set({ state: "check-failed", error: messageOf(error) });
    }
  }

  /**
   * A check nobody clicked: it shows only a newer version, or why it failed while nothing is known yet, so the window
   * doesn't flicker or turn red each time it comes to the front offline. Stops once a download starts.
   */
  async function checkQuietly() {
    const settled = () => ["idle", "current", "check-failed", "available"].includes(state.state);
    if (!settled()) return;
    try {
      const latest = await ask();
      // The user may have started a check or a download meanwhile; theirs wins.
      if (settled()) found(latest);
    } catch (error) {
      if (state.state === "idle") set({ state: "check-failed", error: messageOf(error) });
    }
  }

  /** Downloads the version a check found; again after a failed download. */
  async function download() {
    if (!release || !(state.state === "available" || state.state === "download-failed")) return;
    const { version } = release;
    set({ state: "downloading", version, percent: 0 });
    try {
      await deps.download(release, (share) => {
        // 100% only once it's unpacked too, which is "ready".
        const percent = Math.min(99, Math.floor(share * 100));
        if (state.state === "downloading" && percent > state.percent) set({ state: "downloading", version, percent });
      });
      set({ state: "ready", version });
    } catch (error) {
      set({ state: "download-failed", version, error: messageOf(error) });
    }
  }

  /** Marks the downloaded version as the one to restart into, once; undefined when none is ready (or it already is). */
  function markRestarting() {
    if (state.state !== "ready") return undefined;
    const { version } = state;
    set({ state: "restarting", version });
    return version;
  }

  return {
    state: () => state,
    check,
    download,
    markRestarting,
    /** Checks now and every hour after. Development builds never check. */
    start() {
      if (!deps.packaged) return;
      void checkQuietly();
      setInterval(() => void checkQuietly(), CHECK_EVERY_MS);
    },
    /** The window came to the front: checks, unless npm was asked in the last 15 minutes. */
    windowFocused() {
      if (deps.packaged && now() - askedAt >= ASKED_RECENTLY_MS) void checkQuietly();
    },
  };
}
