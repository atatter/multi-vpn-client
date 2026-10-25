import { spawn } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a command to completion (no shell), optionally feeding stdin. Never throws on a non-zero exit; a
 * command still running after `timeoutMs` is killed and reads as failed.
 */
export function run(
  command: string,
  args: readonly string[],
  input?: string | Buffer,
  timeoutMs?: number,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: timeoutMs });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    // A killed command's own children (e.g. what `sh -c` forked) can hold its pipes open; don't wait for them.
    child.on('exit', (_code, signal) => {
      if (signal) {
        [child.stdout, child.stderr].forEach((stream) => stream.destroy());
      }
    });
    child.on('close', (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }),
    );
    child.stdin.end(input);
  });
}

/** Like `run`, but throws with stderr when the command fails. Returns stdout. */
export async function runChecked(
  command: string,
  args: readonly string[],
  input?: string | Buffer,
): Promise<string> {
  const result = await run(command, args, input);
  if (result.code !== 0) {
    throw new Error(
      (result.stderr || result.stdout).trim() || `${command} exited with ${result.code}`,
    );
  }

  return result.stdout;
}

/** Single-quotes a value for POSIX sh. */
export const shQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
