import { statSync } from "node:fs";
import { join } from "node:path";

/** The coding agents triage can start, by the command they install. */
export const AGENTS = { claude: "Claude Code", codex: "Codex" } as const;
export type Agent = keyof typeof AGENTS;
export const isAgent = (value: string): value is Agent => value in AGENTS;

/**
 * The agent's first message. Fixed text with no paths in it: on Windows the npm-installed agents are .cmd files that
 * only start through cmd.exe, so this string reaches a command line. Everything else is in files next to it.
 */
export const SEED_PROMPT =
  "A Multi VPN Client user started this session with multi-vpn-client triage. Read PLAYBOOK.md and CONTEXT.md in the current folder and follow the playbook. Start by asking the user what went wrong.";

/** Where the shell would find `command`, including the .cmd and .exe shims npm installs on Windows. */
export function findOnPath(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  const extensions = platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of (env.PATH ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(dir, command + extension.toLowerCase());
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Not in this folder.
      }
    }
  }
  return undefined;
}

/** Which agent to start: the one asked for, the only one installed, or a question when there are both. */
export function pickAgent(
  installed: readonly Agent[],
  requested: string | undefined,
): { agent: Agent } | { ask: readonly Agent[] } | { error: string } | { none: true } {
  if (requested !== undefined) {
    if (!isAgent(requested)) return { error: `--agent must be ${Object.keys(AGENTS).join(" or ")}.` };
    return installed.includes(requested) ? { agent: requested } : { error: `${AGENTS[requested]} (${requested}) isn't installed or isn't on PATH.` };
  }
  const [only] = installed;
  if (installed.length === 1 && only) return { agent: only };
  if (installed.length > 1) return { ask: installed };
  return { none: true };
}

export interface MachineFacts {
  launcherVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  osRelease: string;
  osVersion: string;
  node: string;
  versionsDir: string;
  installedVersions: readonly string[];
  sourceDir: string;
}

/** CONTEXT.md: what the playbook can't know about this machine. */
export const contextText = (facts: MachineFacts) => `# Triage context

Facts collected by \`multi-vpn-client triage\` when this session started.

- Triage launcher version: ${facts.launcherVersion} (the \`multi-vpn-client\` command that started this session, not necessarily the app version the problem happened on)
- OS: ${facts.platform} ${facts.arch}, ${facts.osVersion} (${facts.osRelease})
- Node: ${facts.node}
- Versions unpacked (by the launcher or the app's updater): ${facts.installedVersions.length > 0 ? facts.installedVersions.join(", ") : "none"}, in ${facts.versionsDir}
- Source folder for clones: ${facts.sourceDir}
`;
