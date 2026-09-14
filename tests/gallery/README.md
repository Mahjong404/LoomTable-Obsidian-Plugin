# Development Gallery

A development-only DOM gallery for the LoomTable plugin. Every scenario mounts
real production components — `ReadonlyGridRenderer`, `TableShell`,
`FilterBuilder`, `SortPanel`, `DisplayPanel`, `RecordDetail`,
`RecordCreateForm`, `MapView`/`MapViewController`, and the durable
`MutationQueueRuntime` — backed by `InMemoryLoomTableClient` and typed fakes
for host-only capabilities (map renderer, tile credentials).

Nothing in this directory is part of the production plugin: the bundle is
built separately and gitignored, `src/main.ts` never imports these modules,
and no fixtures, test buttons, or credentials ship in `main.js`.

## Run it

```text
pnpm gallery
```

This produces `tests/gallery/bundle.js`. Then open `tests/gallery/index.html`
in a browser (any static file server or a direct `file://` open works; the
page links `../../styles.css` and loads `./bundle.js`).

The sidebar lists scenarios grouped by section; each mounts into the main
host. `index.html` contains no Obsidian theme variables, so every `--loom-*`
token exercises its documented fallback. The Layout section includes a
dark-token container and width-constrained frames to exercise the media-query
breakpoints manually.

## Automated coverage

`tests/gallery/gallery.test.ts` mounts every scenario in jsdom and asserts
DOM semantics, roles, and user-visible state — including a live edit/create/
delete/restore round-trip through the real `GridViewController` +
`MutationQueueScheduler` + `InMemoryLoomTableClient`. It runs as part of
`pnpm test:run` and `pnpm check`; it makes no real-pixel or desktop claims.
