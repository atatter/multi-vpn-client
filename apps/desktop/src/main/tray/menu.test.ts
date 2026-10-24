import { type ConnectionStatus, newVpn } from "@repo/core";
import type { NativeImage } from "electron";
import type { UpdateState } from "../../shared/ipc-contract.ts";
import { describe, expect, it } from "vitest";
import { idsOn, namesOn, countHeadline, trayMenu, updateItem } from "./menu.ts";

const vpn = (id: string, name: string) => newVpn("openvpn", { id, name });

describe("the VPNs that are on", () => {
  it("are only the connected ones", () => {
    const statuses: Record<string, ConnectionStatus> = {
      b: { state: "connected", since: 1, warning: undefined, log: [] },
      a: { state: "connected", since: 2, warning: "slow", log: [] },
      c: { state: "connecting", step: "Starting…", log: [] },
      d: { state: "error", message: "No route", log: [] },
      e: { state: "awaiting-code", prompt: "Code", secret: true, log: [] },
      f: { state: "disconnected", log: [] },
    };
    expect(idsOn(statuses)).toEqual(["a", "b"]);
    expect(idsOn({})).toEqual([]);
  });

  it("are named highest priority first", () => {
    const config = { vpns: [vpn("a", "Client A"), vpn("b", "Client B"), vpn("c", "Client C")], priority: ["c", "b", "a"] };
    expect(namesOn(["a", "c"], config)).toEqual(["Client C", "Client A"]);
  });

  it("are counted in words", () => {
    expect([0, 1, 2, 12].map(countHeadline)).toEqual(["No VPNs on", "1 VPN on", "2 VPNs on", "12 VPNs on"]);
  });
});

describe("the update's item", () => {
  const actions = { download: () => {}, restart: () => {} };
  const item = (update: UpdateState) => updateItem(update, actions);

  it("is there for an update to download, being downloaded or restarting into, and not otherwise", () => {
    expect(item({ state: "available", version: "0.2.0", size: 180_000_000 })).toMatchObject({ label: "Update to 0.2.0 (180 MB)", click: actions.download });
    expect(item({ state: "available", version: "0.2.0", size: undefined })?.label).toBe("Update to 0.2.0");
    expect(item({ state: "downloading", version: "0.2.0", percent: 42 })).toEqual({ label: "Downloading 0.2.0… 42%", enabled: false });
    expect(item({ state: "download-failed", version: "0.2.0", error: "HTTP 404." })).toMatchObject({ label: "Couldn't download 0.2.0. Try again", click: actions.download });
    expect(item({ state: "restarting", version: "0.2.0" })).toEqual({ label: "Restarting to update to 0.2.0…", enabled: false });
    for (const update of [{ state: "off" }, { state: "idle" }, { state: "checking" }, { state: "current", checkedAt: 0 }, { state: "check-failed", error: "Offline." }] as const) {
      expect(item(update)).toBeUndefined();
    }
  });

  it("says that restarting turns the VPNs off, as quitting does", () => {
    expect(item({ state: "ready", version: "0.2.0" })).toMatchObject({ label: "Restart to update and turn off VPNs", click: actions.restart });
  });
});

describe("the tray menu", () => {
  const parts = { dot: {} as NativeImage, update: undefined, open: () => {}, quit: () => {} };

  it("lists the VPNs that are on, then opening the window and quitting", () => {
    const menu = trayMenu({ ...parts, count: 2, names: ["Client A", "Client B"], quitShortcut: "Command+Q" });
    expect(menu.map((item) => item.label ?? item.type)).toEqual(["2 VPNs on", "Client A", "Client B", "separator", "Open Multi VPN Client", "separator", "Quit and turn off VPNs"]);
    expect(menu.at(-1)?.accelerator).toBe("Command+Q");
  });

  it("says when none are on, and shows no shortcut where the app has none", () => {
    const menu = trayMenu({ ...parts, count: 0, names: [], quitShortcut: undefined });
    expect(menu.map((item) => item.label ?? item.type)).toEqual(["No VPNs on", "separator", "Open Multi VPN Client", "separator", "Quit and turn off VPNs"]);
    expect(menu.at(-1)).not.toHaveProperty("accelerator");
  });

  it("puts the update in its own section between the VPNs and opening the window", () => {
    const menu = trayMenu({ ...parts, count: 1, names: ["Client A"], update: { label: "Restart to update and turn off VPNs" }, quitShortcut: undefined });
    expect(menu.map((item) => item.label ?? item.type)).toEqual(["1 VPN on", "Client A", "separator", "Restart to update and turn off VPNs", "separator", "Open Multi VPN Client", "separator", "Quit and turn off VPNs"]);
  });
});
