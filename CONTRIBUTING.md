# Contributing to LoomTable Obsidian Plugin

## GitHub Flow

All work starts from the current `main` branch and is delivered through a focused pull request. Use a short, kebab-case branch name with one of these purpose prefixes:

- `feature/` for user-facing capability
- `fix/` for defects
- `docs/` for documentation-only work
- `refactor/` for behavior-preserving restructuring
- `test/` for test-only work
- `chore/` for maintenance and dependency work
- `ci/` for automation changes

Examples: `feature/http-meta-connection`, `fix/map-cluster-refresh`, and `docs/tile-provider-guide`.

Do not use personal, tool, or automation prefixes such as `agent/`. Keep each branch single-purpose, keep it short-lived, squash-merge it after required checks pass, and remove the remote branch after merge.

## Commit and repository hygiene

- Inspect `git status`, ignored files, and the complete diff before staging.
- Stage only files that belong to the change; do not use a blanket add when unrelated work exists.
- Commit source, tests, maintained documentation, `pnpm-lock.yaml`, the pinned OpenAPI snapshot, and its generated transport types when they intentionally change.
- Do not commit dependencies, local package stores, bundles, caches, logs, editor state, test Vaults, `.env` files, or Obsidian `data.json`.
- Never put access tokens, SecretStorage values, personal Server URLs, Vault data, or record contents in commits, fixtures, logs, screenshots, or PR descriptions.
- Update the pinned Server contract only through the explicit `pnpm api:sync <commit-sha>` workflow. Normal builds must remain independent of the Server repository and the network.

Before opening or updating a pull request, run:

```text
pnpm install --frozen-lockfile
pnpm check
git diff --check
```

Review the resulting file list and diff for generated or temporary artifacts before publishing.
