import { applySecretChanges, changesForSave, compileRoutes, Config, type ConnectionState, type ConnectResult, type DockerState, effectiveRules, type HelperState, keepServerRoutes, newVpn, parseSite, isIpv4, rankVpns, ROUTING_RESERVED_RANGE, type RouteRule, routeFor, type SecretChanges, type SecretMap, secretStatusOf, type TrafficSnapshot, validateSecretChanges, vpnHosts } from "@repo/core";
import type { MainApi } from "../../../preload/index.ts";
import type { ConnectionStatuses, UpdateState } from "../../../shared/ipc-contract.ts";
import { createFakeUpdater, UPDATES } from "./fake-update.ts";

/**
 * A main process in memory, for the store's tests and the browser harness: the same MainApi the preload
 * exposes, over a scenario's VPNs. Deterministic: waits go through `pause` (instant unless the harness
 * passes a real one), and the controls next to `api` set what main would report or answer next.
 * Never imported by the app itself.
 */

export const SCENARIOS = ["first", "daily", "overlap", "shared", "broke"] as const;

export type Scenario = (typeof SCENARIOS)[number];

// newVpn's defaults (no DNS, no extra options, server routes unknown), but with the password remembered.
const common = { rememberPassword: true };

const gp = (id: string, name: string) => ({ ...newVpn("globalprotect", { id, name }), ...common, portal: "vpn.client-a.example", username: "jane.doe" });

const VPNS = {
  a: { ...gp("a", "Client A"), signIn: "card", rememberPassword: false, serverRoutes: { all: true, cidrs: [] } },
  a2: { ...gp("a2", "Client A (test)"), username: "svc-jane-test", serverRoutes: { all: true, cidrs: [] } },
  b: {
    ...newVpn("checkpoint", { id: "b", name: "Client B" }),
    ...common,
    server: "remote.client-b.example",
    loginType: "vpn_OTP",
    username: "jdoe",
    serverRoutes: { all: false, cidrs: ["10.140.0.0/16", "172.24.0.0/14"] },
  },
  c: { ...newVpn("fortinet-ssl", { id: "c", name: "Client C" }), ...common, traffic: "sites", rememberPassword: false, gateway: "sslvpn.client-c.example:10443", username: "jane" },
  e: { ...gp("e", "Client E"), portal: "gp.client-e.example", username: "jane", serverRoutes: { all: false, cidrs: ["10.140.0.0/16", "10.141.0.0/16"] } },
  h: { ...newVpn("openvpn", { id: "h", name: "Home OpenVPN" }), ...common, remotes: ["home.example.net"], serverRoutes: { all: true, cidrs: [] } },
} satisfies Record<string, Config["vpns"][number]>;

const route = (id: string, vpnId: string, target: string): RouteRule =>
  /^[\d./]+$/.test(target) ? { id, vpnId, kind: "cidr", cidr: target, enabled: true, note: "", pinned: false } : { id, vpnId, kind: "domain", domain: target, enabled: true, note: "", pinned: false };

const CONFIGS: Record<Scenario, Config> = {
  first: { version: 1, vpns: [], routes: [], priority: [] },
  daily: {
    version: 1,
    vpns: [VPNS.a, VPNS.a2, VPNS.b, VPNS.c, VPNS.h],
    routes: [route("r1", "b", "10.140.0.0/16"), route("r2", "b", "client-b.internal"), route("r3", "c", "jira.client-c.example"), route("r4", "c", "10.142.12.0/24")],
    priority: [],
  },
  overlap: { version: 1, vpns: [VPNS.a, VPNS.b, VPNS.e, VPNS.c, VPNS.h], routes: [route("r1", "b", "10.140.0.0/16"), route("r3", "c", "jira.client-c.example")], priority: [] },
  shared: {
    version: 1,
    vpns: [VPNS.a, VPNS.b, VPNS.c, VPNS.h],
    routes: [route("r1", "b", "10.140.0.0/16"), route("r5", "b", "10.143.1.20/32"), route("r3", "c", "jira.client-c.example"), route("r6", "c", "10.143.1.20/32")],
    priority: [],
  },
  broke: { version: 1, vpns: [VPNS.a, VPNS.a2, VPNS.b, VPNS.c, VPNS.h], routes: [route("r1", "b", "10.140.0.0/16"), route("r3", "c", "jira.client-c.example")], priority: [] },
};

