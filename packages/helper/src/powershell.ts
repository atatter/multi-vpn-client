import { type ExecFileException, execFile } from 'node:child_process';
import { join } from 'node:path';

/** Runs a PowerShell script; rejects with its stderr on failure. */
export type RunPowerShell = (script: string) => Promise<void>;

const powershellPath = () =>
  join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );

const failureReason = (error: ExecFileException) => {
  if (error.killed) {
    return 'timed out';
  }

  return typeof error.code === 'number' ? `exit ${error.code}` : error.message;
};

/**
 * Windows only. -EncodedCommand (base64 of UTF-16LE) sidesteps every quoting rule of the command line.
 * Progress is turned off: with stderr redirected, PowerShell writes it there as CLIXML, burying real errors.
 */
export const runPowerShell: RunPowerShell = (script) =>
  new Promise((resolve, reject) =>
    execFile(
      powershellPath(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(`$ProgressPreference = 'SilentlyContinue'\n${script}`, 'utf16le').toString(
          'base64',
        ),
      ],
      { timeout: 30_000, windowsHide: true },
      (error, _stdout, stderr) => {
        if (!error) {
          return resolve();
        }

        const reason = failureReason(error);
        reject(
          new Error(
            stderr.trim() ? `${stderr.trim()} (${reason})` : `PowerShell failed (${reason})`,
          ),
        );
      },
    ),
  );

/** Quotes a value as a PowerShell single-quoted string. */
export const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
