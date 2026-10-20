import { ZodError } from "zod";
import { describe, expect, it } from "vitest";
import { newVpn } from "../../index.ts";
import { CHECKPOINT_IMAGE } from "./container.ts";
import { checkpointActions, checkpointLaunch, parseLoginTypes, snxConfig } from "./engine.ts";

describe("checkpointLaunch", () => {
  const vpn = { ...newVpn("checkpoint", { id: "c", name: "CP" }), server: "vpn.example.com", loginType: "vpn_OTP", username: "Eesnimi.Perenimi" };

  it("puts every setting, and the base64 password, in snx-rs's config file, never in its arguments", () => {
    const launch = checkpointLaunch(vpn, "pä ss=");
    expect(launch.image).toBe(CHECKPOINT_IMAGE);
    expect(launch.command).toEqual(["snx"]);
    expect(launch.files).toEqual({
      "snx.conf": [
        "log-level=info",
        "server-name=vpn.example.com",
        "login-type=vpn_OTP",
        "user-name=Eesnimi.Perenimi",
        `password=${Buffer.from("pä ss=").toString("base64")}`,
        "tunnel-type=ipsec",
        "no-dns=true",
        "default-route=true",
        "",
      ].join("\n"),
    });
    expect(launch.createFlags).toContain("net.ipv4.conf.default.rp_filter=2");
  });

  it("adds the Advanced box before its own settings, so the app's win", () => {
    const config = snxConfig({ ...vpn, tunnel: "ssl", advanced: "transport-type=tcpt\n# a comment\nserver-name=evil.example\n log-level=debug " }, "p");
    expect(config.split("\n").slice(0, 4)).toEqual(["log-level=info", "transport-type=tcpt", "log-level=debug", "server-name=vpn.example.com"]);
    expect(config).not.toContain("evil.example");
    expect(config).toContain("tunnel-type=ssl");
  });

  it("refuses values that would start another setting", () => {
    expect(() => snxConfig({ ...vpn, username: "jane\npassword=x" }, "p")).toThrow("line breaks");
  });

  it("leaves the password out when there's none, so snx-rs asks for it", () => {
    expect(snxConfig(vpn, undefined)).not.toContain("password=");
  });

  it("explains failed logins", () => {
    const { readLine } = checkpointLaunch(vpn, "p");
    expect(readLine("Error: Authentication failed")).toEqual({ failed: "The VPN server rejected the sign-in (username, password, code or approval)." });
    expect(readLine("Error: Unsupported login type")).toMatchObject({ failed: expect.stringContaining("doesn't offer the login type vpn_OTP") });
    expect(readLine("Error: Received a netlink error message Operation not supported (os error 95)")).toEqual({
      failed: "Received a netlink error message Operation not supported (os error 95)",
    });
    expect(readLine("         DNS servers: [10.0.0.1]")).toBeUndefined();
  });

  it("hands browser sign-in (Microsoft Entra ID) to the app, https only", () => {
    const { readLine } = checkpointLaunch({ ...vpn, loginType: "vpn_EntraID", username: "" }, undefined);
    expect(readLine("For identity provider authentication, open the following URL in your browser:")).toBeUndefined();
    expect(readLine("https://vpn.example.com/saml-vpn/spPortal/ACS/Login/EntraID?token=abc")).toEqual({
      signInUrl: "https://vpn.example.com/saml-vpn/spPortal/ACS/Login/EntraID?token=abc",
      tokenPort: 7779,
    });
    // Only the line right after the announcement is the address.
    expect(readLine("https://elsewhere.example/")).toBeUndefined();

    const other = checkpointLaunch(vpn, undefined).readLine;
    other("For identity provider authentication, open the following URL in your browser:");
    expect(other("file:///etc/passwd")).toMatchObject({ failed: expect.stringContaining("isn't https") });
  });
});

describe("parseLoginTypes", () => {
  it("reads the login types from snx-rs -m info", () => {
    const output = [
      "         Server address: vpn.example.com",
      "    Supported protocols: IPSec, SSL, L2TP, IKEv1_Only",
      "Internal CA fingerprint: DOVE GRAY CUR MOD OMEN SAYS BRIG NAT LOS SEAT CHAR GLOM",
      "                  [MFA]: vpn_OTP (password)",
      "        [kasutaja_sert]: vpn_kasutaja_sert (certificate, username_only)",
      "[Username and Password with MFA]: vpn_Username_Password_MFA (password, sms)",
    ].join("\n");
    expect(parseLoginTypes(output)).toEqual([
      { id: "vpn_OTP", label: "MFA", factors: ["password"] },
      { id: "vpn_kasutaja_sert", label: "kasutaja_sert", factors: ["certificate", "username_only"] },
      { id: "vpn_Username_Password_MFA", label: "Username and Password with MFA", factors: ["password", "sms"] },
    ]);
  });
});

describe("checkpointActions.loginTypes", () => {
  const ran: { entrypoint: string; args: readonly string[] }[] = [];
  const answering = (result: { code: number; stdout: string; stderr: string }) => ({
    runInImage: async (_image: unknown, run: { entrypoint: string; args: readonly string[] }) => {
      ran.push(run);
      return result;
    },
  });

  it("asks snx-rs in the Check Point image for the gateway's login types, by server alone", async () => {
    const types = await checkpointActions.loginTypes?.("vpn.b:4433", answering({ code: 0, stdout: "  [MFA]: vpn_OTP (password, sms)\n", stderr: "" }));
    expect(types).toEqual([{ id: "vpn_OTP", label: "MFA", factors: ["password", "sms"] }]);
    expect(ran.at(-1)).toEqual({ entrypoint: "snx-rs", args: ["--mode=info", "--server-name=vpn.b:4433"], env: { LANG: "en_US.UTF-8" } });
  });

  it("refuses a server that isn't a host, before running anything", async () => {
    const before = ran.length;
    await expect(checkpointActions.loginTypes?.("vpn.b --mode=connect", answering({ code: 0, stdout: "", stderr: "" }))).rejects.toThrow(ZodError);
    expect(ran.length).toBe(before);
  });

  it("says why the gateway gave no login types", async () => {
    await expect(checkpointActions.loginTypes?.("vpn.b", answering({ code: 1, stdout: "", stderr: "Error: connection refused\n" }))).rejects.toThrow("vpn.b didn't answer: connection refused");
  });
});
