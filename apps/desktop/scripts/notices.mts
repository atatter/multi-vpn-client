// Writes build/THIRD_PARTY_NOTICES.txt, which electron-builder.yml puts in the app's resources: the licenses of everything a
// release archive contains besides Electron (whose own LICENSE files electron-builder adds). Run after electron-vite
// build, which records the npm packages each bundle pulls in (electron.vite.config.ts).
//   node apps/desktop/scripts/notices.mts
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const desktop = join(import.meta.dirname, '..');
const root = join(desktop, '..', '..');
const read = (...path: string[]) => readFileSync(join(...path), 'utf8');

/**
 * The sources Bun links into the helper and card bridge, per Bun version: JavaScriptCore/WebKit (LGPL-2.0-or-later)
 * and tinycc (LGPL-2.1). From scripts/build/deps/{webkit,tinycc}.ts at Bun's release tag. A Bun update has to add its
 * entry and licenses/bun-<version>-LICENSE.md, or this script stops the release.
 */
const BUN_SOURCES: Record<string, { webkit: string; tinycc: string }> = {
  '1.4.4': {
    webkit: 'd6375c72affe0f70222cdcb45012b10f0bf3a9d5',
    tinycc: '05f0fafaa3be31e31d7b4b5c17dc60f62c991171',
  },
};

const PackageJson = z.object({
  name: z.string(),
  // Workspace packages have none; every published one does.
  version: z.string().optional(),
  license: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});
const packageJson = (dir: string) => PackageJson.parse(JSON.parse(read(dir, 'package.json')));

// The helper and card bridge are compiled with Bun; both must use the same one.
const bunVersions = new Set(
  ['helper', 'card-bridge'].map(
    (name) => packageJson(join(root, 'packages', name)).devDependencies?.bun,
  ),
);
const [bun] = bunVersions;
if (bunVersions.size !== 1 || !bun) {
  throw new Error(
    `The helper and card bridge must build with the same Bun; they use ${[...bunVersions].join(', ')}.`,
  );
}
const bunSources = BUN_SOURCES[bun];
if (!bunSources || !existsSync(join(desktop, 'licenses', `bun-${bun}-LICENSE.md`))) {
  throw new Error(
    `Bun ${bun} has no notice yet: add its WebKit and tinycc commits to BUN_SOURCES and licenses/bun-${bun}-LICENSE.md.`,
  );
}

/** The folders of every npm package whose code ships: what the bundles pulled in, plus what Bun compiles into the binaries. */
function shippedPackages(): string[] {
  const recorded = readdirSync(join(desktop, 'build'))
    .filter((file) => /^packages-.+\.json$/.test(file))
    .flatMap((file) => z.array(z.string()).parse(JSON.parse(read(desktop, 'build', file))));
  if (recorded.length === 0) {
    throw new Error('No recorded packages: run electron-vite build first.');
  }

  const compiled = ['helper', 'card-bridge'].flatMap((name) => {
    const dir = join(root, 'packages', name);
    return Object.keys(packageJson(dir).dependencies ?? {})
      .filter((dependency) => !dependency.startsWith('@repo/'))
      .map((dependency) => realpathSync(join(dir, 'node_modules', dependency)));
  });
  // Tailwind writes its preflight base styles into the window's stylesheet.
  const inlined = [realpathSync(join(desktop, 'node_modules', 'tailwindcss'))];

  return [...new Set([...recorded, ...compiled, ...inlined].map((dir) => realpathSync(dir)))];
}

function packageNotice(dir: string): { id: string; text: string } {
  const { name, version = '', license } = packageJson(dir);
  const file = readdirSync(dir).find((entry) => /^(licen[cs]e|copying)(\.[a-z]+)?$/i.test(entry));
  if (!file) {
    throw new Error(
      `${name}@${version} ships no license file, so its notice can't be included. Check its license (${license ?? 'none given'}) by hand.`,
    );
  }

  return {
    id: `${name}@${version}`,
    text: `${name} ${version} (${license ?? 'see below'})\n\n${read(dir, file).trim()}`,
  };
}

const notices = [
  ...new Map(
    shippedPackages()
      .map(packageNotice)
      .map((notice) => [notice.id, notice.text]),
  ).entries(),
]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, text]) => text);
const rule = (title: string) => `\n\n${'='.repeat(79)}\n${title}\n${'='.repeat(79)}\n\n`;
const { version } = packageJson(desktop);
if (!version) {
  throw new Error('apps/desktop/package.json has no version.');
}

writeFileSync(
  join(desktop, 'build', 'THIRD_PARTY_NOTICES.txt'),
  `Multi VPN Client ${version}

Multi VPN Client is licensed under the MIT license (below). It includes software from others, under the licenses that
follow. Electron and Chromium's licenses are in LICENSE.electron.txt and LICENSES.chromium.html, shipped with the app.
${rule('Multi VPN Client')}${read(root, 'LICENSE').trim()}${rule('Bun runtime, in the network helper and the card bridge')}The network helper (resources/helper) and the card bridge (resources/card-bridge) are compiled with Bun ${bun}
(https://bun.com, MIT license). Bun statically links JavaScriptCore and WebKit, licensed under the GNU Library
General Public License version 2 or later, and tinycc, licensed under the GNU Lesser General Public License version
2.1. Both license texts are below.

Source and relinking. You may modify these libraries and relink the helper and card bridge with your changes:
  - Bun ${bun}: https://github.com/oven-sh/bun/tree/bun-v${bun}
  - WebKit and JavaScriptCore: https://github.com/oven-sh/WebKit, commit ${bunSources.webkit}
  - tinycc: https://github.com/oven-sh/tinycc, commit ${bunSources.tinycc}
  - The helper's and card bridge's own source: https://github.com/atatter/multi-vpn-client, tag v${version}
To relink: build Bun with your modified libraries as described in Bun's license below (bun run build:local), then
compile packages/helper/src/main.ts and packages/card-bridge/src/main.ts with
\`bun build --compile --compile-executable-path=<your bun>\`, as packages/*/scripts/build.ts do.

Written offer. For three years after we distribute this version, anyone may ask for the complete corresponding source
code of these libraries, as used here, by opening an issue at https://github.com/atatter/multi-vpn-client/issues.
We'll provide it on a medium customarily used for software interchange, for no more than the cost of providing it.
${rule("Bun's license")}${read(desktop, 'licenses', `bun-${bun}-LICENSE.md`).trim()}${rule('GNU Library General Public License, version 2')}${read(desktop, 'licenses', 'LGPL-2.0.txt').trim()}${rule('GNU Lesser General Public License, version 2.1')}${read(desktop, 'licenses', 'LGPL-2.1.txt').trim()}${rule('npm packages bundled into the app')}${notices.join('\n\n' + '-'.repeat(79) + '\n\n')}
`,
);
console.log(`Wrote build/THIRD_PARTY_NOTICES.txt: Bun ${bun} and ${notices.length} npm packages.`);
