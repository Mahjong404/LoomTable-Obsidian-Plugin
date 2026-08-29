# LoomTable Obsidian Plugin Development Log

This is a remote-evidence log for the Plugin repository. It records published checkpoints and does not contain credentials, tokens, real provider keys, or user data.

## Contract boundary

- Historical Plugin checkpoint before the closeout slice: `7bcef66aebfc3548d4d446cb8e7113c968f71cd2`, merged by [PR #55](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/55).
- Historical S0 audit baseline Plugin main was `84fae88ab185598210fe35fd2a18de58d6c5d3ce`, merged by [PR #59](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/59); PR CI [33264976726](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33264976726) and main push CI [33265049273](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33265049273) succeeded.
- Current Plugin main at the start of this follow-up is `d0de22d48cef366140fa63a33311ec0fcb723117`, merged by [PR #60](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/60); PR head `d8dd31a3604564c4f19d3652bed8a321f0774883`, PR CI [33270680100](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33270680100), and main push CI [33270747679](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33270747679) all completed successfully.
- Current Server docs/main is `ab949d59c37680d53b4109e1502f8478b24cc655`; the Server runtime/API freeze remains `e02f055fecddc0852085dc5a71b4eb136860774a`.
- Plugin OpenAPI source remains `ef0c6bd751642f4a604fe1bf88980f64e39dd992`.
- The checked-in OpenAPI snapshot and generated transport are validated by `pnpm api:check`; this documentation-only correction does not modify Server, OpenAPI, or generated transport files.

## Published stages

| Stage | Merged PRs and merge SHA | Remote CI evidence |
|---|---|---|
| P0 engineering baseline | [PR #2](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/2) → `6701a7986f425f09fab3ce483f7d038174d1bae7` | PR CI [31634547664](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/31634547664) passed the baseline `pnpm check`. |
| P1 contract/Attachment and read-only Grid | [PR #6](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/6) → `65622e95b64d9c6a738c3e4f83a2d4ecf8c14aa0`; [PR #7](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/7) → `b02830badc17618878b8f9601bd8d8cb2520b93a` | PR #6 CI [31772956310](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/31772956310) and PR #7 CI [31785927308](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/31785927308) passed. |
| P1 Location/Map lifecycle | [PR #29](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/29) → `992f2f46410dd45d8a80158770055aceacb62572` | PR CI [32909390981](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/32909390981) passed. |
| P1.5 queue persistence, scheduler, runtime | [PR #34](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/34) → `25bee1c8d6d55260ed90280c34f3815be22a3bdf`; [PR #45](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/45) → `c4d90c063b518698d42d6a5aec57843a5db76fb0`; [PR #47](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/47) → `0754c7f75891c59b3992b10868af828108fe1ef0` | PR CI [33017617572](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33017617572), [33075674257](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33075674257), and [33099816369](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33099816369) passed. Offline remains read-only; no offline mutation is created. |
| P1.5 HIG/accessibility, theme, Conflict, Map invalidation | [PR #38](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/38) → `398011c79c1d1823236733945fc835f3b7cb09cc`; [PR #43](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/43) → `a7ed22c3dc3694cb90c8f8b8e02548d48b589492`; [PR #51](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/51) → `fffd9b30c3493204fc2252af1a3521b90a11a474`; [PR #52](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/52) → `9b4855e8943f98245dbf111247636e498b320ca8` | PR CI [33022901843](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33022901843), [33025011868](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33025011868), [33117519504](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33117519504), and [33119954559](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33119954559) passed. Main push CI [33120060264](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33120060264) passed for the Map invalidation merge. |
| Map Chinese chrome and HIG remediation docs | [PR #54](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/54) → `d3469e7e133ad4a1854833be4912de93953e8e2e`; [PR #55](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/55) → `7bcef66aebfc3548d4d446cb8e7113c968f71cd2` | Main push CI [33168842872](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33168842872) and PR #55 CI [33236744137](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33236744137) passed. |

## Closeout merge evidence

- [PR #56](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/56) merged to main as `03dab67835155e422aeb12a97a5c467d701503ab`. PR CI [33260706290](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33260706290) and main CI [33260804613](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33260804613) completed successfully.
- [PR #57](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/57) merged to main as `d8aa9646876ffae4e0d62a3def3138e0c41cb3a6`. PR CI [33263420992](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33263420992) and main CI [33263498894](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33263498894) completed successfully. The slice records dangerous-operation confirmation, the Location Map guard, and editor focus recovery with IME/saving behavior.
- [PR #58](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/58) merged to main as `f3201aabf1701c99efc5f3c7133075dfcbab3a17`. PR CI [33264526404](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33264526404) and main CI [33264590407](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33264590407) completed successfully. The slice hardens Map `fitAll` and Cluster async response protection.
- [PR #59](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/59) merged to main as `84fae88ab185598210fe35fd2a18de58d6c5d3ce`. PR CI [33264976726](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33264976726) and main push CI [33265049273](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33265049273) completed successfully; it corrected the development-log evidence.
- [PR #60](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/60) merged to main as `d0de22d48cef366140fa63a33311ec0fcb723117` from PR head `d8dd31a3604564c4f19d3652bed8a321f0774883`. PR CI [33270680100](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33270680100) and main push CI [33270747679](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33270747679) completed successfully; it was docs-only and changed `docs/development-log.md` and `docs/ui/interaction-hig-audit.md`.

## This closeout slice

- [PR #56](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/56) added stable `FIELD_VALUE_*` domain error codes for every field/Location validation failure in `src/ui/field-value-editor.ts`.
- English and Simplified Chinese diagnostics were cataloged and translated through the existing translator; Grid Controller and Record Detail pass the translator through the existing seams. Regression tests assert code stability, catalog parity, and localized output.
- [PR #57](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/57) added the approved dangerous-operation confirmations, Location Map configuration guard, and editor focus/IME/saving behavior.
- [PR #58](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/pull/58) added Map `fitAll` and terminal Cluster pagination protection against out-of-order responses and callbacks after View disposal.
- The HIG audit records the published main, Map Chinese status, durable queue/runtime status, CI evidence, and the unverified desktop smoke boundary.
- PR #56 introduced this development log because the repository had release notes but no development log. No credentials are written.

## P1.5 Map async request stability

- Scope: harden Map `fitAll` and terminal Cluster pagination against out-of-order responses and callbacks that arrive after the View is disposed. No Dashboard, CRUD, Filter/Sort, tile/provider, Server, API, OpenAPI, or new offline semantics are included.
- Design: `fitAll` uses a dedicated request sequence; Cluster pages use a response sequence plus the existing Map query epoch. Only the newest live request may publish summary, camera, items, opaque cursor, change cursor, or callbacks. Cursor values remain server-owned and are never decoded or reconstructed locally.
- Regression evidence: added minimal controller tests for fitAll out-of-order and dispose-late responses, Cluster page out-of-order responses, opaque cursor non-regression, and dispose-late responses.
- Delivery status: merged to Plugin main `f3201aabf1701c99efc5f3c7133075dfcbab3a17` via PR #58 after the complete `pnpm check` passed; PR CI [33264526404](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33264526404) and main CI [33264590407](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33264590407) both succeeded.

## 2026-08-30 S0 audit evidence correction (current-main follow-up)

- Scope: record that PR #59's `84fae88ab185598210fe35fd2a18de58d6c5d3ce` was the historical S0 audit baseline and that the connector-verified current Plugin `main` at the start of this follow-up is PR #60's `d0de22d48cef366140fa63a33311ec0fcb723117`; retain the historical PR #56–#59 evidence and add the current-main PR #60 evidence.
- PR #60 was a docs-only S0 correction and changed only `docs/ui/interaction-hig-audit.md` and `docs/development-log.md`; its PR CI [33270680100](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33270680100) and main push CI [33270747679](https://github.com/Mahjong404/LoomTable-Obsidian-Plugin/actions/runs/33270747679) completed successfully.
- The smoke matrix marks Grid/Detail/Map navigation, Location set/clear/unset, Save Status, Conflict/Authentication/Forbidden/Offline, Map marker/cluster/provider/tile, and light/dark/narrow layout as `unverified`: **未验收/环境阻塞** because this session has no reliable controlled Computer Use/Obsidian evidence. Static/jsdom/controller/CI evidence is not desktop acceptance.
- This current-main follow-up changes only `docs/ui/interaction-hig-audit.md` and `docs/development-log.md`; it does not change Server, API, OpenAPI, Plugin runtime, offline semantics, or any UI behavior. No credentials, tokens, provider keys, or user data are recorded.
- The follow-up delivery PR/CI/merge/main evidence is reported only after the GitHub connector verifies it; no SHA is inferred.

## Remaining work

- Real Obsidian desktop/View smoke remains unverified — 未验收/环境阻塞 — including OSM/tile live behavior and end-to-end Grid/Detail/Map/Location/mutation focus behavior.
- Follow-up cross-repository integration of the current Plugin main with the current Server docs/main remains to be completed; this documentation-only correction does not change Server, API, or OpenAPI.
