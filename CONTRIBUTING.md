# Contributing to LoomTable Obsidian Plugin

## Trunk-based workflow

Read [Git workflow](docs/agent-ops/git-workflow.md) before branching, committing, reviewing, merging, releasing, changing CI, or cleaning up. It owns branch names, author identity, Issue/PR selection, squash-merge defaults, tags/releases, notifications, and safe cleanup.

Only `main` is long-lived. Use short-lived `feat/`, `fix/`, `refactor/`, `docs/`, `test/`, or `chore/` task branches. Existing historical names remain exceptions until their active PRs and worktrees are retired. CI and product changes require a PR; validated tiny documentation or behavior-preserving maintenance may go directly to main when repository rules permit.

## Commit and repository hygiene

- Inspect `git status`, ignored files, and the complete diff before staging.
- Stage only files that belong to the change; do not use a blanket add when unrelated work exists.
- Commit source, tests, maintained documentation, `pnpm-lock.yaml`, the pinned OpenAPI snapshot, and its generated transport types when they intentionally change.
- Do not commit dependencies, local package stores, bundles, caches, logs, editor state, test Vaults, `.env` files, or Obsidian `data.json`.
- Never put access tokens, SecretStorage values, personal Server URLs, Vault data, or record contents in commits, fixtures, logs, screenshots, or PR descriptions.
- Update the pinned Server contract only through the explicit `pnpm api:sync <commit-sha>` workflow. Normal builds must remain independent of the Server repository and the network.

For runtime, configuration, dependency, CI, or unknown-path changes, run before opening or updating a pull request:

```text
pnpm install --frozen-lockfile
pnpm check
git diff --check
```

For documentation-only work, use the applicable validation in the Git workflow. Review the resulting file list and diff for generated or temporary artifacts before publishing.
