import { describe, expect, it } from "vitest";
import { kindSpec, newVpn, VPN_KINDS, vpnAddress } from "./index.ts";

describe("withAddress", () => {
  // The add flow creates a VPN from a typed address; the window then shows it back through `address`.
  it.each(VPN_KINDS)("%s reads back the address it was given", (kind) => {
    const vpn = kindSpec(kind).withAddress(newVpn(kind, { id: "a", name: "A" }), "vpn.example.com");
    expect(vpnAddress(vpn)).toBe("vpn.example.com");
  });
});
