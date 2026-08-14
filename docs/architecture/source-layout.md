# Plugin Source Layout

The Plugin keeps protocol knowledge behind a small client interface so UI modules do not learn HTTP details.

```text
src/
├── client/
│   ├── loomtable-client.ts          Domain interface and connection result types
│   ├── http-transport.ts            Internal JSON/binary transport seam used by tests and adapters
│   ├── http-loomtable-client.ts     HTTP, decoding, retry, auth, and compatibility logic
│   ├── obsidian-http-transport.ts   The only production adapter that calls requestUrl
│   └── server-origin.ts             Shared HTTPS and loopback-origin safety rules
├── credentials/                     Session and SecretStorage credential policy
├── generated/                       Checked-in OpenAPI transport types; never hand-edit
├── settings/                        Persisted profiles and the settings UI
├── cache/                           Bounded local cache policy
├── i18n/                            Type-safe user-facing text
├── ui/                              Obsidian views, Grid Controller, and renderers
└── main.ts                          Plugin composition root and lifecycle
```

## Dependency rules

- Settings and view modules consume domain results from `client/loomtable-client.ts`; they do not parse HTTP responses.
- Only `http-loomtable-client.ts` may depend on `generated/transport.ts`.
- Only `obsidian-http-transport.ts` may invoke Obsidian `requestUrl`.
- Credentials are supplied at the composition root. Client and UI modules never persist tokens.
- Generated transport types do not cross into Grid, Map, settings, or other UI interfaces.
- A connection check uses public `/v1/meta` for reachability and compatibility, then an authenticated `/v1/workspaces` read to validate the configured token. It performs no mutation.
- Attachment P1 metadata and content operations stay behind `LoomTableClient`; only the transport seam knows about HTTP methods, JSON request bodies, and binary response buffers.
- `grid-view-controller.ts` owns Workspace → Base → Table → Grid View selection, query pages, cursor transitions, and UI-facing status mapping. `readonly-grid-renderer.ts` owns native DOM layout and fixed-row-height virtualization; neither module depends on generated OpenAPI types.

New source directories should represent a durable responsibility or seam, not a single call site. Keep tests under `tests/` with the same responsibility-oriented layout.
