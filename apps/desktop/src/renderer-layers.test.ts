import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// .oxlintrc.json names every renderer feature folder in each layer's import rule (see docs/code-structure.md).
// A folder missing from one of those lists would silently escape that rule, so this checks each list against
// the folders on disk.
const RENDERER = 'apps/desktop/src/renderer/src';
const LAYERS = ['app', 'store', 'domain'];

interface Override {
  files: string[];
  rules: Record<string, unknown>;
}
const root = new URL('../../../', import.meta.url);
const { overrides } = JSON.parse(readFileSync(new URL('.oxlintrc.json', root), 'utf8')) as {
  overrides: Override[];
};
const features = readdirSync(new URL(RENDERER, root), { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() && !LAYERS.includes(entry.name) ? [entry.name] : [],
);

/** What the override for exactly these files (in any order) forbids importing: package names and patterns. */
const restricted = (files: string[]) => {
  const key = (list: string[]) => list.toSorted().join();
  const override = overrides.find((candidate) => key(candidate.files) === key(files));
  const options = (
    override?.rules['eslint/no-restricted-imports'] as
      | [string, { paths?: { name: string }[]; patterns: { group: string[] }[] }]
      | undefined
  )?.[1];
  return [
    ...(options?.paths ?? []).map((path) => path.name),
    ...(options?.patterns ?? []).flatMap((pattern) => pattern.group),
  ];
};
const featureFiles = features.map((feature) => `${RENDERER}/${feature}/**`);

describe('the lint layer rules', () => {
  // The design kit is its own package now; it may import no other package, so no app code either.
  it('keep @repo/ui from importing the app or any VPN', () => {
    expect(restricted(['packages/ui/src/**'])).toContain('@repo/*');
  });

  it.each(['domain', 'store'])('keep %s/ from importing any feature', (layer) => {
    const groups = restricted([`${RENDERER}/${layer}/**`]);
    for (const feature of features) expect(groups).toContain(`**/${feature}/**`);
  });

  it("keep every feature from importing another feature's logic", () => {
    const groups = restricted(featureFiles);
    for (const feature of features) expect(groups).toContain(`../${feature}/**/*.ts`);
  });

  it('keep Node, electron and the engine out of every renderer layer', () => {
    const renderer = overrides.find((override) => override.files.includes(`${RENDERER}/**`));
    expect(renderer?.rules['import/no-nodejs-modules']).toBe('error');
    // A layer's rule replaces the renderer-wide one, so each layer repeats all of it.
    const everywhere = restricted([`${RENDERER}/**`, 'apps/desktop/harness/main.tsx']);
    expect(everywhere).toEqual(
      expect.arrayContaining(['electron', '@repo/engine', '@repo/vpns/engine']),
    );
    for (const files of [
      ...['domain', 'store'].map((layer) => [`${RENDERER}/${layer}/**`]),
      featureFiles,
    ]) {
      expect(restricted(files)).toEqual(expect.arrayContaining(everywhere));
    }
  });
});
