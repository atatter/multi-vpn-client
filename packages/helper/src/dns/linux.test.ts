import { describe, expect, it } from "vitest";
import { createResolvedDns, type Exec } from "./linux.ts";

/** Records commands; `ip link show` succeeds only once the link was added. */
function fakeSystem({ failResolvectl = 0 } = {}) {
  const calls: string[] = [];
  let linkExists = false;
  let resolvectlFailures = failResolvectl;
  const run: Exec = async (command, args) => {
    const line = [command, ...args].join(" ");
    if (line === "ip link show mvpn-dns" && !linkExists) throw new Error("does not exist");
    calls.push(line);
    if (line === "ip link add mvpn-dns type dummy") linkExists = true;
    if (line === "ip link del mvpn-dns") linkExists = false;
    if (command === "resolvectl" && resolvectlFailures > 0) {
      resolvectlFailures--;
      throw new Error("Link mvpn-dns not known");
    }
  };
  return { run, calls };
}

describe("systemd-resolved DNS", () => {
  it("creates the dummy link once and points only valid, routing-only domains at the listener", async () => {
    const system = fakeSystem();
    const dns = createResolvedDns({ address: "198.18.0.5", port: 53530, run: system.run });
    await dns.set(["corp.example", "corp.example", "--evil", "b.internal"]);
    expect(system.calls).toEqual([
      "ip link add mvpn-dns type dummy",
      "ip address add 198.18.0.5/32 dev mvpn-dns",
      "ip link set mvpn-dns up",
      "resolvectl --no-ask-password dns mvpn-dns 198.18.0.5:53530",
      "resolvectl --no-ask-password domain mvpn-dns ~corp.example ~b.internal",
      "resolvectl --no-ask-password default-route mvpn-dns false",
    ]);

    system.calls.length = 0;
    await dns.set(["c.example"]);
    expect(system.calls).toEqual([
      "ip link show mvpn-dns",
      "resolvectl --no-ask-password dns mvpn-dns 198.18.0.5:53530",
      "resolvectl --no-ask-password domain mvpn-dns ~c.example",
      "resolvectl --no-ask-password default-route mvpn-dns false",
    ]);
  });

  it("removes the link (and with it every setting) when there's nothing to route", async () => {
    const system = fakeSystem();
    const dns = createResolvedDns({ address: "198.18.0.5", port: 53530, run: system.run });
    await dns.set([]);
    await dns.clear();
    expect(system.calls).toEqual(["ip link del mvpn-dns", "ip link del mvpn-dns"]);
  });

  it("waits for resolved to notice a new link", async () => {
    const system = fakeSystem({ failResolvectl: 2 });
    await createResolvedDns({ address: "198.18.0.5", port: 53530, run: system.run }).set(["corp.example"]);
    expect(system.calls.filter((call) => call.includes(" dns "))).toHaveLength(3);
  });
});
