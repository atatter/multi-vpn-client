import { type ConnectionStatus, newVpn } from "@repo/core";
import type { NativeImage } from "electron";
import { describe, expect, it } from "vitest";
import { idsOn, namesOn, countHeadline, trayMenu } from "./menu.ts";

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

describe("the tray menu", () => {
  const parts = { dot: {} as NativeImage, open: () => {}, quit: () => {} };

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
});
