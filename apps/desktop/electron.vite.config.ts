import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Writes the npm packages a build pulls in to build/packages-<name>.json, for scripts/notices.mts: shipping their code
 * means shipping their licenses. Listed from the module graph and the emitted files' origins (fonts arrive through a
 * CSS @import, not as modules), so it can only err on the side of a notice too many.
 */
function recordPackages(name: string): Plugin {
  let root = '';
  return {
    name: 'record-packages',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    generateBundle(_options, bundle) {
      const dirs = new Set<string>();
      const sources = [
        ...this.getModuleIds(),
        ...Object.values(bundle).flatMap((output) =>
          output.type === 'asset'
            ? output.originalFileNames.map((file) => resolve(root, file))
            : [],
        ),
      ];

      for (const source of sources) {
        // The last node_modules segment is the package itself, also under pnpm's .pnpm/<name>@<version>/node_modules.
        const dir = /^\0?(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(
          source,
        )?.[1];
        if (dir) {
          dirs.add(dir);
        }
      }

      mkdirSync(join(import.meta.dirname, 'build'), { recursive: true });
      writeFileSync(
        join(import.meta.dirname, 'build', `packages-${name}.json`),
        `${JSON.stringify([...dirs].sort(), null, 2)}\n`,
      );
    },
  };
}

// Main and preload bundle everything (including the TS-source @repo/core workspace package);
// the sandboxed preload can't require node_modules at runtime anyway. Their output is CommonJS, which Rolldown leaves
// in sloppy mode unless the source says "use strict"; ES modules never do, so strict mode is asked for here.
const nodeBuild = { externalizeDeps: false, rolldownOptions: { output: { strict: true } } };

export default defineConfig({
  main: { build: nodeBuild, plugins: [recordPackages('main')] },
  preload: { build: nodeBuild, plugins: [recordPackages('preload')] },
  renderer: { plugins: [react(), tailwindcss(), recordPackages('renderer')] },
});
