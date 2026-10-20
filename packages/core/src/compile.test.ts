import { describe, expect, it } from "vitest";
import { compileRoutes, effectiveRules, routeFor, routingPlan } from "./compile.ts";
import type { RouteRule } from "./config.ts";
import { newVpn, type Vpn } from "@repo/vpns";

const vpn = (id: string): Vpn => newVpn("openvpn", { id, name: id.toUpperCase() });
const rule = (id: string, cidr: string, vpnId: string, enabled = true, pinned = false): RouteRule => ({ id, kind: "cidr", cidr, vpnId, enabled, note: "", pinned });
const domain = (id: string, name: string, vpnId: string, enabled = true, pinned = false): RouteRule => ({ id, kind: "domain", domain: name, vpnId, enabled, note: "", pinned });

const vpns = [vpn("a"), vpn("b")];

describe("compileRoutes", () => {
  it("gives each VPN its own rules when nothing overlaps", () => {
    const result = compileRoutes({
      vpns,
      routes: [rule("r1", "10.20.0.0/16", "a"), rule("r2", "172.31.0.0/16", "b")],
    });
    expect(result.byVpn).toEqual({ a: ["10.20.0.0/16"], b: ["172.31.0.0/16"] });
    expect(result.all).toEqual(["10.20.0.0/16", "172.31.0.0/16"]);
    expect(result.warnings).toEqual([]);
  });

  it("carves a higher-priority specific range out of a lower-priority broad one", () => {
    const result = compileRoutes({
      vpns,
      routes: [rule("r1", "10.20.0.0/16", "a"), rule("r2", "10.0.0.0/8", "b")],
    });
    expect(result.byVpn.a).toEqual(["10.20.0.0/16"]);
    expect(result.byVpn.b).toHaveLength(8);
    expect(result.byVpn.b).not.toContain("10.20.0.0/16");
    expect(result.all).toEqual(["10.0.0.0/8"]);
    expect(result.warnings).toEqual([
      { kind: "shadowed", ruleId: "r2", full: false, lost: ["10.20.0.0/16"], by: [{ kind: "rule", ruleId: "r1" }] },
    ]);
  });

  it("drops a lower-priority rule entirely when a broader rule above covers it", () => {
    // Windows would pick the /16 by longest-prefix match; priority order must win instead.
    const result = compileRoutes({
      vpns,
      routes: [rule("r1", "10.0.0.0/8", "a"), rule("r2", "10.20.0.0/16", "b")],
    });
    expect(result.byVpn).toEqual({ a: ["10.0.0.0/8"], b: [] });
    expect(result.warnings).toEqual([
      { kind: "shadowed", ruleId: "r2", full: true, lost: ["10.20.0.0/16"], by: [{ kind: "rule", ruleId: "r1" }] },
    ]);
  });

  it("aggregates adjacent rules of the same VPN", () => {
    const result = compileRoutes({
      vpns,
      routes: [rule("r1", "10.0.0.0/25", "a"), rule("r2", "10.0.0.128/25", "a")],
    });
    expect(result.byVpn.a).toEqual(["10.0.0.0/24"]);
    expect(result.warnings).toEqual([]);
  });

  it("names every rule that took part of a range", () => {
    const result = compileRoutes({
      vpns,
      routes: [rule("r1", "10.1.0.0/16", "a"), rule("r2", "10.2.0.0/16", "a"), rule("r3", "10.0.0.0/8", "b")],
    });
    expect(result.warnings).toEqual([
      {
        kind: "shadowed",
        ruleId: "r3",
        full: false,
        lost: ["10.1.0.0/16", "10.2.0.0/16"],
        by: [
          { kind: "rule", ruleId: "r1" },
          { kind: "rule", ruleId: "r2" },
        ],
      },
    ]);
  });

  it("reserved ranges outrank every rule", () => {
    const result = compileRoutes({
      vpns,
      routes: [rule("r1", "192.168.0.0/16", "a")],
      reserved: [{ cidr: "192.168.1.0/24", label: "Local network" }],
    });
    expect(result.byVpn.a).not.toContain("192.168.1.0/24");
    expect(result.warnings).toEqual([
      {
        kind: "shadowed",
        ruleId: "r1",
        full: false,
        lost: ["192.168.1.0/24"],
        by: [{ kind: "reserved", label: "Local network" }],
      },
    ]);
  });

  it("lets a narrower rule win a local network's addresses, as the OS would, and the network keep a broader rule's", () => {
    // A network handing out a /8 (a hostile Wi-Fi, say) mustn't take a VPN's /16; all traffic still leaves it local.
    const lan = { cidr: "10.0.0.0/8", label: "Local network (Wi-Fi)", local: true };
    const result = compileRoutes({ vpns, routes: [rule("r1", "10.20.0.0/16", "a"), rule("r2", "0.0.0.0/0", "b")], reserved: [lan] });
    expect(result.byVpn.a).toEqual(["10.20.0.0/16"]);
    expect(result.byVpn.b?.some((cidr) => cidr.startsWith("10."))).toBe(false);
    expect(result.warnings.find((warning) => warning.ruleId === "r1")).toBeUndefined();

    // Equal size: the network keeps it, so a VPN routing exactly the LAN doesn't cut it off.
    expect(compileRoutes({ vpns, routes: [rule("r1", "10.0.0.0/8", "a")], reserved: [lan] }).byVpn.a).toEqual([]);
    // Other reserved ranges, like a VPN's server, outrank even narrower rules.
    expect(compileRoutes({ vpns, routes: [rule("r1", "203.0.113.10/32", "a")], reserved: [{ cidr: "203.0.113.0/24", label: "A gateway" }] }).byVpn.a).toEqual([]);
  });

  it("ignores disabled rules, so they shadow nothing", () => {
    const result = compileRoutes({
      vpns,
      routes: [rule("r1", "10.0.0.0/8", "a", false), rule("r2", "10.20.0.0/16", "b")],
    });
    expect(result.byVpn).toEqual({ a: [], b: ["10.20.0.0/16"] });
    expect(result.warnings).toEqual([]);
  });

  it("still reports invalid disabled rules, since saving would reject them", () => {
    const result = compileRoutes({ vpns, routes: [rule("r1", "10.20.1.5/16", "a", false)] });
    expect(result.warnings).toEqual([
      { kind: "invalid-cidr", ruleId: "r1", message: "Host bits are set. Did you mean 10.20.0.0/16?" },
    ]);
  });

  it("reports invalid CIDRs and unknown VPNs instead of throwing", () => {
    const result = compileRoutes({
      vpns,
      routes: [rule("r1", "10.20.1.5/16", "a"), rule("r2", "10.30.0.0/16", "ghost")],
    });
    expect(result.byVpn).toEqual({ a: [], b: [] });
    expect(result.warnings).toEqual([
      { kind: "invalid-cidr", ruleId: "r1", message: "Host bits are set. Did you mean 10.20.0.0/16?" },
      { kind: "unknown-vpn", ruleId: "r2", vpnId: "ghost" },
    ]);
  });
});

