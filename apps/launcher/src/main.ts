// `npx multi-vpn-client`: downloads this version of the app once, checks it against the checksums this package was
// published with, and starts it. `npx multi-vpn-client triage` starts the user's coding agent with the triage playbook
// instead. Built into one file by `bun build` (see package.json); scripts/pack.ts adds the release.json and
// PLAYBOOK.md it reads.
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, release, tmpdir, version as osVersion } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ensureInstalled, readOptional } from "./install.ts";
import { Manifest, needsNoSandbox, targetOf, versionsDir } from "./release.ts";
import { AGENTS, contextText, findOnPath, isAgent, pickAgent, SEED_PROMPT, type Agent } from "./triage.ts";

const USAGE = `Usage: npx multi-vpn-client [options]
       npx multi-vpn-client triage [--agent claude|codex]

Downloads Multi VPN Client (once per version) and starts it. Other options are passed on to the app.

triage starts Claude Code or Codex on this machine to find out what's wrong with the app,
and to help file a GitHub issue about it.

Options:
  --version   Print the version this launcher starts
  --help      Show this help`;

function readManifest(): Manifest {
  try {
    return Manifest.parse(JSON.parse(readFileSync(new URL("./release.json", import.meta.url), "utf8")));
  } catch (error) {
    throw new Error(`This launcher's release.json is missing or broken, so it doesn't know what to start. ${String(error)}`);
  }
}

async function start(args: string[]): Promise<void> {
  const manifest = readManifest();
  const { platform } = process;
  const executable = await ensureInstalled({
    manifest,
    target: targetOf(platform, process.arch),
    dir: versionsDir(process.env, platform, homedir()),
    platform,
    env: process.env,
    log: (line) => console.error(line),
  });
  const noSandbox = needsNoSandbox(platform, readOptional("/proc/sys/kernel/apparmor_restrict_unprivileged_userns"));
  if (noSandbox) console.error("AppArmor blocks Electron's sandbox here, so the window runs without it.");
  const app = spawn(executable, noSandbox ? ["--no-sandbox", ...args] : args, { detached: true, stdio: "ignore" });
  await new Promise<void>((resolve, reject) => {
    app.once("spawn", resolve);
    app.once("error", reject);
  });
  app.unref();
  console.error(`Started Multi VPN Client ${manifest.version}.`);
}

async function triage(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { agent: { type: "string" } } });
  const manifest = readManifest();
  const { platform } = process;
  const versions = versionsDir(process.env, platform, homedir());

  const folder = await mkdtemp(join(tmpdir(), "multi-vpn-client-triage-"));
  await copyFile(fileURLToPath(new URL("./PLAYBOOK.md", import.meta.url)), join(folder, "PLAYBOOK.md"));
  const sourceDir = join(dirname(versions), "source");
  await mkdir(sourceDir, { recursive: true });
  let installedVersions: string[] = [];
  try {
    installedVersions = readdirSync(versions).filter((entry) => !entry.startsWith("."));
  } catch {
    // Nothing unpacked yet.
  }
  await writeFile(
    join(folder, "CONTEXT.md"),
    contextText({
      launcherVersion: manifest.version,
      platform,
      arch: process.arch,
      osRelease: release(),
      osVersion: osVersion(),
      node: process.version,
      versionsDir: versions,
      installedVersions,
      sourceDir,
    }),
  );

  const found = new Map<Agent, string>();
  for (const agent of Object.keys(AGENTS).filter(isAgent)) {
    const path = findOnPath(agent, process.env, platform);
    if (path) found.set(agent, path);
  }
  const pick = pickAgent([...found.keys()], values.agent);
  if ("error" in pick) throw new Error(pick.error);
  if ("none" in pick) {
    console.log(`Neither Claude Code (claude) nor Codex (codex) is installed. The triage playbook and this machine's facts are in
  ${folder}
Start any coding agent in that folder and ask it to follow PLAYBOOK.md.`);
    return;
  }
  let agent: Agent;
  if ("agent" in pick) agent = pick.agent;
  else {
    if (!process.stdin.isTTY) throw new Error("Both claude and codex are installed. Choose one with --agent claude or --agent codex.");
    const question = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await question.question(`Start ${pick.ask.map((id, index) => `${index + 1}) ${AGENTS[id]}`).join(" or ")}? `)).trim();
    question.close();
    const chosen = pick.ask[Number(answer) - 1];
    if (!chosen) throw new Error("No agent chosen.");
    agent = chosen;
  }

  const command = found.get(agent);
  if (!command) throw new Error(`${AGENTS[agent]} isn't on PATH.`);
  console.log(`Starting ${AGENTS[agent]} with the triage playbook. It will ask what went wrong.`);
  // npm-installed agents are .cmd files on Windows, which only start through cmd.exe; SEED_PROMPT is safe to pass there.
  const viaShell = platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const session = spawn(command, [viaShell ? `"${SEED_PROMPT}"` : SEED_PROMPT], { cwd: folder, stdio: "inherit", shell: viaShell });
  process.exitCode = await new Promise<number>((resolve, reject) => {
    session.once("error", reject);
    session.once("exit", (code) => resolve(code ?? 1));
  });
}

async function main(args: string[]): Promise<void> {
  if (args[0] === "--help" || args[0] === "-h") console.log(USAGE);
  else if (args[0] === "--version") console.log(readManifest().version);
  else if (args[0] === "triage") await triage(args.slice(1));
  else await start(args);
}

await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