/** Fixtures whose launcher needs the password before it starts (Fortinet SSL's does); the rest sign in without one. */
const ASKS_FOR_PASSWORD = new Set(["c"]);

const CONNECTED_AT_START: Record<Scenario, string[]> = { first: [], daily: ["a", "b"], overlap: ["b", "e", "h"], shared: ["a", "b", "c"], broke: [] };

/** Hosts each VPN's traffic goes to, for the harness's made-up traffic. */
export const HOSTS: Record<string, string[]> = {
  a: ["github.com", "slack.com", "www.google.com", "api.spotify.com"],
  b: ["10.140.3.17", "wiki.client-b.internal", "10.140.0.26"],
  c: ["jira.client-c.example", "10.142.12.11"],
  e: ["10.141.0.11", "10.141.2.9"],
  h: ["www.youtube.com", "registry.npmjs.org", "outlook.office.com"],
};

/** What every name the fake looks up resolves to: a public address (TEST-NET-3), as most sites are. */
const PUBLIC_ADDRESS = "203.0.113.10";

export type FakeApi = ReturnType<typeof createFakeApi>;

export function createFakeApi({
  scenario = "daily",
  update = UPDATES.idle,
  pause = async () => {},
}: { scenario?: Scenario; update?: UpdateState; pause?: (ms: number) => Promise<void> } = {}) {
  let config = structuredClone(CONFIGS[scenario]);
  // Kept in memory as main keeps them encrypted on disk; only which slots are stored ever leaves.
  let secrets: SecretMap<string> = { b: { password: "saved" }, a2: { password: "saved" }, h: { profile: "client\nremote home.example.net\n" } };
  let docker: DockerState = scenario === "first" ? "stopped" : "running";
  let helper: HelperState = scenario === "first" ? "not-installed" : "ready";
  let statuses: ConnectionStatuses = {};
  for (const id of CONNECTED_AT_START[scenario]) statuses[id] = { state: "connected", since: Date.now() - 600_000, warning: undefined, log: [] };
  if (scenario === "broke") {
    statuses.c = {
      state: "error",
      message: "The VPN server rejected the username or password.",
      log: ["Preparing…", "Starting the VPN container…", "POST https://sslvpn.client-c.example:10443/remote/logincheck", "Got HTTP 401"],
    };
  }

  const listeners = {
    status: new Set<(statuses: ConnectionStatuses) => void>(),
    traffic: new Set<(snapshot: TrafficSnapshot) => void>(),
    config: new Set<(config: Config) => void>(),
  };
  const subscribe = <T>(set: Set<(payload: T) => void>, listener: (payload: T) => void) => {
    set.add(listener);
    return () => void set.delete(listener);
  };
  const setStatus = (vpnId: string, state: ConnectionState | undefined) => {
    statuses = { ...statuses };
    if (state) statuses[vpnId] = { log: [], ...state };
    else delete statuses[vpnId];
    listeners.status.forEach((listener) => listener(structuredClone(statuses)));
  };

  const updater = createFakeUpdater(update, pause);

  // As in the engine: a connect already running is shared by repeated requests, and a disconnect cancels it.
  const inFlight = new Map<string, Promise<ConnectResult>>();
  const disconnects = new Map<string, number>();

  // What the next calls answer, set through the controls below.
  let loadError: string | undefined;
  const connectResults: ConnectResult[] = [];
  let failNextConnect: string | undefined;
  let rejectNextSave: string | undefined;
  /** While saves or loads are held, each waits here until released, oldest first. */
  let heldSaves: (() => void)[] | undefined;
  let heldLoads: (() => void)[] | undefined;

  /** What the store asked main to do, oldest first. */
  const calls = { connects: [] as { vpnId: string; password: string | null }[], disconnects: [] as string[], saves: [] as { config: Config; secrets: SecretChanges }[] };

  async function startConnect(vpnId: string, password: string | null): Promise<ConnectResult> {
    const disconnectsBefore = disconnects.get(vpnId) ?? 0;
    const cancelled = () => (disconnects.get(vpnId) ?? 0) !== disconnectsBefore;
    const scripted = connectResults.shift();
    if (scripted && !scripted.ok) return scripted;
    const vpn = config.vpns.find((candidate) => candidate.id === vpnId);
    if (!scripted && ASKS_FOR_PASSWORD.has(vpnId) && !vpn?.rememberPassword && !password) return { ok: false, needsPassword: true };
    setStatus(vpnId, { state: "connecting", step: "Starting the VPN container…" });
    await pause(900);
    if (cancelled()) return { ok: false, error: "Cancelled." };
    if (failNextConnect) {
      const message = failNextConnect;
      failNextConnect = undefined;
      setStatus(vpnId, { state: "error", message });
      return { ok: false, error: message };
    }
    setStatus(vpnId, { state: "connecting", step: "Routing traffic…" });
    await pause(500);
    if (cancelled()) return { ok: false, error: "Cancelled." };
    setStatus(vpnId, { state: "connected", since: Date.now(), warning: undefined });
    return { ok: true };
  }

  const api: MainApi = {
    loadConfig: async () => {
      if (loadError) throw new Error(loadError);
      // Read now, answer when released: like main, whose answer can arrive after newer saves have landed.
      const answer = { path: "/home/jane/.config/multi-vpn-client/config.json", config: structuredClone(config), secretStatus: secretStatusOf(secrets), keychainProblem: undefined };
      if (heldLoads) await new Promise<void>((resolve) => heldLoads?.push(resolve));
      return answer;
    },
    saveConfig: async (next, changes) => {
      calls.saves.push({ config: next, secrets: changes });
      if (heldSaves) await new Promise<void>((resolve) => heldSaves?.push(resolve));
      if (rejectNextSave) {
        const message = rejectNextSave;
        rejectNextSave = undefined;
        return { ok: false, issues: [{ path: "", message }] };
      }
      // The rules main saves by, minus the disk and the keychain.
      const parsed = Config.safeParse(structuredClone(next));
      if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) };
      const merged = changesForSave(config.vpns, parsed.data.vpns, changes);
      const problems = validateSecretChanges(merged, parsed.data.vpns);
      if (problems.length > 0) return { ok: false, issues: problems.map((message) => ({ path: "secrets", message })) };
      config = { ...parsed.data, vpns: keepServerRoutes(config.vpns, parsed.data.vpns) };
      secrets = applySecretChanges(secrets, merged, config.vpns);
      return { ok: true, config: structuredClone(config), secretStatus: secretStatusOf(secrets) };
    },
    detect: async (address) => {
      await pause(400);
      if (/forti|sslvpn|10443/.test(address)) return { kind: "fortinet-ssl", address: address.includes(":") ? address : `${address}:10443` };
      if (/remote|checkpoint/.test(address)) return { kind: "checkpoint", address };
      if (/unknown|example\.org/.test(address)) return { kind: "unknown" };
      return { kind: "globalprotect", address, browserSignIn: /sso/.test(address) };
    },
    // Routes as main does (connected VPNs, priority, traffic modes); only the name lookup is made up.
    checkRoute: async (text) => {
      const parsed = parseSite(text);
      if (!parsed) return { site: null };
      const live = rankVpns(config).filter((vpn) => statuses[vpn.id]?.state === "connected");
      // What main keeps off every tunnel too: the domain-routing range and the VPNs' servers (here only those given as addresses).
      const servers = live.flatMap((vpn) => vpnHosts(vpn).filter(isIpv4).map((host) => ({ cidr: `${host}/32`, label: `${vpn.name}'s server` })));
      const reserved = [{ cidr: ROUTING_RESERVED_RANGE, label: "Domain routing" }, ...servers];
      const compiled = compileRoutes({ vpns: live, routes: live.flatMap((vpn) => effectiveRules(vpn, config.routes)), reserved });
      const target = parsed.isAddress ? { addresses: [parsed.site] } : { domain: parsed.site, addresses: [PUBLIC_ADDRESS] };
      return { site: parsed.site, vpnId: routeFor(compiled, target) ?? null };
    },
    dockerState: async () => docker,
    startDocker: async () => {
      await pause(800);
      docker = "running";
      return { ok: true };
    },
    connect: async (vpnId, password) => {
      calls.connects.push({ vpnId, password });
      const running = inFlight.get(vpnId);
      if (running) return running;
      const attempt = startConnect(vpnId, password);
      inFlight.set(vpnId, attempt);
      void attempt.finally(() => inFlight.get(vpnId) === attempt && inFlight.delete(vpnId));
      return attempt;
    },
    disconnect: async (vpnId) => {
      calls.disconnects.push(vpnId);
      disconnects.set(vpnId, (disconnects.get(vpnId) ?? 0) + 1);
      inFlight.delete(vpnId);
      setStatus(vpnId, undefined);
    },
    connectionStatuses: async () => structuredClone(statuses),
    answer: async () => {},
    reopenSignIn: async () => {},
    runAction: async (kind, name) => {
      if (kind === "checkpoint" && name === "loginTypes")
        return [
          { id: "vpn_Username_Password", label: "Username and password", factors: ["password"] },
          { id: "vpn_OTP", label: "MFA", factors: ["password", "otp"] },
          { id: "vpn_EntraID", label: "Microsoft sign-in", factors: ["identity_provider"] },
        ];
      throw new Error("This VPN type has no such action.");
    },
    trustCertificate: async () => structuredClone(config),
    helperState: async () => ({ state: helper, logHint: "/var/log/mvpn-helper.log" }),
    installHelper: async () => {
      await pause(600);
      helper = "ready";
      return { ok: true };
    },
    uninstallHelper: async () => {
      helper = "not-installed";
      return { ok: true };
    },
    appInfo: async () => ({ version: "0.1.0", platform: "linux" }),
    showConfig: async () => {},
    fitWindow: async () => {},
    onConnectionStatus: (listener) => subscribe(listeners.status, listener),
    onTraffic: (listener) => subscribe(listeners.traffic, listener),
    onConfigChanged: (listener) => subscribe(listeners.config, listener),
    ...updater.api,
    // Like main before it quits: every VPN off, one at a time.
    restartToUpdate: async () => {
      await updater.api.restartToUpdate();
      if ((await updater.api.updateState()).state !== "restarting") return;
      for (const vpnId of Object.keys(statuses)) {
        await pause(1200);
        setStatus(vpnId, undefined);
      }
    },
  };

  return {
    api,
    calls,
    /** The settings as main has them now. */
    config: () => config,
    statuses: () => statuses,
    setDocker: (state: DockerState) => void (docker = state),
    setHelper: (state: HelperState) => void (helper = state),
    /** Main sends live traffic. */
    sendTraffic: (snapshot: TrafficSnapshot) => listeners.traffic.forEach((listener) => listener(snapshot)),
    /** Main saved the config itself (e.g. learned a server's routes) and says so. */
    sendConfigChanged: (next: Config) => {
      config = structuredClone(next);
      listeners.config.forEach((listener) => listener(structuredClone(next)));
    },
    failLoad: (message: string) => void (loadError = message),
    /** The next connect answers this instead of connecting. */
    answerNextConnect: (result: ConnectResult) => void connectResults.push(result),
    /** The next connect starts, then fails with this message (as a rejected login does). */
    failNextConnect: (message: string) => void (failNextConnect = message),
    rejectNextSave: (message: string) => void (rejectNextSave = message),
    setUpdate: updater.setUpdate,
    failNextDownload: updater.failNextDownload,
    askRestart: updater.askRestart,
    /** From now on saves wait; the returned function lets the oldest waiting one finish. */
    holdSaves: () => {
      heldSaves = [];
      return () => heldSaves?.shift()?.();
    },
    holdLoads: () => {
      heldLoads = [];
      return () => heldLoads?.shift()?.();
    },
  };
}
