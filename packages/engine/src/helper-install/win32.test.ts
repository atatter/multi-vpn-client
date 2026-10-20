import { describe, expect, it } from "vitest";
import { taskXml, windowsInstallScript, windowsUninstallScript } from "./win32.ts";

describe("helper install scripts", () => {
  it("Windows: SYSTEM task, quoted paths, checksums, key from a file, private folders", () => {
    const install = windowsInstallScript({
      helperBinary: "C:\\Users\\o'brien\\dev\\mvpn-helper-win32-x64.exe",
      helperSha256: "a".repeat(64),
      singBox: { path: "C:\\Users\\o'brien\\AppData\\Roaming\\multi-vpn-client\\bin\\sing-box-1.14.3\\sing-box.exe", sha256: "b".repeat(64) },
      configFile: "C:\\Users\\o'brien\\AppData\\Local\\Temp\\mvpn-helper-config-1\\helper.json",
    });
    expect(install).toContain("Copy-Item -LiteralPath 'C:\\Users\\o''brien\\dev\\mvpn-helper-win32-x64.exe'");
    expect(install).toContain(`-ne '${"a".repeat(64)}') { Fail 'helper checksum mismatch' }`);
    expect(install).toContain(`Lock "$dir\\$sub" @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')`);
    expect(install).not.toContain("key");
    expect(taskXml()).toContain("<UserId>S-1-5-18</UserId>");
    expect(taskXml()).toContain("<Arguments>serve</Arguments>");
    expect(windowsUninstallScript()).toContain("Remove-DnsClientNrptRule");
  });

});
