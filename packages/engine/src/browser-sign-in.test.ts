import { describe, expect, it } from "vitest";
import { receiveBrowserToken } from "./browser-sign-in.ts";

// A port per test, away from the real one (7779), so a running VPN client doesn't interfere.
const PORT = 47_790;

describe("receiveBrowserToken", () => {
  it("takes the token from the first request's path and lets the gateway's page call it", async () => {
    const wait = receiveBrowserToken(PORT, 5_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const response = await fetch(`http://127.0.0.1:${PORT}/ab12-CD34_x=`, { method: "GET" });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-private-network")).toBe("true");
    await expect(wait.token).resolves.toBe("ab12-CD34_x=");
  });

  it("ignores requests without a usable token, and can be cancelled", async () => {
    const wait = receiveBrowserToken(PORT + 1, 5_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await fetch(`http://127.0.0.1:${PORT + 1}/`)).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${PORT + 1}/a*b`)).status).toBe(400);
    wait.cancel(new Error("cancelled"));
    await expect(wait.token).rejects.toThrow("cancelled");
  });

  it("gives up after the timeout", async () => {
    await expect(receiveBrowserToken(PORT + 2, 50).token).rejects.toThrow("didn't finish");
  });

  it("explains a port that's taken", async () => {
    const first = receiveBrowserToken(PORT + 3, 5_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(receiveBrowserToken(PORT + 3, 5_000).token).rejects.toThrow("in use");
    first.cancel(new Error("done"));
    await first.token.catch(() => undefined);
  });
});
