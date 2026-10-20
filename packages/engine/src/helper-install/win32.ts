import { RESOLVER_MARK } from "@repo/core";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../process.ts";
import type { InstallPlan, PlatformInstaller } from "./index.ts";

/**
 * Windows: a scheduled task that runs the helper as SYSTEM at boot (no service wrapper
 * needed). The TUN driver (Wintun) only lets SYSTEM and administrators in, so that's the
 * least it can run as. Installed through one UAC prompt.
 */

const TASK = "multi-vpn-client-helper";
const INSTALL_DIR = join(process.env.ProgramFiles ?? "C:\\Program Files", "multi-vpn-client", "helper");
const SYSTEM_ROOT = process.env.SystemRoot ?? "C:\\Windows";
const POWERSHELL = join(SYSTEM_ROOT, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

/** Quotes a value as a PowerShell single-quoted string. */
const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;

const xmlEscape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Runs at boot as SYSTEM, forever, restarted (every minute, up to 255 times) if it fails. */
export function taskXml(): string {
  return `<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>multi-vpn-client network helper</Description></RegistrationInfo>
  <Triggers><BootTrigger><Enabled>true</Enabled></BootTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>255</Count></RestartOnFailure>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec>
    <Command>"${xmlEscape(join(INSTALL_DIR, "mvpn-helper.exe"))}"</Command>
    <Arguments>serve</Arguments>
  </Exec></Actions>
</Task>`;
}

/** Stops the task and anything still running from the install folder. */
const STOP = `Stop-ScheduledTask -TaskName '${TASK}' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName '${TASK}' -Confirm:$false -ErrorAction SilentlyContinue
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith("$dir\\", 'OrdinalIgnoreCase') } | Stop-Process -Force
Start-Sleep -Seconds 1`;

/** Elevated script that removes the helper and everything it created. */
export function windowsUninstallScript(): string {
  return `$ErrorActionPreference = 'Continue'
$dir = ${psQuote(INSTALL_DIR)}
${STOP}
Get-DnsClientNrptRule | Where-Object Comment -eq ${psQuote(RESOLVER_MARK)} | Remove-DnsClientNrptRule -Force
Clear-DnsClientCache
Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Split-Path $dir) -Force -ErrorAction SilentlyContinue
# The Wintun driver stays: other software (WireGuard, for one) shares it.
exit 0
`;
}

/**
 * Elevated script that (re)installs the helper; aborts and cleans up if a checksum doesn't match.
 * Folder permissions are set explicitly instead of inherited: the install folder is readable by
 * users (so the app can show the log), private\\ and work\\ by SYSTEM and administrators only.
 * The settings come from a file in the user's temp folder, so the key never shows up in a command line.
 */
export function windowsInstallScript(p: Omit<InstallPlan, "configJson"> & { configFile: string }): string {
  const SY = "*S-1-5-18";
  const BA = "*S-1-5-32-544";
  const BU = "*S-1-5-32-545";
  return `$ErrorActionPreference = 'Stop'
$dir = ${psQuote(INSTALL_DIR)}
function Fail($message) { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue; throw $message }
function Lock($path, [string[]]$grants) {
  & icacls $path /inheritance:r /grant:r $grants | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "Setting permissions on $path failed" }
}
${STOP}
if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
New-Item -ItemType Directory -Path $dir -Force | Out-Null
Lock $dir @('${SY}:(OI)(CI)F', '${BA}:(OI)(CI)F', '${BU}:(OI)(CI)RX')
foreach ($sub in 'private', 'work') {
  New-Item -ItemType Directory -Path "$dir\\$sub" | Out-Null
  Lock "$dir\\$sub" @('${SY}:(OI)(CI)F', '${BA}:(OI)(CI)F')
}
Copy-Item -LiteralPath ${psQuote(p.helperBinary)} -Destination "$dir\\mvpn-helper.exe"
Copy-Item -LiteralPath ${psQuote(p.singBox.path)} -Destination "$dir\\sing-box.exe"
if ((Get-FileHash -Algorithm SHA256 -LiteralPath "$dir\\mvpn-helper.exe").Hash -ne ${psQuote(p.helperSha256)}) { Fail 'helper checksum mismatch' }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath "$dir\\sing-box.exe").Hash -ne ${psQuote(p.singBox.sha256)}) { Fail 'sing-box checksum mismatch' }
Copy-Item -LiteralPath ${psQuote(p.configFile)} -Destination "$dir\\private\\helper.json"
Register-ScheduledTask -TaskName '${TASK}' -Xml ${psQuote(taskXml())} -Force | Out-Null
Start-ScheduledTask -TaskName '${TASK}'
exit 0
`;
}

/**
 * Runs a script elevated through the UAC prompt and waits for it. An elevated process's
 * output can't be captured, so the script reports a failure through a file in the user's
 * temp folder instead.
 */
async function runAsAdmin(script: string): Promise<void> {
  const staging = await mkdtemp(join(tmpdir(), "mvpn-helper-"));
  try {
    const errorFile = join(staging, "error.txt");
    const wrapped = `try {\n${script}\n} catch {\n  $_.ToString() | Out-File -LiteralPath ${psQuote(errorFile)} -Encoding utf8\n  exit 1\n}`;
    const encoded = Buffer.from(wrapped, "utf16le").toString("base64");
    const launcher =
      `$p = Start-Process -FilePath ${psQuote(POWERSHELL)} -Verb RunAs -WindowStyle Hidden -Wait -PassThru ` +
      `-ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'; exit $p.ExitCode`;
    const result = await run(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", launcher]);
    if (result.code === 0) return;
    // Declining the UAC prompt makes Start-Process fail with "canceled by the user".
    if (/cancel/i.test(result.stderr)) throw new Error("Administrator access was cancelled.");
    const reported = await readFile(errorFile, "utf8").catch(() => "");
    throw new Error(reported.trim() || result.stderr.trim() || `The administrator script failed (exit ${result.code}).`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export const win32Installer: PlatformInstaller = {
  logHint: join(INSTALL_DIR, "helper.log"),
  isInstalled: () => existsSync(join(INSTALL_DIR, "mvpn-helper.exe")),
  async install({ configJson, ...plan }) {
    // The user's temp folder is private to them.
    const staging = await mkdtemp(join(tmpdir(), "mvpn-helper-config-"));
    try {
      const configFile = join(staging, "helper.json");
      await writeFile(configFile, configJson);
      await runAsAdmin(windowsInstallScript({ ...plan, configFile }));
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  },
  uninstall: () => runAsAdmin(windowsUninstallScript()),
};
