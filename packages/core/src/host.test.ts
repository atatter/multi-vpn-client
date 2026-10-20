import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { newVpn, type Vpn } from "@repo/vpns";
import { gatewayAddresses, localNetworks } from "./host.ts";

const iface = (address: string, cidr: string, internal = false, family: "IPv4" | "IPv6" = "IPv4") =>
  ({ address, cidr, internal, family, netmask: "", mac: "", scopeid: 0 }) as NetworkInterfaceInfo;

describe("localNetworks", () => {
  it("returns the subnets of external IPv4 interfaces only", () => {
    expect(
      localNetworks({
        lo: [iface("127.0.0.1", "127.0.0.1/8", true)],
        "Wi-Fi": [iface("192.168.1.23", "192.168.1.23/24"), iface("fe80::1", "fe80::1/64", false, "IPv6")],
      }),
    ).toEqual([{ cidr: "192.168.1.0/24", label: "Local network (Wi-Fi)", local: true }]);
  });
});

describe("gatewayAddresses", () => {
  const vpns: Vpn[] = [
    { ...newVpn("globalprotect", { id: "a", name: "Client A" }), portal: "vpn.a.example" },
    { ...newVpn("fortinet-ssl", { id: "b", name: "Client B" }), gateway: "nowhere.invalid:10443" },
  ];

  it("reserves every resolved gateway address and reports the rest", async () => {
    const resolve = async (host: string) => {
      if (host === "vpn.a.example") return ["203.0.113.10", "203.0.113.11"];
      throw new Error("ENOTFOUND");
    };
    expect(await gatewayAddresses(vpns, resolve)).toEqual({
      reserved: [
        { cidr: "203.0.113.10/32", label: "Client A gateway" },
        { cidr: "203.0.113.11/32", label: "Client A gateway" },
      ],
      unresolved: [{ vpnId: "b", host: "nowhere.invalid" }],
    });
  });

  it("keeps at most a few addresses per host, whatever the local DNS answers", async () => {
    const resolve = async () => Array.from({ length: 40 }, (_, i) => `10.20.0.${i}`);
    const { reserved } = await gatewayAddresses([vpns[0]!], resolve);
    expect(reserved.map((range) => range.cidr)).toEqual(["10.20.0.0/32", "10.20.0.1/32", "10.20.0.2/32", "10.20.0.3/32"]);
  });
});
