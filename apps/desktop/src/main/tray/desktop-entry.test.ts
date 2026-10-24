import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { desktopEntryFiles } from "@repo/core/store";
import { desktopEntry, syncDesktopEntry } from "./desktop-entry.ts";

describe("desktopEntry", () => {
  it("starts the build that runs, and names the window the dock matches", () => {
    const entry = desktopEntry({ command: ["/home/ann/.cache/multi-vpn-client/0.2.0/multi-vpn-client", "--no-sandbox"], icon: "/home/ann/icon.png" });
    expect(entry).toContain('\nExec="/home/ann/.cache/multi-vpn-client/0.2.0/multi-vpn-client" "--no-sandbox"\n');
    expect(entry).toContain("\nTryExec=/home/ann/.cache/multi-vpn-client/0.2.0/multi-vpn-client\n");
    expect(entry).toContain("\nStartupWMClass=dev.multi-vpn-client\n");
  });

  it("quotes paths with spaces, quotes, $ and % the way the spec reads them", () => {
    const entry = desktopEntry({ command: ['/opt/My "VPN" $HOME/100%/app'], icon: "/i.png" });
    // Inside quotes: \" and \$, then every \ doubled for the value itself; % is %%.
    expect(entry).toContain(String.raw`Exec="/opt/My \\"VPN\\" \\$HOME/100%%/app"`);
  });
});

describe("syncDesktopEntry", () => {
  let home: string;
  let iconSource: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "mvpn-desktop-entry-"));
    iconSource = join(home, "icon.png");
    await writeFile(iconSource, "png");
  });
  afterEach(() => rm(home, { recursive: true, force: true }));

  const files = () => desktopEntryFiles({ XDG_DATA_HOME: home }, "/unused");

  it("writes the entry and its icon, and rewrites only when the build that runs moves", async () => {
    expect(await syncDesktopEntry({ files: files(), command: ["/v1/app"], iconSource })).toBe(true);
    expect(await readFile(files().icon, "utf8")).toBe("png");
    expect(await readFile(files().entry, "utf8")).toContain('Exec="/v1/app"');

    expect(await syncDesktopEntry({ files: files(), command: ["/v1/app"], iconSource })).toBe(false);

    expect(await syncDesktopEntry({ files: files(), command: ["/v2/app"], iconSource })).toBe(true);
    expect(await readFile(files().entry, "utf8")).toContain('Exec="/v2/app"');
  });
});
