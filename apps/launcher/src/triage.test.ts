import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contextText, findOnPath, pickAgent, SEED_PROMPT } from "./triage.ts";

describe("finding an agent", () => {
  const bin = mkdtempSync(join(tmpdir(), "mvpn-path-"));
  const other = mkdtempSync(join(tmpdir(), "mvpn-path-"));
  writeFileSync(join(bin, "claude"), "");
  writeFileSync(join(bin, "codex.cmd"), "");
  mkdirSync(join(other, "codex"));

  // A POSIX PATH is ":"-separated, and every Windows path has one after its drive letter.
  it.skipIf(process.platform === "win32")("finds a command on PATH, skipping folders with the same name", () => {
    expect(findOnPath("claude", { PATH: `${other}:${bin}` }, "linux")).toBe(join(bin, "claude"));
    expect(findOnPath("codex", { PATH: `${other}:${bin}` }, "linux")).toBeUndefined();
  });

  it("finds Windows' .cmd shims through PATHEXT", () => {
    expect(findOnPath("codex", { PATH: `${other};${bin}`, PATHEXT: ".EXE;.CMD" }, "win32")).toBe(join(bin, "codex.cmd"));
  });
});

describe("picking an agent", () => {
  it("starts the one asked for, if it's installed", () => {
    expect(pickAgent(["claude", "codex"], "codex")).toEqual({ agent: "codex" });
    expect(pickAgent(["claude"], "codex")).toEqual({ error: "Codex (codex) isn't installed or isn't on PATH." });
    expect(pickAgent(["claude"], "gemini")).toEqual({ error: "--agent must be claude or codex." });
  });

  it("starts the only one installed, asks when there are two, and has none otherwise", () => {
    expect(pickAgent(["codex"], undefined)).toEqual({ agent: "codex" });
    expect(pickAgent(["claude", "codex"], undefined)).toEqual({ ask: ["claude", "codex"] });
    expect(pickAgent([], undefined)).toEqual({ none: true });
  });
});

describe("what the agent is told", () => {
  it("keeps the seed prompt free of characters cmd.exe would interpret", () => {
    expect(SEED_PROMPT).not.toMatch(/["%^&|<>!`]/);
  });

  it("separates the launcher's version from the version the problem happened on", () => {
    const text = contextText({
      launcherVersion: "1.2.3",
      platform: "darwin",
      arch: "arm64",
      osRelease: "25.0.0",
      osVersion: "Darwin Kernel Version 25.0.0",
      node: "v24.9.0",
      versionsDir: "/cache/versions",
      installedVersions: [],
      sourceDir: "/cache/source",
    });
    expect(text).toContain("Triage launcher version: 1.2.3 (the `multi-vpn-client` command that started this session, not necessarily");
    expect(text).toContain("Versions unpacked (by the launcher or the app's updater): none, in /cache/versions");
  });
});
