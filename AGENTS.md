# Multi VPN Client

Multi VPN Client switches between many corporate VPN accounts, or keeps several connected at once. Each VPN runs its official client (OpenVPN, openconnect, snx-rs, …) in its own Docker container. A small privileged helper points the host's routes and DNS at them, so every app on the machine uses the right VPN for each address without a proxy.

It's for people who work with several clients or companies at the same time. What it is and how to start it is in [README.md](README.md).

## What we can't compromise on

1. **The user's network keeps working.** The app changes routes and DNS on the user's real machine. A crash, a failed connect or a removed VPN must leave the network as it found it. A VPN that's off claims nothing.
2. **What the app says is true.** If the window shows "On", traffic goes through that VPN. No optimistic labels, no spinner that hides a failure, no route the user can't see.
3. **Credentials stay safe.** Passwords go through the OS keychain, the helper only takes requests from the app, and every IPC argument is parsed before use. Never trade a validation or a security check for fewer lines.
4. **Every OS.** It runs on macOS, Linux and Windows. Platform code sits behind one interface.

## A note from Aleks

I like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences should be able to override anything here.

## A small glossary

- **you**: the agent reading this file.
- **we, maintainers**: the people building Multi VPN Client, who you're talking to.
- **user**: the person who runs the app to reach their VPNs.
- **VPN**: one configured account. Its **kind** is the protocol (`openvpn`, `globalprotect`, `fortinet-ssl`, `checkpoint`).
- **traffic mode**: what a VPN carries. `official` is what its server pushes, `sites` is the user's list, `all` is everything.
- **priority**: the order of the VPNs that are on. When two cover an address, the higher one wins. A **pinned** route ignores priority.
- **helper**: the privileged service (`packages/helper`) that applies routes and DNS on the host. It is installed once from the setup card.
- **card bridge**: a user-level process that lends a smart card (Estonian ID card) to a VPN container.
- **engine**: the main-process code that starts containers and owns connections (`packages/engine`).
- **setup**: what must be ready before connecting, which is Docker running and the helper installed at the current version.

## The four ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID you found by matching a name or path. Your own agent process has this worktree's path in its argv, and the developer may be running their own copy of the app. Kill only a PID you captured at spawn, or the owner of your port from `ss -H -ltnp` after checking that `/proc/<pid>/cwd` is your worktree.
2. **Writing to the live config.** The app's folder (`~/.config/multi-vpn-client` on Linux, `~/Library/Application Support/Multi VPN Client` on macOS, `%APPDATA%\Multi VPN Client` on Windows) holds the developer's real VPNs: `config.json`, `secrets.json` and the helper's token. Reading them is fine. For anything that could write, set `MVPN_CONFIG` to a scratch path outside the worktree; secrets and the helper's token follow it. Electron's own data stays in the real folder, so a scratch copy quits while the real app runs.
3. **Killing live connections.** When the engine first finds Docker, it force-removes every container labelled `dev.multi-vpn-client=1`. Those include the developer's connected VPNs. Any second engine (a script, a test against real Docker, a second app) disconnects them. Ask before running the engine against real Docker.
4. **Touching the helper.** Installing, updating or removing the helper asks for the user's password and changes a system service. Connecting changes the machine's routes and DNS. Ask before doing either.

## Hit every surface

The most common defect is a change that works on the path you tested and is missing everywhere else. Before calling work done, walk this list and say which entries applied:

