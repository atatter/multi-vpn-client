import { type Config, keepServerRoutes, PASSWORD_SLOT, type SecretChanges, type TrafficSnapshot } from "@repo/core";
import type { MainApi } from "../../../preload/index.ts";
import type { AppInfo, Loaded } from "../../../shared/ipc-contract.ts";
import { isOn } from "../domain/connection.ts";
import { setupBlocker } from "../domain/setup-copy.ts";
import type { AppModel } from "./app-model.ts";
import { messageOf } from "./errors.ts";

/** Moving between screens: App's own state, not the store's. The store's view is everything else. */
export type Navigation = Pick<AppModel, "push" | "back" | "home">;

/** What the window shows: still loading, settings that couldn't load, or the app. Replaced on every change, never mutated. */
export type AppView = { phase: "loading" } | { phase: "failed"; error: string } | ({ phase: "ready" } & Omit<AppModel, keyof Navigation>);

export type AppStore = ReturnType<typeof createAppStore>;

/** The store's own state; the view adds the commands to it. */
interface State extends Pick<AppModel, "connections" | "helper" | "docker" | "waiting" | "prompt" | "notice"> {
  loaded: (Loaded & { info: AppInfo }) | undefined;
  loadError: string | undefined;
}

const NO_TRAFFIC: TrafficSnapshot = { rates: {}, destinations: [] };

const HELPER_RECHECK_MS = 3000;

const DOCKER_RECHECK_MS = { running: 30_000, other: 3000 };

/**
 * The window's state and everything it can do, given the bridge to the main process. Plain TS, so it runs
 * (and is tested) without React or Electron; App reads it through useSyncExternalStore. `start` loads the
 * settings, follows main's events and checks setup; it runs once per store and returns `stop`.
 */
