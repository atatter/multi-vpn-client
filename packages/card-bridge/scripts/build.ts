// Compiles the card bridge into a self-contained executable with Bun.
//   bun scripts/build.ts            build for this machine
//   bun scripts/build.ts --all      build every supported target
//   bun scripts/build.ts --os       build every target of this machine's OS (what a release packages here)
// Output: dist/mvpn-card-bridge-<platform>-<arch>[.exe] (Node naming: darwin-arm64, linux-x64, win32-x64…)

const TARGETS = {
  'darwin-arm64': 'bun-darwin-arm64',
  'darwin-x64': 'bun-darwin-x64',
  'linux-x64': 'bun-linux-x64',
  'linux-arm64': 'bun-linux-arm64',
  'win32-x64': 'bun-windows-x64',
} as const;

type Target = keyof typeof TARGETS;
const isTarget = (key: string): key is Target => key in TARGETS;

const host = `${process.platform}-${process.arch}`;
const all = Object.keys(TARGETS).filter(isTarget);
const selectedTargets = () => {
  if (process.argv.includes('--all')) {
    return all;
  }
  if (process.argv.includes('--os')) {
    return all.filter((target) => target.startsWith(`${process.platform}-`));
  }
  return [host].filter(isTarget);
};
const selected = selectedTargets();
if (selected.length === 0) {
  throw new Error(`No card bridge build target for ${host}`);
}

for (const target of selected) {
  const outfile = `dist/mvpn-card-bridge-${target}${target.startsWith('win32') ? '.exe' : ''}`;
  const result = await Bun.build({
    entrypoints: ['src/main.ts'],
    compile: { target: TARGETS[target], outfile },
  });
  if (!result.success) {
    for (const message of result.logs) {
      console.error(message);
    }
    process.exit(1);
  }
  console.log(`built ${outfile}`);
}
