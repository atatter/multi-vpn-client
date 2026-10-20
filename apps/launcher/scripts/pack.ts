// Assembles the npm package `multi-vpn-client` from the bundled launcher (pnpm --filter @repo/launcher build), the
// triage playbook, and a release's archives, with each archive's SHA-256 in release.json:
//   node apps/launcher/scripts/pack.ts --version 1.2.3 --archives apps/desktop/dist --out npm-package
// Every machine in ARCHIVE_TYPES must have its archive; --partial allows missing ones, for trying a local build.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, realpathSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ARCHIVE_TYPES, archiveFile, isTarget, Manifest } from "../src/release.ts";

const { values } = parseArgs({
  options: { version: { type: "string" }, archives: { type: "string" }, out: { type: "string" }, partial: { type: "boolean", default: false } },
});
const { version, archives, out, partial } = values;
if (!version || !archives || !out) throw new Error("Usage: pack.ts --version <x.y.z> --archives <dir> --out <dir> [--partial]");

const sha256 = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });

const manifest: Manifest = { version, archives: {} };
for (const target of Object.keys(ARCHIVE_TYPES).filter(isTarget)) {
  const file = archiveFile(version, target);
  if (!existsSync(join(archives, file))) {
    if (partial) continue;
    throw new Error(`${file} is missing from ${archives}.`);
  }
  manifest.archives[target] = { file, sha256: await sha256(join(archives, file)) };
}
if (Object.keys(manifest.archives).length === 0) throw new Error(`No archives for ${version} in ${archives}.`);
Manifest.parse(manifest);

const root = join(import.meta.dirname, "..", "..", "..");
const bundle = join(import.meta.dirname, "..", "dist", "launcher.mjs");
if (!existsSync(bundle)) throw new Error("Build the launcher first: pnpm --filter @repo/launcher build");

await mkdir(out, { recursive: true });
await copyFile(bundle, join(out, "bin.mjs"));
await copyFile(join(root, "LICENSE"), join(out, "LICENSE"));
// What `multi-vpn-client triage` hands the user's coding agent.
await copyFile(join(root, ".github", "triage", "PLAYBOOK.md"), join(out, "PLAYBOOK.md"));
// The bundle includes zod, its one dependency.
const zod = realpathSync(join(import.meta.dirname, "..", "node_modules", "zod"));
const { version: zodVersion } = JSON.parse(await readFile(join(zod, "package.json"), "utf8"));
await writeFile(
  join(out, "THIRD_PARTY_NOTICES.txt"),
  `bin.mjs includes zod ${zodVersion} (https://zod.dev), under the MIT license:\n\n${(await readFile(join(zod, "LICENSE"), "utf8")).trim()}\n`,
);
await writeFile(join(out, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  join(out, "package.json"),
  `${JSON.stringify(
    {
      name: "multi-vpn-client",
      version,
      description: "Stay connected to several corporate VPNs at once, each carrying the sites you choose.",
      license: "MIT",
      repository: { type: "git", url: "git+https://github.com/atatter/multi-vpn-client.git" },
      homepage: "https://github.com/atatter/multi-vpn-client#readme",
      bugs: "https://github.com/atatter/multi-vpn-client/issues",
      type: "module",
      bin: { "multi-vpn-client": "bin.mjs" },
      files: ["bin.mjs", "release.json", "PLAYBOOK.md", "THIRD_PARTY_NOTICES.txt"],
      engines: { node: ">=22" },
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  join(out, "README.md"),
  `# Multi VPN Client

Stay connected to several corporate VPNs at once, each carrying the sites you choose.

\`\`\`sh
npx multi-vpn-client
\`\`\`

The first run downloads the app for this machine from the GitHub Release of version ${version}, checks it against the
checksum published in this package, and starts it. You need Docker installed and running.

Source, documentation and issues: https://github.com/atatter/multi-vpn-client
`,
);
console.log(`Packed multi-vpn-client ${version} for ${Object.keys(manifest.archives).join(", ")} into ${out}`);
