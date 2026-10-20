import { describe, expect, it } from "vitest";
import { newVpn } from "../../index.ts";
import { fortinetLaunch } from "./engine.ts";

describe("fortinetLaunch", () => {
  const vpn = { ...newVpn("fortinet-ssl", { id: "f", name: "Forti" }), gateway: "vpn.example.com:10443", username: "jane doe", realm: "staff" };

  it("passes every setting as its own argument and the password only in a file", () => {
    const launch = fortinetLaunch({ ...vpn, advanced: "--no-dtls" }, "s3cret");
    expect(launch.command).toEqual([
      "openconnect",
      "--protocol=fortinet",
      "--user=jane doe",
      "--usergroup=staff",
      "--no-dtls",
      "https://vpn.example.com:10443",
    ]);
    expect(launch.command.join(" ")).not.toContain("s3cret");
    // Password, then an empty one-time code (asks for a FortiToken push if the gateway wants 2FA).
    expect(launch.files).toEqual({ auth: "s3cret\n\n" });
  });

  it("reports an untrusted or changed certificate with its pin, and bad logins clearly", () => {
    const { readLine } = fortinetLaunch(vpn, "p");
    const pin = "pin-sha256:4Ig9FacgQcqDH6/1s3p66HFEium5k5Jn2Rx1rWoderY=";
    expect(readLine(`    --servercert ${pin}`)).toEqual({ failed: "vpn.example.com:10443's certificate isn't publicly trusted.", untrustedPin: pin, server: "vpn.example.com:10443" });
    expect(readLine("SSL negotiation with gw2.example.com")).toBeUndefined();
    expect(readLine(`None of the 1 fingerprint(s) specified via --servercert match server's certificate: ${pin}`)).toEqual({
      failed: "gw2.example.com presented a different certificate than the one you trusted.",
      untrustedPin: pin,
      server: "gw2.example.com",
    });
    expect(readLine("    --servercert pin-sha256:not-a-pin")).toBeUndefined();
    expect(readLine("Invalid credentials; try again.")).toEqual({ failed: "The VPN server rejected the username or password." });
    expect(readLine("Connected to 203.0.113.7:10443")).toBeUndefined();
  });
});