describe("compileRoutes: domain routes", () => {
  it("lists enabled domain routes in priority order, separate from IP routes", () => {
    const result = compileRoutes({
      vpns: [vpn("b"), vpn("a")], // B above A, so B's subdomain wins over A's domain
      routes: [domain("d1", "argo.lab.example", "b"), rule("r1", "10.20.0.0/16", "a"), domain("d2", "lab.example", "a"), domain("d3", "off.example", "a", false)],
    });
    expect(result.domains).toEqual([
      { ruleId: "d1", vpnId: "b", domain: "argo.lab.example" },
      { ruleId: "d2", vpnId: "a", domain: "lab.example" },
    ]);
    expect(result.byVpn).toEqual({ a: ["10.20.0.0/16"], b: [] });
    expect(result.warnings).toEqual([]);
  });

  it("warns when a higher route already covers a domain (subdomains included)", () => {
    const result = compileRoutes({ vpns, routes: [domain("d1", "lab.example", "a"), domain("d2", "argo.lab.example", "b"), domain("d3", "Lab.example", "b")] });
    expect(result.domains).toEqual([{ ruleId: "d1", vpnId: "a", domain: "lab.example" }]);
    expect(result.warnings).toEqual([
      { kind: "domain-shadowed", ruleId: "d2", by: "d1" },
      { kind: "domain-shadowed", ruleId: "d3", by: "d1" },
    ]);
  });

  it("doesn't treat a name that merely ends with the same letters as covered", () => {
    const result = compileRoutes({ vpns, routes: [domain("d1", "lab.example", "a"), domain("d2", "notlab.example", "b")] });
    expect(result.warnings).toEqual([]);
  });

  it("reports invalid domains and unknown VPNs", () => {
    const result = compileRoutes({ vpns, routes: [domain("d1", "not a domain", "a"), domain("d2", "ok.example", "ghost")] });
    expect(result.domains).toEqual([]);
    expect(result.warnings).toEqual([
      { kind: "invalid-domain", ruleId: "d1", message: "Expected a domain, e.g. corp.example" },
      { kind: "unknown-vpn", ruleId: "d2", vpnId: "ghost" },
    ]);
  });

  it("takes priority from the VPN order, not from where a rule is stored", () => {
    const result = compileRoutes({
      vpns,
      routes: [rule("r1", "10.20.0.0/16", "b"), rule("r2", "10.0.0.0/8", "a")],
    });
    expect(result.byVpn).toEqual({ a: ["10.0.0.0/8"], b: [] });
    expect(result.warnings).toEqual([
      { kind: "shadowed", ruleId: "r1", full: true, lost: ["10.20.0.0/16"], by: [{ kind: "rule", ruleId: "r2" }] },
    ]);
  });
});

