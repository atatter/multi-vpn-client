# Code structure

Where code goes, how files are split and named. `pnpm lint` (oxlint, configured in `.oxlintrc.json`) checks the rules that can be checked. Errors fail; size warnings are a guideline.

## Packages

Each package runs in one kind of process, so the package boundary is the process boundary. Internal packages use the `@repo/*` scope; it's never published, so a product rename never touches imports.

`@repo/core`'s main entry runs in the renderer too. Node-only code goes behind its own entry point (`@repo/core/store`, `/host`, `/secret-store`, `/fs`, `/helper-crypto`), never in the main entry.

The VPN kinds are the exception: one kind's code runs in every process, so it stays in one folder and splits by file instead.
- `@repo/vpn-sdk` is the interface a kind is written against: `.` (runs everywhere), `/engine` and `/container` (Node), `/ui` (window), and `/cidr`, the range math its field types share with core. It names no kind.
- `@repo/vpns` holds one folder per kind in `integrations/`, what two of them share in `shared/`, and the three registries the app reads: `.` (`Vpn`, `kindSpec`, re-exported by core), `/engine` (`LAUNCHERS`), `/ui` (`FORMS`). Core, the engine and the window only import those, never an integration; the package's `exports` enforce it. Lint keeps each file to its process (see [adding-a-vpn-kind.md](adding-a-vpn-kind.md)).
- `@repo/ui` is the window's design kit, so kinds' forms can use it too.

## Desktop main process

- `main/index.ts` is the composition root: it builds the services, registers IPC and runs the app lifecycle. Nothing else wires services together.
- `shared/ipc-contract.ts` is the one main ⇄ renderer contract. `preload/index.ts` exposes it as `window.main` (`MainApi`).
- `main/ipc/handle.ts` is the only place main listens to the renderer. Each domain registers its handlers in `main/ipc/<domain>.ts`, and every argument is parsed, because it arrives as `unknown`.
- The window's `webPreferences` (sandboxed, isolated, no Node) are pinned by `main/window.test.ts`.

## Renderer layers

Imports only point down the list:

1. **`app/`**: the shell. Only the entry points (`main.tsx`, the harness) import it.
2. **Features**: one folder per part of the app (`vpn-list`, `vpn-page`, `vpn-form`, `traffic`, `add-vpn`, …).
   - A feature may render another feature's components, e.g. the VPN page renders `TrafficChoice`.
   - It never imports another feature's `.ts` logic. If two features need the same logic, it moves down into `domain/` or `store/`.
3. **`store/`**: the app store, its context, selectors over app state and actions on it.
4. **`domain/`**: pure functions and wording about VPNs and setup.
5. **`@repo/ui`** (`packages/ui`): the design kit. It knows nothing about VPNs. `Frame` gets the little it needs from the app through `FrameContext`, which `App` provides.

The renderer never imports Node, `electron`, `@repo/engine` or `@repo/vpns/engine`; it reaches main only through `app.api`. `store/fake-api.ts` implements the same `MainApi` for tests and the harness.

## State

Global state is a last resort. The store holds only what several screens need, or what async work can change after a screen is gone:
- **What main reports:** settings, connections, Docker, helper.
- **The waiting list:** VPNs turned on before setup was done.
- **Starting Docker:** it can outlast the screen that started it.
- **Open prompts.**
- **The error notice.**

Everything else is local to the component or screen that owns it: drafts, folds, drag order, lookups, and navigation (owned by `App`). Live traffic changes every second, so it has its own subscription (`useTraffic`) and re-renders only the views that show it.

## Rules

1. **Folders by feature.** Everything about one part of the app lives in one folder.
2. **Logic in `.ts`, markup in `.tsx`.** A decision worth testing is a plain function with a `.test.ts` next to it. Components render and call those functions.
3. **One component per file** once it's reused or longer than about 40 lines.
4. **Size: about 250 lines per file and 80 per function.** This is a guideline (lint warns), not a limit. Split where it makes the code clearer, not to satisfy a number. Closures that hold one piece of state, such as `createAppStore` and `createConnectionManager`, can be longer.
5. **Named exports only.** No `index.ts` barrels inside an app. Library packages (`core`, `engine`, `vpn-sdk`, `vpns`) have a root `index.ts` as their interface; binaries (`helper`, `card-bridge`, `cli`) start at `main.ts`. A per-OS folder's `index.ts` holds the interface its implementations share.
6. **No import cycles** (lint error).
7. **Suppressing a lint rule needs a reason**, on the line above: `// reason` then `// oxlint-disable-next-line rule-name`.

## File patterns

| Pattern | What goes in it | Example |
|---|---|---|
| `PascalCase.tsx` | One React component, named like the file. | `vpn-list/VpnRow.tsx` |
| `kebab-case.ts` | Logic without JSX, pure where possible. | `vpn-page/vpn-edit.ts` |
| `use-thing.ts` | One React hook, exported as `useThing`. Hooks use kebab-case like every non-component file. | `vpn-list/use-reorder.ts` |
| `*.test.ts(x)` | Next to the file it tests, same name. Prefer real inputs to mocks. | `vpn-page/vpn-edit.test.ts` |
| `*-copy.ts` | Tables of user-facing wording shared by several views. | `domain/setup-copy.ts` |
| `<module>/<platform>.ts` | Per-OS implementations behind the interface in the folder's `index.ts`. | `engine/helper-install/darwin.ts` |
| `vpns/src/integrations/<kind>/{kind,engine,container}.ts`, `form.tsx` | One VPN kind, by process (see [adding-a-vpn-kind.md](adding-a-vpn-kind.md)). | `vpns/src/integrations/checkpoint/` |
| `ipc/<domain>.ts` (main) | One domain's handlers, `register<Domain>Handlers(deps)`. | `main/ipc/vpn.ts` |

## How to add…

- **An IPC call:**
  1. Add the channel to `IpcContract` in `shared/ipc-contract.ts`.
  2. Expose it in `preload/index.ts`.
  3. Handle it in the right `main/ipc/<domain>.ts` with `handle()`, parsing every argument.
  4. Add it to `store/fake-api.ts`, so tests and the harness keep working.

  The renderer calls it through `app.api`, or through a store command when it changes shared state.
- **A VPN kind:** see [adding-a-vpn-kind.md](adding-a-vpn-kind.md).
- **A screen:**
  1. Add it to `Screen` in `store/screen.ts`.
  2. Create its feature folder, and add it to the feature lists in `.oxlintrc.json` so the layer rules cover it (`renderer-layers.test.ts` fails until you do).
  3. Add a case in `app/ScreenView.tsx`.
- **Shared wording:** put it in `domain/` (for example `labels.ts` or a `*-copy.ts` table), or in `store/vpn-status.ts` when it reads app state, so every screen says the same thing.
