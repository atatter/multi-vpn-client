import { statSync } from "node:fs";
import { join } from "node:path";

/** The coding agents triage can start, keyed by their `--agent` value, with the command each one installs. */
export const AGENTS = {
  claude: { name: "Claude Code", command: "claude" },
  codex: { name: "Codex", command: "codex" },
  // Cursor's installer puts the same program on PATH as `agent` too, a name too generic to trust.
  cursor: { name: "Cursor Agent", command: "cursor-agent" },
} as const;
export type Agent = keyof typeof AGENTS;
export const isAgent = (value: string): value is Agent => Object.hasOwn(AGENTS, value);

/** "a, b, or c", for listing agents in messages. */
export const orList = (items: readonly string[]) => new Intl.ListFormat("en", { type: "disjunction" }).format(items);

/**
 * The agent's first message. Fixed text with no paths in it: on Windows npm and Cursor install agents as .cmd files that
 * only start through cmd.exe, so this string reaches a command line. Everything else is in files next to it.
 */
export const SEED_PROMPT =
  "A Multi VPN Client user started this session with multi-vpn-client triage. Read PLAYBOOK.md and CONTEXT.md in the current folder and follow the playbook. Start by asking the user what went wrong.";

/** Where the shell would find `command`, including the .cmd and .exe shims npm and Cursor install on Windows. */
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

/** The agents installed on this machine, with where each one's command is. */
export function findAgents(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Map<Agent, string> {
  const found = new Map<Agent, string>();
  for (const agent of Object.keys(AGENTS).filter(isAgent)) {
    const path = findOnPath(AGENTS[agent].command, env, platform);
    if (path) found.set(agent, path);
  }
  return found;
}

/** Which agent to start: the one asked for, the only one installed, or a question when there are several. */
export function pickAgent(
  installed: readonly Agent[],
  requested: string | undefined,
): { agent: Agent } | { ask: readonly Agent[] } | { error: string } | { none: true } {
  if (requested !== undefined) {
    if (!isAgent(requested)) return { error: `--agent must be ${orList(Object.keys(AGENTS))}.` };
    const { name, command } = AGENTS[requested];
    return installed.includes(requested) ? { agent: requested } : { error: `${name} (${command}) isn't installed or isn't on PATH.` };
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
