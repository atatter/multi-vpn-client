import { describe, expect, it } from "vitest";
import { run, shQuote } from "./process.ts";

describe("shQuote", () => {
  // Runs the quoted value through /bin/sh, which Windows doesn't have. CI runs it on Linux and macOS.
  it.skipIf(process.platform === "win32")("survives spaces and quotes", async () => {
    const value = `/Users/a/Library/Application Support/it's "here"`;
    expect((await run("/bin/sh", ["-c", `printf %s ${shQuote(value)}`])).stdout).toBe(value);
  });
});

describe("run", () => {
  it.skipIf(process.platform === "win32")("kills a command that outlives its timeout and reports it as failed", async () => {
    expect((await run("/bin/sh", ["-c", "sleep 5"], undefined, 50)).code).not.toBe(0);
  });
});
