---
name: version-bump
description: Proposes the version bump (patch, minor or major) for the next release of Multi VPN Client by reading everything merged since the last release, and explains why. Use before a release, or when asked what the next version should be or whether something is breaking.
---

# Version bump

Propose `patch`, `minor` or `major` for the next release, with the reasons. The developer makes the final call. Only read: don't start a release, create tags or change files.

## 1. Find what's unreleased

1. `git fetch origin --tags`.
2. The last release is `version` in `apps/desktop/package.json` on `origin/main`, tagged `v<version>`. If that tag doesn't exist, say so and stop.
3. List the merged pull requests: `git log --first-parent --format='%h %s' v<version>..origin/main`. Each commit is one squash-merged pull request. Skip `chore: release …` commits.
4. For each pull request, read its description (`gh pr view <number> --json title,body`) and its diff (`git show <commit>`). Titles can be wrong, so decide from the diff.

## 2. Decide

The user is the person running the app, through `npx multi-vpn-client` or a downloaded archive. Put each pull request in one group:

- **Breaking:** something the user relied on stops working, or they have to act. For example:
  - a config written by an older version no longer loads or loses settings (`packages/core/src/config.ts`, `store.ts`)
  - a VPN kind, OS or architecture is no longer supported (`packages/vpns/src/integrations/`, `apps/desktop/electron-builder.yml`)
  - a launcher command or option is removed or renamed (`apps/launcher/src/main.ts`)
  - the required Node or Docker version goes up (`engines` in `apps/launcher/scripts/pack.ts`, the README)
  - an installed older version can no longer update to this one, or the launcher can't start it (`packages/release`)
  - the user must reinstall or reconfigure something by hand
- **Feature:** the user can do something new: a VPN kind, a command, a setting, a screen.
- **Fix:** anything else the user gets: bug fixes, wording, speed, dependency updates. A raised `HELPER_VERSION` (`packages/core/src/helper-protocol.ts`) counts here, because the app asks the user to update the helper in one step; say so in the reasons.
- **Nothing for users:** docs, CI, tests, refactors that change no behavior.

The biggest group wins:

| Biggest group | Version below 1.0.0 | Version 1.0.0 or above |
|---|---|---|
| Breaking | minor | major |
| Feature | minor | minor |
| Fix | patch | patch |
| Nothing for users | no release needed | no release needed |

Never propose 1.0.0 on your own; that's the developer's decision. When a pull request could be in two groups, pick the bigger one and list it under "Unsure".

## 3. Answer

Keep it to this shape, with the version that results:

```
Proposed: minor → 0.3.0

- #21 feat(desktop): … — feature: a new setting for …
- #22 fix(launcher): … — fix
- #23, #24 docs, ci — nothing for users

Unsure: #22 also raises HELPER_VERSION; counted as a fix
```

Link each pull request. Give one reason per line, in plain words.
