# Plugin Repository Layout

The repository root intentionally contains both Obsidian package files and
development-tool configuration. These files are not interchangeable with
runtime source files, so they stay at the root where Obsidian, GitHub Actions,
pnpm, and the JavaScript tooling discover them by convention.

## Root files

| Path | Purpose | Keep? |
| --- | --- | --- |
| `manifest.json` | Obsidian plugin identity and compatibility metadata. | Required at the Plugin root. |
| `styles.css` | Obsidian plugin styles loaded from the package root. | Required at the Plugin root. |
| `versions.json` | Obsidian release compatibility mapping. | Required for release compatibility. |
| `package.json` | Scripts, package-manager pin, and development dependencies. | Required at the package root. |
| `pnpm-lock.yaml` | Reproducible dependency resolution. | Keep tracked and update intentionally. |
| `pnpm-workspace.yaml` | Allows pnpm to approve the `esbuild` install build script and scopes the pnpm store to `.pnpm-store/`. | Keep; it is not redundant despite this being a single package. |
| `tsconfig.json` | TypeScript project configuration. | Keep at the package root. |
| `vitest.config.ts` | Test-runner configuration discovered by Vitest. | Keep at the package root. |
| `esbuild.config.mjs` | Production and development bundle entry point referenced by `package.json`. | Keep at the package root. |
| `eslint.config.mts` | ESLint flat configuration discovered from the package root. | Keep at the package root. |
| `.editorconfig` | Cross-editor formatting defaults. | Keep. |
| `.prettierrc.json` / `.prettierignore` | Formatting configuration and generated-file exclusions. | Keep. |
| `.gitignore` | Excludes local caches, build output, vault state, and editor files. | Keep. |
| `CONTRIBUTING.md` | Contribution and GitHub Flow rules. | Keep. |
| `LICENSE` / `README.md` | Project legal terms and entry-point documentation. | Keep. |

The `.github/` directory stays at the root because GitHub only discovers
Actions workflows under `.github/workflows/`. The `src/`, `tests/`, `docs/`,
`scripts/`, and `openapi/` directories are responsibility-oriented source,
test, documentation, automation, and API-contract trees respectively.

`openapi/loomtable-server.openapi.yaml` and `openapi/source.json` are both
intentional: the first is the checked-in contract snapshot used to generate
transport types, and the second records the exact Server commit that produced
that snapshot. Moving either file would require changing the package scripts
and the documented contract workflow without reducing repository complexity.

## Local-only files

The following are generated or machine-local and must not be committed:

- `node_modules/`
- `.pnpm-store/` and `.corepack-cache/`
- `main.js`, `main.js.map`, `dist/`, `build/`, and TypeScript build info
- local Obsidian vault state such as `.obsidian/`, `.trash/`, and `data.json`
- editor, operating-system, coverage, and test-vault metadata

The pnpm store is now scoped to this Plugin checkout by `pnpm-workspace.yaml`. It remains a
cache: deleting it only causes pnpm to download dependencies again, and its
contents are deliberately absent from GitHub.