export function createAppStore(api: MainApi) {
  let state: State = {
    loaded: undefined,
    loadError: undefined,
    connections: {},
    helper: undefined,
    docker: undefined,
    waiting: new Set(),
    prompt: undefined,
    notice: undefined,
  };
  let view: AppView = { phase: "loading" };
  const listeners = new Set<() => void>();
  // Saves run one after another, so a quick toggle after a reorder can't land first.
  let saves: Promise<unknown> = Promise.resolve();
  /** Counts saves started, so a save's answer knows whether a newer change is still on its way. */
  let latestSave = 0;

  const update = (change: Partial<State> | ((current: State) => Partial<State>)) => {
    state = { ...state, ...(typeof change === "function" ? change(state) : change) };
    view = viewOf(state);
    listeners.forEach((listener) => listener());
  };
  /** Changes the loaded settings; before they've loaded there's nothing to change. */
  const updateLoaded = (change: (loaded: NonNullable<State["loaded"]>) => Partial<Loaded>) =>
    update((current) => (current.loaded ? { loaded: { ...current.loaded, ...change(current.loaded) } } : {}));
  const showNotice = (notice: string) => update({ notice });

  // Traffic changes every second, so it has its own subscribers instead of re-rendering everything.
  let traffic = NO_TRAFFIC;
  const trafficListeners = new Set<() => void>();
  const trafficFeed = {
    get: () => traffic,
    subscribe: (listener: () => void) => {
      trafficListeners.add(listener);
      return () => void trafficListeners.delete(listener);
    },
  };

  /** Docker and the helper are ready (or not known yet), so connecting can start. */
  const ready = () => !setupBlocker(state.docker, state.helper);

  // VPNs turned on before setup was done connect by themselves once Docker and the helper are ready,
  // so this runs whenever either is checked.
  function connectWaiting() {
    if (!ready() || state.waiting.size === 0) return;
    const ids = [...state.waiting];
    update({ waiting: new Set() });
    for (const vpnId of ids) void connect(vpnId);
  }

  const setSetup = (change: Pick<Partial<State>, "docker" | "helper">) => {
    update(change);
    connectWaiting();
  };
  const refreshHelper = () => void api.helperState().then((helper) => setSetup({ helper }));
  const refreshDocker = () => api.dockerState().then((docker) => setSetup({ docker }), () => setSetup({ docker: "missing" }));

  /** Shows what's on disk, unless `stillWanted` says otherwise by the time it's read. */
  const reload = async (stillWanted: () => boolean) => {
    const { config, secretStatus } = await api.loadConfig();
    if (stillWanted()) updateLoaded(() => ({ config, secretStatus }));
  };

  /** Shows the change right away, saves it in order, and puts back what's on disk if it's rejected. */
  async function save(config: Config, secrets: SecretChanges = {}) {
    const revision = ++latestSave;
    const isLatest = () => revision === latestSave;
    updateLoaded(() => ({ config }));
    const run = saves.then(() => api.saveConfig(config, secrets));
    saves = run.catch(() => undefined);
    try {
      const result = await run;
      if (result.ok) {
        // A newer change made while this one saved stays on screen; it's queued behind.
        updateLoaded((loaded) => ({ config: isLatest() ? result.config : loaded.config, secretStatus: result.secretStatus }));
        return true;
      }
      showNotice(result.issues.map((issue) => issue.message).join("\n"));
    } catch (error) {
      showNotice(messageOf(error));
    }
    // Put back what's on disk, unless a newer change is on its way (or starts meanwhile): its answer settles what's shown.
    if (isLatest()) await reload(isLatest);
    return false;
  }

  /**
   * Connects; a missing password or an untrusted certificate opens a prompt in the row instead. Before
   * Docker and the helper are ready, the VPN waits instead of failing, and connects once they are.
   */
  async function connect(vpnId: string, password?: string) {
    update({ prompt: undefined });
    if (!ready()) return update((current) => ({ waiting: new Set([...current.waiting, vpnId]) }));
    try {
      const result = await api.connect(vpnId, password ?? null);
      if (result.ok) return;
      if ("needsPassword" in result) update({ prompt: { kind: "password", vpnId } });
      else if ("untrustedCertificate" in result) update({ prompt: { kind: "certificate", vpnId, ...result.untrustedCertificate, password } });
      // Other failures arrive as the VPN's error status.
    } catch (error) {
      showNotice(messageOf(error));
    }
  }

  const withoutWaiting = (vpnId: string) => update((current) => ({ waiting: new Set([...current.waiting].filter((id) => id !== vpnId)) }));

  /** Runs a setup fix; resolves to its error, if any, and checks the state again either way. */
  const runFix = async (fix: () => Promise<{ ok: true } | { ok: false; error: string }>, recheck: () => unknown) => {
    try {
      const result = await fix();
      return result.ok ? undefined : result.error;
    } catch (error) {
      return messageOf(error);
    } finally {
      recheck();
    }
  };

  // Created once: the view hands out the same functions on every change.
  const commands = {
    api,
    dismissNotice: () => update({ notice: undefined }),
    showNotice,
    trafficFeed,
    save,
    toggle: (vpnId) => {
      if (state.prompt?.vpnId === vpnId) return update({ prompt: undefined });
      if (state.waiting.has(vpnId)) return withoutWaiting(vpnId);
      // On means "keep trying": a failed VPN switches off (clearing its error) rather than retrying.
      if (isOn(state.connections[vpnId])) void api.disconnect(vpnId).catch((error: unknown) => showNotice(messageOf(error)));
      else void connect(vpnId);
    },
    turnOff: async (vpnId) => {
      if (state.prompt?.vpnId === vpnId) update({ prompt: undefined });
      if (state.waiting.has(vpnId)) withoutWaiting(vpnId);
      if (isOn(state.connections[vpnId])) await api.disconnect(vpnId);
    },
    connect: (vpnId) => connect(vpnId),
    reconnect: async (vpnId) => {
      await api.disconnect(vpnId);
      await connect(vpnId);
    },
    submitPassword: (password, remember) => {
      const { prompt, loaded } = state;
      if (prompt?.kind !== "password" || !loaded) return;
      const { vpnId } = prompt;
      update({ prompt: undefined });
      void (async () => {
        if (remember) {
          const vpns = loaded.config.vpns.map((vpn) => (vpn.id === vpnId ? { ...vpn, rememberPassword: true } : vpn));
          await save({ ...loaded.config, vpns }, { [vpnId]: { [PASSWORD_SLOT.key]: password } });
        }
        await connect(vpnId, password);
      })();
    },
    answer: (vpnId, reply) => void api.answer(vpnId, reply).catch((error: unknown) => showNotice(messageOf(error))),
    reopenSignIn: (vpnId) => void api.reopenSignIn(vpnId).catch((error: unknown) => showNotice(messageOf(error))),
    // Main saves the pin the gateway actually presented, never one from here.
    trustCertificate: () => {
      const { prompt } = state;
      if (prompt?.kind !== "certificate") return;
      const { vpnId, password } = prompt;
      update({ prompt: undefined });
      void api.trustCertificate(vpnId).then(
        (config) => {
          updateLoaded(() => ({ config }));
          return connect(vpnId, password);
        },
        (error: unknown) => showNotice(messageOf(error)),
      );
    },
    cancelPrompt: () => update({ prompt: undefined }),
    runHelper: (action) => runFix(action === "install" ? api.installHelper : api.uninstallHelper, refreshHelper),
    startDocker: () => runFix(api.startDocker, refreshDocker),
  } satisfies Omit<AppModel, keyof State | keyof Loaded | keyof Navigation | "configPath" | "info">;

  function viewOf(current: State): AppView {
    if (current.loadError !== undefined) return { phase: "failed", error: current.loadError };
    const { loaded, loadError: _loadError, ...rest } = current;
    if (!loaded) return { phase: "loading" };
    const { path, info, config, secretStatus, keychainProblem } = loaded;
    return { phase: "ready", ...rest, config, secretStatus, keychainProblem, configPath: path, info, ...commands };
  }

  let stop: (() => void) | undefined;

  return {
    api,
    getState: () => view,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Loads the settings, follows main's events and keeps checking setup. Once per store; returns `stop`. */
    start(): () => void {
      if (stop) return stop;
      Promise.all([api.loadConfig(), api.appInfo()]).then(
        ([loaded, info]) => update({ loaded: { ...loaded, info } }),
        (error: unknown) => update({ loadError: messageOf(error) }),
      );
      void api.connectionStatuses().then((connections) => update({ connections }));
      const unsubscribe = [
        api.onConnectionStatus((connections) => update({ connections })),
        api.onTraffic((snapshot) => {
          traffic = snapshot;
          trafficListeners.forEach((listener) => listener());
        }),
        // The app learned what a server sends: take only that, so a save still on its way isn't undone on screen.
        api.onConfigChanged((saved) => updateLoaded((loaded) => ({ config: { ...loaded.config, vpns: keepServerRoutes(saved.vpns, loaded.config.vpns) } }))),
      ];

      // A helper that isn't responding may just be starting, so it's checked again until it answers.
      refreshHelper();
      const helperTimer = setInterval(() => state.helper?.state === "not-responding" && refreshHelper(), HELPER_RECHECK_MS);

      // Docker is checked often while it isn't running (someone may be starting it), rarely once it is.
      let dockerTimer: ReturnType<typeof setTimeout> | undefined;
      let stopped = false;
      const checkDocker = () =>
        void refreshDocker().then(() => {
          if (!stopped) dockerTimer = setTimeout(checkDocker, state.docker === "running" ? DOCKER_RECHECK_MS.running : DOCKER_RECHECK_MS.other);
        });
      checkDocker();

      stop = () => {
        stopped = true;
        unsubscribe.forEach((off) => off());
        clearInterval(helperTimer);
        clearTimeout(dockerTimer);
      };
      return stop;
    },
  };
}
