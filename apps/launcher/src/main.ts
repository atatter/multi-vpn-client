// `npx multi-vpn-client`: downloads this version of the app once, checks it against the checksums this package was
// published with, and starts it; or starts a newer version the app already updated itself to.
// `npx multi-vpn-client triage` starts the user's coding agent with the triage playbook instead, and
// `npx multi-vpn-client uninstall` removes the app and everything it put on the machine. Built into one file by
// `bun build` (see package.json); scripts/pack.ts adds the release.json and PLAYBOOK.md it reads.
import { appDir } from "@repo/core/store";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, release, tmpdir, version as osVersion } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ensureInstalled, executableIn, installedVersions, Manifest, targetOf, versionsDir } from "@repo/release";
import { needsNoSandbox, readOptional, versionToStart } from "./start.ts";
import { AGENTS, contextText, findOnPath, isAgent, pickAgent, SEED_PROMPT, type Agent } from "./triage.ts";
import { heldLock, keepQuestion, npxEntry, survey, uninstallSteps, type Step } from "./uninstall.ts";

const USAGE = `Usage: npx multi-vpn-client [options]
       npx multi-vpn-client triage [--agent claude|codex]
       npx multi-vpn-client uninstall

Downloads Multi VPN Client (once per version) and starts it. Other options are passed on to the app.

triage starts Claude Code or Codex on this machine to find out what's wrong with the app,
and to help file a GitHub issue about it.

uninstall removes the app from this computer: the network helper, the downloaded versions and
the VPN container images. It asks before deleting your VPNs and their saved passwords.

Options:
  --version   Print this launcher's version
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
  const dir = versionsDir(process.env, platform, homedir());
  const { version, download } = versionToStart(manifest.version, await installedVersions(dir, platform));
  if (download) console.error(`Downloading Multi VPN Client ${version}…`);
  const executable = download
    ? await ensureInstalled({ manifest, target: targetOf(platform, process.arch), dir, platform, env: process.env })
    : executableIn(join(dir, version), platform);
  const noSandbox = needsNoSandbox(platform, readOptional("/proc/sys/kernel/apparmor_restrict_unprivileged_userns"));
  if (noSandbox) console.error("AppArmor blocks Electron's sandbox here, so the window runs without it.");
  const app = spawn(executable, noSandbox ? ["--no-sandbox", ...args] : args, { detached: true, stdio: "ignore" });
  await new Promise<void>((resolve, reject) => {
    app.once("spawn", resolve);
    app.once("error", reject);
  });
  app.unref();
  console.error(`Started Multi VPN Client ${version}.`);
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
      installedVersions: await installedVersions(versions, platform),
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

/** Asks a yes/no question that defaults to no. */
async function confirm(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`${question} [y/N] `);
  prompt.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function uninstall(): Promise<void> {
  const { platform, env } = process;
  // A scratch config means a developer's test copy; its folder isn't one uninstall may delete.
  if (env.MVPN_CONFIG) throw new Error("MVPN_CONFIG is set, so this isn't the app's real data. Unset it to uninstall.");
  const lock = heldLock(appDir(env, platform), platform);
  if (lock) throw new Error(`Multi VPN Client is running. Quit it, which turns its VPNs off, then run uninstall again.\nIf it isn't running, delete ${lock} first.`);
  const found = await survey(env, platform, homedir());
  const launcher = npxEntry(fileURLToPath(import.meta.url));
  const launcherNote = launcher && `This command itself is in npm's npx cache and can't remove itself while it runs. Delete the folder ${launcher} to remove it.`;

  const question = keepQuestion(found);
  const planned = uninstallSteps(found, false);
  if (planned.length === 0 && !question) {
    console.log("Multi VPN Client isn't on this computer.");
    if (launcherNote) console.log(launcherNote);
    return;
  }
  if (!process.stdin.isTTY) throw new Error("uninstall asks before it removes anything, so run it in a terminal.");
  const list = (steps: Step[]) => steps.map((step) => `  • ${step.what}${"reason" in step ? `: ${step.reason}` : ""}`).join("\n");
  const removable = planned.filter((step) => "run" in step);
  if (removable.length > 0) console.log(`This removes Multi VPN Client from this computer:\n${list(removable)}`);
  if (removable.length < planned.length) console.log(`It can't remove these now:\n${list(planned.filter((step) => "reason" in step))}`);
  const deleteVpns = question !== undefined && (await confirm(question));
  const steps = uninstallSteps(found, deleteVpns);
  if (steps.some((step) => "run" in step) && !(await confirm("Continue?"))) {
    console.log("Nothing was removed.");
    return;
  }

  const leftovers: Extract<Step, { reason: string }>[] = [];
  for (const step of steps) {
    if ("reason" in step) {
      leftovers.push(step);
      continue;
    }
    console.log(`Removing ${step.what}…`);
    await step.run().catch((error: unknown) => leftovers.push({ what: step.what, manual: step.manual, reason: error instanceof Error ? error.message : String(error) }));
  }
  if (leftovers.length > 0) {
    console.log(`\nThese are still on this computer:\n${leftovers.map(({ what, reason, manual }) => `  • ${what}: ${reason}\n    ${manual}`).join("\n")}`);
    process.exitCode = 1;
  } else console.log("\nMulti VPN Client is removed.");
  if (question && !deleteVpns) console.log(`Your VPNs and saved passwords are still in ${found.appFolder}, for when you install it again.`);
  if (launcherNote) console.log(launcherNote);
}

async function main(args: string[]): Promise<void> {
  if (args[0] === "--help" || args[0] === "-h") console.log(USAGE);
  else if (args[0] === "--version") console.log(readManifest().version);
  else if (args[0] === "triage") await triage(args.slice(1));
  else if (args[0] === "uninstall") await uninstall();
  else await start(args);
}

await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
