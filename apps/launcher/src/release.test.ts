import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { archiveUrl, executableIn, Manifest, needsNoSandbox, versionsDir } from "./release.ts";

const manifest: Manifest = {
  version: "1.2.3",
  archives: { "linux-x64": { file: "multi-vpn-client-1.2.3-linux-x64.tar.gz", sha256: "a".repeat(64) } },
};
const archive = manifest.archives["linux-x64"]!;

describe("the release manifest", () => {
  it("only accepts plain file names and full SHA-256 checksums", () => {
    expect(Manifest.safeParse(manifest).success).toBe(true);
    expect(Manifest.safeParse({ ...manifest, archives: { "linux-x64": { ...archive, file: "../evil" } } }).success).toBe(false);
    expect(Manifest.safeParse({ ...manifest, archives: { "linux-x64": { ...archive, sha256: "abc" } } }).success).toBe(false);
    expect(Manifest.safeParse({ ...manifest, version: "latest" }).success).toBe(false);
  });

  it("downloads from the version's GitHub Release, or from MVPN_RELEASE_URL when set", () => {
    expect(archiveUrl(manifest, archive, {})).toBe(
      "https://github.com/atatter/multi-vpn-client/releases/download/v1.2.3/multi-vpn-client-1.2.3-linux-x64.tar.gz",
    );
    expect(archiveUrl(manifest, archive, { MVPN_RELEASE_URL: "http://127.0.0.1:8000" })).toBe(
      "http://127.0.0.1:8000/multi-vpn-client-1.2.3-linux-x64.tar.gz",
    );
  });
});

describe("where versions are unpacked", () => {
  it("uses each OS's per-user cache", () => {
    expect(versionsDir({ LOCALAPPDATA: join("/", "local") }, "win32", "/home/a")).toBe(join("/", "local", "Multi VPN Client", "versions"));
    expect(versionsDir({}, "darwin", "/Users/a")).toBe(join("/Users/a", "Library", "Caches", "Multi VPN Client", "versions"));
    expect(versionsDir({ XDG_CACHE_HOME: join("/", "cache") }, "linux", "/home/a")).toBe(join("/", "cache", "multi-vpn-client", "versions"));
  });

  it("ignores empty or relative cache variables instead of resolving them against the current folder", () => {
    expect(versionsDir({ XDG_CACHE_HOME: "relative" }, "linux", "/home/a")).toBe(join("/home/a", ".cache", "multi-vpn-client", "versions"));
    expect(versionsDir({ LOCALAPPDATA: "" }, "win32", "/home/a")).toBe(join("/home/a", "AppData", "Local", "Multi VPN Client", "versions"));
  });

  it("finds the executable each OS's archive has", () => {
    expect(executableIn("v", "darwin")).toBe(join("v", "Multi VPN Client.app", "Contents", "MacOS", "Multi VPN Client"));
    expect(executableIn("v", "win32")).toBe(join("v", "Multi VPN Client.exe"));
    expect(executableIn("v", "linux")).toBe(join("v", "multi-vpn-client"));
  });
});

describe("Electron's sandbox", () => {
  it("is only turned off on Linux when AppArmor blocks unprivileged user namespaces", () => {
    expect(needsNoSandbox("linux", "1\n")).toBe(true);
    expect(needsNoSandbox("linux", "0\n")).toBe(false);
    expect(needsNoSandbox("linux", undefined)).toBe(false);
    expect(needsNoSandbox("darwin", "1")).toBe(false);
  });
});
