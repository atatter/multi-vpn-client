import { describe, expect, it } from "vitest";
import { hostPlatform } from "./singbox-binary.ts";

describe("hostPlatform", () => {
  it("maps Node's platform names to sing-box release names", () => {
    expect(hostPlatform("darwin", "arm64")).toBe("darwin-arm64");
    expect(hostPlatform("darwin", "x64")).toBe("darwin-amd64");
    expect(hostPlatform("linux", "x64")).toBe("linux-amd64");
    expect(hostPlatform("win32", "arm64")).toBe("win32-arm64");
    expect(() => hostPlatform("freebsd", "x64")).toThrow("isn't supported yet");
  });
});
