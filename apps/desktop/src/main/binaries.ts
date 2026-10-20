import { app } from "electron";
import { join } from "node:path";

/**
 * An executable of ours for this OS/architecture: built by `pnpm build:helper` / `pnpm build:card-bridge`
 * in dev, bundled in resources when packaged.
 */
export const bundledBinary = (name: "helper" | "card-bridge") =>
  join(
    app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), "..", "..", "packages", name, "dist"),
    `mvpn-${name}-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`,
  );
