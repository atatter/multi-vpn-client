import type { Config, DockerState, SecretChanges, SecretStatus, TrafficSnapshot } from "@repo/core";
import { createContext, useContext, useSyncExternalStore } from "react";
import type { MainApi } from "../../../preload/index.ts";
import type { AppInfo, ConnectionStatuses, HelperInfo } from "../../../shared/ipc-contract.ts";
import type { Prompt, Screen } from "./screen.ts";

export interface AppModel {
  /** The bridge to the main process, for one-off questions (detect, checkRoute, …). Only main.tsx touches window.main. */
  api: MainApi;
  /** The saved config: connections always use saved settings, so the UI shows only that. */
  config: Config;
  secretStatus: SecretStatus;
  /** Why secrets can't be stored on this machine, if they can't. */
  keychainProblem: string | undefined;
  /** Where the settings file lives. */
  configPath: string;
  info: AppInfo;
  connections: ConnectionStatuses;
  /** Live traffic, read through useTraffic: a new snapshot each second re-renders only the views that show it. */
  trafficFeed: { subscribe: (listener: () => void) => () => void; get: () => TrafficSnapshot };
  helper: HelperInfo | undefined;
  docker: DockerState | undefined;
  /** Starting Docker, from whichever screen: every screen shows it, and its error until Docker runs or is started again. */
  dockerStart: { starting: boolean; error: string | undefined };
  /** VPNs turned on before Docker or the network helper were ready: they connect by themselves once both are. */
  waiting: ReadonlySet<string>;
  prompt: Prompt | undefined;
  /** A failed save or action, shown under the title bar until dismissed. */
  notice: string | undefined;
  dismissNotice: () => void;
  /** Shows a problem under the title bar, e.g. a dropped file that isn't a VPN profile. */
  showNotice: (text: string) => void;
  push: (screen: Screen) => void;
  back: () => void;
  home: () => void;
  /** Saves the whole config plus secret edits; shows the problem and returns false if it's rejected. */
  save: (config: Config, secrets?: SecretChanges) => Promise<boolean>;
  /** On turns a VPN on; on a VPN that's on (connecting, connected or failed) turns it off. */
  toggle: (vpnId: string) => void;
  /** Turns a VPN off whatever it's doing: drops its prompt or wait, and disconnects it if it's on. */
  turnOff: (vpnId: string) => Promise<void>;
  /** Connects with the saved settings (e.g. right after adding it). */
  connect: (vpnId: string) => Promise<void>;
  /** Disconnects and connects again with the newly saved settings. */
  reconnect: (vpnId: string) => Promise<void>;
  submitPassword: (password: string, remember: boolean) => void;
  /** Answers what a connecting VPN's client asks for (its "awaiting-code" state); null cancels the connect. */
  answer: (vpnId: string, reply: string | null) => void;
  /** Opens a VPN's browser sign-in page again. */
  reopenSignIn: (vpnId: string) => void;
  trustCertificate: () => void;
  cancelPrompt: () => void;
  /** Runs a network helper action; resolves to its error, if any. */
  runHelper: (action: "install" | "uninstall") => Promise<string | undefined>;
  /** Starts Docker, or joins the start already running; dockerStart shows how it goes. */
  startDocker: () => Promise<void>;
}

export const AppContext = createContext<AppModel | null>(null);

export function useApp(): AppModel {
  const model = useContext(AppContext);
  if (!model) throw new Error("useApp needs the AppContext provider");
  return model;
}

/** The latest traffic snapshot from main, kept current. */
export function useTraffic(): TrafficSnapshot {
  const { trafficFeed } = useApp();
  return useSyncExternalStore(trafficFeed.subscribe, trafficFeed.get);
}
