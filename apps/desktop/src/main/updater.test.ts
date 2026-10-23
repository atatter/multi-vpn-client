import type { Manifest } from "@repo/release";
import { describe, expect, it } from "vitest";
import type { UpdateState } from "../shared/ipc-contract.ts";
import { createUpdater } from "./updater.ts";

const release = (version: string): Manifest => ({
  version,
  archives: { "linux-x64": { file: `multi-vpn-client-${version}-linux-x64.tar.gz`, sha256: "a".repeat(64), size: 180_000_000 } },
});

/** An updater for 0.1.0 over a fake npm and download: `npm` is what npm answers next. */
function setup({ packaged = true, npm = (): Promise<Manifest> => Promise.resolve(release("0.2.0")) } = {}) {
  const states: UpdateState[] = [];
  const downloads: { finish: () => void; fail: (error: Error) => void; progress: (done: number) => void }[] = [];
  const updater = createUpdater({
    version: "0.1.0",
    packaged,
    target: "linux-x64",
    latest: () => npm(),
    download: (manifest, progress) =>
      new Promise((resolve, reject) => downloads.push({ finish: () => resolve(undefined), fail: reject, progress })),
    onChange: (state) => states.push(state),
    now: () => 1000,
  });
  return { updater, states, downloads };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe("checking for a newer version", () => {
  it("never happens in a development build", async () => {
    const { updater, states } = setup({ packaged: false });
    updater.start();
    await updater.check();
    expect(updater.state()).toEqual({ state: "off" });
    expect(states).toEqual([]);
  });

  it("offers a newer version on npm, with its size, and downloads nothing yet", async () => {
    const { updater, states, downloads } = setup();
    await updater.check();
    expect(states).toEqual([{ state: "checking" }, { state: "available", version: "0.2.0", size: 180_000_000 }]);
    expect(downloads).toEqual([]);
  });

  it("is up to date when npm's newest is this version or older", async () => {
    for (const version of ["0.1.0", "0.0.9"]) {
      const { updater } = setup({ npm: () => Promise.resolve(release(version)) });
      await updater.check();
      expect(updater.state()).toEqual({ state: "current", checkedAt: 1000 });
    }
  });

  it("says why it failed, and can be tried again", async () => {
    let answer = (): Promise<Manifest> => Promise.reject(new Error("Couldn't reach npm. Check the internet connection."));
    const { updater } = setup({ npm: () => answer() });
    await updater.check();
    expect(updater.state()).toEqual({ state: "check-failed", error: "Couldn't reach npm. Check the internet connection." });
    answer = () => Promise.resolve(release("0.2.0"));
    await updater.check();
    expect(updater.state()).toMatchObject({ state: "available" });
  });

  it("doesn't forget a known update when asked again", async () => {
    let asked = 0;
    const { updater } = setup({ npm: () => (asked++, Promise.resolve(release("0.2.0"))) });
    await updater.check();
    await updater.check();
    expect(asked).toBe(1);
    expect(updater.state()).toMatchObject({ state: "available" });
  });
});

describe("downloading it", () => {
  it("only starts once a check found a newer version", async () => {
    const { updater, downloads } = setup();
    await updater.download();
    expect(downloads).toEqual([]);
  });

  it("reports whole percents, holds 100 back until it's unpacked, then is ready to restart into", async () => {
    const { updater, states, downloads } = setup();
    await updater.check();
    const done = updater.download();
    const [download] = downloads;
    for (const share of [0.004, 0.42, 0.421, 0.9, 1]) download?.progress(share);
    download?.finish();
    await done;
    expect(states.slice(2)).toEqual([
      { state: "downloading", version: "0.2.0", percent: 0 },
      { state: "downloading", version: "0.2.0", percent: 42 },
      { state: "downloading", version: "0.2.0", percent: 90 },
      { state: "downloading", version: "0.2.0", percent: 99 },
      { state: "ready", version: "0.2.0" },
    ]);
  });

  it("ignores more clicks and checks while it runs", async () => {
    const { updater, downloads } = setup();
    await updater.check();
    void updater.download();
    await updater.download();
    await updater.check();
    expect(downloads).toHaveLength(1);
    expect(updater.state()).toMatchObject({ state: "downloading" });
  });

  it("fails with the reason and the version, and downloads again when tried again", async () => {
    const { updater, downloads } = setup();
    await updater.check();
    void updater.download();
    downloads[0]?.fail(new Error("The download doesn't match its checksum."));
    await settle();
    expect(updater.state()).toEqual({ state: "download-failed", version: "0.2.0", error: "The download doesn't match its checksum." });
    void updater.download();
    expect(downloads).toHaveLength(2);
  });
});

describe("restarting into it", () => {
  it("happens once, and only once it's downloaded", async () => {
    const { updater, downloads } = setup();
    await updater.check();
    expect(updater.markRestarting()).toBeUndefined();
    const done = updater.download();
    downloads[0]?.finish();
    await done;
    expect(updater.markRestarting()).toBe("0.2.0");
    expect(updater.state()).toEqual({ state: "restarting", version: "0.2.0" });
    expect(updater.markRestarting()).toBeUndefined();
  });
});
