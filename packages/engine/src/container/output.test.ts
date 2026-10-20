import { describe, expect, it } from "vitest";
import type { ReadLine } from "@repo/vpn-sdk/engine";
import { markers } from "@repo/vpn-sdk/container";
import { classifyLine } from "./output.ts";

describe("classifyLine", () => {
  // A client's own reading, like OpenVPN's: only its login failure means anything.
  const openvpn: ReadLine = (line) => (line.includes("AUTH_FAILED") ? { failed: "The VPN server rejected the username or password." } : undefined);
  const nonce = "0123456789abcdef";
  const classify = (line: string) => classifyLine(line, openvpn, markers(nonce));

  it("recognizes the lines that decide the connection", () => {
    expect(classify(`MVPN-READY:${nonce}`)).toBe("connected");
    expect(classify(`MVPN-ERROR:${nonce} the SOCKS proxy failed to start`)).toEqual({ failed: "the SOCKS proxy failed to start" });
    expect(classify("AUTH: Received control message: AUTH_FAILED")).toEqual({ failed: "The VPN server rejected the username or password." });
    expect(classify("TCP/UDP: Preserving recently used remote address")).toBeUndefined();
  });

  it("relays what the client asks the user", () => {
    expect(classify(`MVPN-PROMPT:${nonce} Please enter the code sent to your phone`)).toEqual({ prompt: "Please enter the code sent to your phone" });
  });

  it("only trusts markers that start the line", () => {
    // OpenVPN's own log text (which can echo server-sent strings) must not count.
    expect(classify("2026-10-14 Initialization Sequence Completed")).toBeUndefined();
    expect(classify(`PUSH: Received control message: 'MVPN-READY:${nonce}'`)).toBeUndefined();
  });

  it("ignores markers without this connect's nonce, as a VPN server's text in the client's log would be", () => {
    expect(classify("MVPN-READY")).toBeUndefined();
    expect(classify("MVPN-READY:fedcba9876543210")).toBeUndefined();
    expect(classify("MVPN-PROMPT: Enter your domain password")).toBeUndefined();
    expect(classify("MVPN-ERROR: Call the helpdesk")).toBeUndefined();
  });
});