- **VPN kinds.** A change to connecting, signing in or the form needs a decision per kind, even if the decision is "not supported here". Each kind is one integration, a folder in `packages/vpns/src/integrations/`, registered once per process (see [docs/adding-a-vpn-kind.md](docs/adding-a-vpn-kind.md)).
- **Operating systems.** Per-OS code lives in `<module>/{darwin,linux,win32}.ts` behind an `index.ts`. If you change one, check the others.
- **The IPC contract.** A new call touches `shared/ipc-contract.ts`, `preload/index.ts`, a handler in `main/ipc/`, and `store/fake-api.ts`. If you skip the last one, tests and the harness break. See [docs/code-structure.md](docs/code-structure.md#how-to-add).
- **Saved data.** Users have config files written by older versions. A new config field needs a default so they still load. A change to the helper protocol bumps `HELPER_VERSION`, which makes users update their helper. Say so in the PR.
- **Setup states.** Check the change with Docker stopped, the helper missing, the helper outdated, and a VPN waiting for setup.
- **Reverse states.** If you added a way in, add the way out and the way to see it. Connect needs disconnect, pin needs unpin, and a route the app added must go away when the VPN does.
- **Docs.** Check whether the change makes existing guidance wrong. Apply the [documentation rules](#documentation) before adding anything.

## Running it

- `pnpm install`, then `pnpm dev`. On Ubuntu, use the `--noSandbox` command in the README.
- The **harness** (`pnpm --filter @repo/desktop harness`) runs the real renderer over `store/fake-api.ts` in a browser. It needs no Electron, Docker or VPN, and it's the default way to work on the window. Pick a situation with the URL hash: `#first`, `#daily`, `#overlap`, `#shared`, `#broke`.
- Stop what you started, by the PID you tracked.

## Verifying

- Smallest proof that the change works: `pnpm vitest run <files>` for the tests you touched, then `pnpm typecheck` and `pnpm lint`. The full suite is fast; run `pnpm test` before handing work back.
- Test decisions, not wiring. Logic lives in plain `.ts` files with a `.test.ts` beside them. Prefer real inputs to mocks. Don't render components just to assert props.
- Tests never touch the real config, real Docker or the real helper.
- Lint warnings about size are a guideline. Lint errors are not; fix them, or disable one line with a reason on the line above.
- Don't verify in a browser, a real Electron window or a real VPN unless the developer agrees. Say what you verified and what you couldn't, such as a real gateway or another OS.

## Pull requests

- Never make a PR or commit unless the developer asks.
- Branches are `<github-login>/<short-kebab-slug>` for the developer you work for (`gh api user --jq .login`). If you start on a branch named any other way, rename it with `git branch -m` before the first push.
- Conventional commit titles in plain language that say what changed for the user, e.g. `fix(desktop): connecting from a VPN's page no longer leaves unsaved changes behind`. PRs are squash-merged, so the title is the commit on `main`.
- Body, in this order, and nothing else:
  1. `Closes #N` when it resolves an issue. If the branch doesn't name one, look for it with `gh issue list --search`.
  2. The problem, as the user meets it, in a sentence or two.
  3. What the change does: at most five short lines, one per thing a user or reviewer will notice; fold the rest into those or drop it. Name code only where a reviewer needs it to find their way, such as a new entry point or the existing code it reuses; file names, exit codes and other internals stay in the diff.
  4. What the user now sees: before/after images of the window, uploaded to GitHub and never committed, or terminal output in a code block, cut to the first screen the user sees, such as a prompt; what happens after they answer is already in the list. If you can't run it, write the output from the strings in the code; never leave a placeholder.
  5. Where it departs from what the issue asked: what the issue asked, what the change does instead, and the fact that forced it, in a sentence. A choice the issue left open isn't a departure.
  6. The model and harness that did the work.
- A reviewer reads it on a clock. Leave out what the title, the diff or CI already say: test and verification sections, file lists, README, help text and doc updates, what didn't change, guards only developers or scripts hit, and how each OS gets to the same result. No headings or bold labels; a body that needs them is too long.
- State only what you know. You know what you ran; you don't know what others tested, so never write "not tested". When the body needs a fact you don't have, such as why something departs from the issue, ask the developer instead of guessing or leaving a placeholder.
- Plain words with one meaning. Reread each line as someone who hasn't seen the code; if a word can be read as its opposite, such as "keeps" for something deleted along with its folder, rephrase it.
- Describe only what the diff changes, not everything done in the session; settings changed elsewhere or work on other branches don't belong.
- Open a real PR, not a draft.
- One request is one PR. Split only when the maintainer asks.

## Documentation

Most code changes need no documentation change. Agents can read the code, and they take every doc as truth.

- `docs/` holds only what the code can't say: rules for writing code here, constraints that span packages, facts about systems outside this repo (VPN servers, Docker Desktop, OS networking), and how to run things. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the code answers it, leave it out.
- Never describe what the code does. That rules out feature specs, screen walkthroughs, field lists, control-flow narration, test inventories and known-gap lists. Code and tests are the record; gaps are GitHub issues.
- Describe the target state. When a rule changes, rewrite or delete the text; no "previously" or PR summaries.
- The README says what the app does, how to start it and how to check a change. Rules for writing code go in `docs/`.

## Comments

- A comment carries the why the code can't: a constraint, a trap, an external fact (what a VPN server sends, what an OS does). Keep it to one to three sentences, mostly above functions and types. If the name and types already say it, don't write one.
- Reference only what an agent can open, such as paths and docs in this repo.
- No history: no incident stories, migration notes, or "used to".
- Comments move with the code and change with it.

## Plans and work artifacts

- Don't commit implementation plans, research notes or agent scratch files. Keep working material outside the worktree.
- A merged PR is the implementation record. Don't keep a second checklist in the repo.

## Where code lives

Each package runs in one kind of process. Folders, layers and file patterns are in [docs/code-structure.md](docs/code-structure.md), and `pnpm lint` enforces the import rules.

- `packages/core`: config schema, route compiler, types. The main entry also runs in the renderer.
- `packages/engine`: containers, the connection manager, talking to the helper. Main process only, except `@repo/engine/uninstall`.
- `packages/vpns`: every VPN kind, one folder each, written against `packages/vpn-sdk`. A kind's files split by process.
- `packages/ui`: the window's design kit.
- `packages/helper`, `packages/card-bridge`: standalone binaries, built with bun.
- `packages/release`: what a release is (archives, checksums, the versions folder) and how one is downloaded and unpacked. The launcher and the app's updater share it.
- `apps/desktop`: Electron main, preload and renderer.
- `apps/launcher`: the `npx multi-vpn-client` command, published to npm. It starts the newest version already unpacked, the app's own updates included; otherwise it downloads the release archive `apps/desktop/electron-builder.yml` builds for the machine, checks it against the checksums it was published with, and starts that. `triage` starts the user's coding agent with `.github/triage/PLAYBOOK.md`; keep the playbook's paths and rules true when the code they name changes. `uninstall` removes everything the app and the launcher put on the machine, so a new place the app writes to needs a step there.

## Taste

- Complexity belongs at the edges: containers, the helper, OS calls. Routing decisions stay pure functions in `core`, and the UI stays dumb.
- Global state is a last resort. The renderer store holds only what several screens share, or what async work changes after a screen is gone. Everything else is local to the component that owns it.
- Logic in `.ts`, markup in `.tsx`. A component file renders.
- Inferred types over annotations. `any` is the enemy. Plain TypeScript; no Effect.
- The window is small and always open. No continuously repainting animations, and nothing re-renders every second that doesn't have to.
- User-facing wording is plain and says what happens. Shared wording lives in `renderer/src/domain/`, or in `store/vpn-status.ts` when it reads app state, so every screen says the same thing.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.