describe("effectiveRules", () => {
  const own = [rule("a1", "10.20.0.0/16", "a"), rule("a2", "10.30.0.0/16", "a", true, true), rule("b1", "10.140.0.0/16", "b")];
  const base = vpn("a");

  it("routes only the VPN's own rules when it chooses its sites", () => {
    expect(effectiveRules({ ...base, traffic: "sites" }, own).map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  it("adds what the server sent to the VPN's own rules on the official app's routes", () => {
    const rules = effectiveRules({ ...base, traffic: "official", serverRoutes: { all: false, cidrs: ["10.0.0.0/8"] } }, own);
    expect(rules.map((r) => [r.id, r.kind === "cidr" ? r.cidr : r.domain])).toEqual([
      ["server:a:10.0.0.0/8", "10.0.0.0/8"],
      ["a1", "10.20.0.0/16"],
      ["a2", "10.30.0.0/16"],
    ]);
  });

  it("only knows the VPN's own rules before the first connect", () => {
    expect(effectiveRules({ ...base, traffic: "official", serverRoutes: null }, own).map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  it("routes everything, keeping only pinned rules, when the VPN carries all traffic", () => {
    expect(effectiveRules({ ...base, traffic: "all" }, own).map((r) => r.id)).toEqual(["all:a", "a2"]);
    expect(effectiveRules({ ...base, traffic: "official", serverRoutes: { all: true, cidrs: [] } }, own).map((r) => r.id)).toEqual(["all:a", "a2"]);
  });
});

describe("compileRoutes: pins and all-traffic VPNs", () => {
  it("gives a pinned rule its addresses whatever the order", () => {
    const { byVpn } = compileRoutes({ vpns, routes: [rule("a1", "10.143.1.20/32", "a"), rule("b1", "10.143.1.20/32", "b", true, true)] });
    expect(byVpn).toEqual({ a: [], b: ["10.143.1.20/32"] });
  });

  it("lets a higher VPN carrying everything take lower VPNs' addresses and names", () => {
    const routes = [...effectiveRules({ ...vpn("a"), traffic: "all" }, []), rule("b1", "10.140.0.0/16", "b"), domain("b2", "corp.example", "b")];
    const result = compileRoutes({ vpns, routes, reserved: [{ cidr: "192.168.1.0/24", label: "LAN" }] });
    expect(result.byVpn.b).toEqual([]);
    expect(result.domains).toEqual([]);
    expect(result.byVpn.a).not.toContain("192.168.1.0/24");
    expect(result.warnings).toContainEqual({ kind: "domain-shadowed", ruleId: "b2", by: "all:a" });
  });

  it("leaves higher VPNs and pinned names alone when a lower VPN carries everything", () => {
    const routes = [rule("a1", "10.140.0.0/16", "a"), domain("a2", "corp.example", "a"), ...effectiveRules({ ...vpn("b"), traffic: "all" }, [domain("b2", "pinned.example", "b", true, true)])];
    const result = compileRoutes({ vpns, routes });
    expect(result.byVpn.a).toEqual(["10.140.0.0/16"]);
    expect(result.domains.map((d) => d.domain)).toEqual(["pinned.example", "corp.example"]);
  });
});

describe("routingPlan", () => {
  const on = (...ids: string[]) => new Set(ids);
  const config = (routes: RouteRule[], list: Vpn[] = vpns) => ({ vpns: list, routes, priority: list.map((v) => v.id) });

  it("names the higher VPN that takes all or part of a lower VPN's rule", () => {
    const routes = [
      rule("a-net", "10.0.0.0/16", "a"),
      domain("a-corp", "corp.acme.example", "a"),
      rule("b-part", "10.0.0.0/8", "b"),
      rule("b-full", "10.0.4.0/24", "b"),
      domain("b-acme", "acme.example", "b"),
      domain("b-corp", "intranet.corp.acme.example", "b"),
    ];
    const [, b] = routingPlan(config(routes), on("a", "b"), on("a", "b"));
    expect(b?.fates.map((f) => [f.rule.id, f.taken?.by, !!f.taken?.partly])).toEqual([
      ["b-part", "a", true],
      ["b-full", "a", false],
      ["b-acme", "a", true],
      ["b-corp", "a", false],
    ]);
  });

  it("only counts connected VPNs, and lists turned-on ones that aren't connected yet without fates", () => {
    const plan = routingPlan(config([rule("a1", "10.0.0.0/8", "a"), rule("b1", "10.1.0.0/16", "b")]), on("a", "b"), on("b"));
    expect(plan.map((l) => [l.vpnId, l.live, l.fates.length])).toEqual([
      ["a", false, 0],
      ["b", true, 1],
    ]);
    expect(plan[1]?.fates[0]?.taken).toBeUndefined();
  });

  it("ignores paused rules and overlaps within one VPN", () => {
    const routes = [rule("a1", "10.0.0.0/8", "a"), rule("a2", "10.1.0.0/16", "a"), rule("a3", "10.0.0.0/8", "a", false), rule("b1", "10.2.0.0/16", "b")];
    const [a, b] = routingPlan(config(routes), on("a", "b"), on("a", "b"));
    expect(a?.fates.map((f) => f.rule.id)).toEqual(["a1", "a2"]);
    expect(a?.fates.every((f) => !f.taken)).toBe(true);
    expect(b?.fates[0]?.taken).toMatchObject({ by: "a", partly: false });
  });

  it("says when a higher all-traffic VPN leaves a VPN nothing, and marks pins", () => {
    const list = [{ ...vpn("a"), traffic: "all" as const }, vpn("b"), vpn("c")];
    const routes = [rule("b1", "10.140.0.0/16", "b"), rule("c1", "10.50.0.0/16", "c"), rule("c2", "10.60.0.0/16", "c", true, true)];
    const [a, b, c] = routingPlan(config(routes, list), on("a", "b", "c"), on("a", "b", "c"));
    expect(a).toMatchObject({ broad: true });
    expect(b).toMatchObject({ starvedBy: "a" });
    expect(c?.starvedBy).toBeUndefined(); // its pinned rule still gets through
    expect(c?.fates.find((f) => f.rule.id === "c2")?.taken).toBeUndefined();
  });

  it("puts a second all-traffic VPN on standby under the first, even below a VPN for its own network", () => {
    const list = [vpn("b"), { ...vpn("a"), traffic: "all" as const }, { ...vpn("c"), traffic: "all" as const }];
    const [, , c] = routingPlan(config([rule("b1", "10.140.0.0/16", "b")], list), on("b", "a", "c"), on("b", "a", "c"));
    expect(c).toMatchObject({ broad: true, starvedBy: "a" });
  });

  it("puts a second all-traffic VPN on standby under the first", () => {
    const list = [{ ...vpn("a"), traffic: "all" as const }, { ...vpn("b"), traffic: "all" as const }];
    const [, b] = routingPlan(config([], list), on("a", "b"), on("a", "b"));
    expect(b).toMatchObject({ broad: true, starvedBy: "a" });
  });
});

describe("routeFor", () => {
  const compiled = { byVpn: { a: ["10.0.0.0/8"], b: ["0.0.0.0/1"] }, domains: [{ ruleId: "d", vpnId: "c", domain: "corp.example" }] };

  it("matches names first, subdomains included", () => {
    expect(routeFor(compiled, { domain: "wiki.corp.example", addresses: ["10.1.2.3"] })).toBe("c");
  });

  it("matches addresses otherwise, and says when nothing covers the host", () => {
    expect(routeFor(compiled, { domain: "github.com", addresses: ["10.1.2.3"] })).toBe("a");
    expect(routeFor(compiled, { addresses: ["192.168.1.5"] })).toBeUndefined();
    expect(routeFor(compiled, { addresses: ["127.0.0.1"] })).toBe("b");
  });
});

describe("routingPlan: subdomains taken by pins", () => {
  it("doesn't say a pinned domain loses part to a subdomain the pin already took", () => {
    const list = [vpn("a"), vpn("b")];
    const routes = [domain("a1", "a.corp.example", "a"), domain("b1", "corp.example", "b", true, true)];
    const [a, b] = routingPlan({ vpns: list, routes, priority: ["a", "b"] }, new Set(["a", "b"]), new Set(["a", "b"]));
    expect(a?.fates[0]?.taken).toMatchObject({ by: "b" });
    expect(b?.fates[0]?.taken).toBeUndefined();
  });
});

describe("routingPlan: VPNs with nothing of their own", () => {
  it("shows one with no routes under an all-traffic VPN as unused, but not one above it", () => {
    const list = [vpn("b"), { ...vpn("a"), traffic: "all" as const }, vpn("c")];
    const all = new Set(["a", "b", "c"]);
    const [b, , c] = routingPlan({ vpns: list, routes: [], priority: ["b", "a", "c"] }, all, all);
    expect(b?.starvedBy).toBeUndefined();
    expect(c?.starvedBy).toBe("a");
  });
});
