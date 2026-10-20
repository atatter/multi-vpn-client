import type { DockerState } from "@repo/core";
import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { run, runChecked } from "./process.ts";

/**
 * Thin wrapper over the docker CLI. Using the CLI (not the socket API) means it
 * works with whatever context Docker Desktop / Colima / OrbStack configured.
 */

/** Where Docker Desktop and Homebrew put the CLI; apps started from Finder or the Start menu may not get the shell's PATH. */
function knownLocations(platform = process.platform, env = process.env): string[] {
  if (platform === "win32") {
    return [
      join(env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "resources", "bin", "docker.exe"),
      ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, "Programs", "DockerDesktop", "resources", "bin", "docker.exe")] : []),
    ];
  }
  return ["/usr/local/bin/docker", "/opt/homebrew/bin/docker", "/Applications/Docker.app/Contents/Resources/bin/docker"];
}

export async function findDocker(path = process.env.PATH ?? ""): Promise<string> {
  const name = process.platform === "win32" ? "docker.exe" : "docker";
  const candidates = [...path.split(delimiter).filter(Boolean).map((dir) => join(dir, name)), ...knownLocations()];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try the next one
    }
  }
  throw new Error("Docker isn't installed (no docker command found). Install Docker Desktop and try again.");
}

export type Docker = ReturnType<typeof createDocker>;

export function createDocker(bin: string) {
  return {
    bin,
    run: (args: readonly string[], input?: string | Buffer) => run(bin, args, input),
    runChecked: (args: readonly string[], input?: string | Buffer) => runChecked(bin, args, input),

    /** Throws a readable error when the daemon isn't reachable (e.g. Docker Desktop not started). */
    async assertRunning() {
      const result = await run(bin, ["info", "--format", "{{.ServerVersion}}"]);
      if (result.code !== 0) {
        const reason = result.stderr.trim().split("\n").at(-1) ?? "";
        throw new Error(`Docker isn't reachable. Start Docker Desktop and try again.${reason ? `\n${reason}` : ""}`);
      }
    },
  };
}

/** Whether Docker is installed and running. */
export async function dockerState(): Promise<DockerState> {
  const bin = await findDocker().catch(() => undefined);
  if (!bin) return "missing";
  return createDocker(bin).assertRunning().then(
    () => "running",
    () => "stopped",
  );
}

/** Starts Docker Desktop where the app can (macOS, Windows, Docker Desktop for Linux); says how otherwise. */
export async function startDocker(): Promise<void> {
  const launch = (command: string, args: string[]) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { detached: true, stdio: "ignore" });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  if (process.platform === "darwin") return launch("open", ["-a", "Docker"]);
  if (process.platform === "win32") return launch(join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "Docker Desktop.exe"), []);
  // Docker Desktop for Linux is a user service; Docker Engine needs root, which the app doesn't have.
  const started = await new Promise<boolean>((resolve) => {
    const child = spawn("systemctl", ["--user", "start", "docker-desktop"], { stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
  if (!started) throw new Error("Start Docker from a terminal: sudo systemctl start docker");
}
