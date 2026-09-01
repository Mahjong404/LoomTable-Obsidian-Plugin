# Attachment resource lifecycle decision record

- Status: design closed; resource-level implementation deferred
- Date: 2026-09-01
- Scope: Plugin S3-C3-C3 documentation decision only
- Current Plugin main at review: `4d6f79781ad0da5a679c8e76a737f74724302f8a`

> This record separates a Record Attachment reference from the Attachment resource it points to. It does not publish a new API, change an existing wire type, authorize a Server change, or claim that resource deletion is currently available in the Plugin.

## Decision

The current Plugin supports the safe subset delivered in S3-C3-C2: a confirmed Record Detach through the existing `records/mutate` UpdateRecord path, plus bounded user-directed retry for the Add/Upload/reference flow. It does not perform resource-level delete, restore, undo, physical cleanup, orphan recovery, or a combined detach-and-delete operation.

The published Server `DELETE /v1/attachments/{attachmentId}?expectedRevision=...` operation is a resource soft-delete operation. It is not the Record Detach operation and must not be used as a shortcut for removing an AttachmentRef from a Record. The Plugin must not infer ownership or shared-reference safety from an Attachment ID or from the presence of one Record reference.

## Terms and current meaning

| Term | Meaning | Current Plugin action |
|---|---|---|
| Attachment Resource | The server-side managed or vault-backed attachment object, with its lifecycle/status and metadata. | Render metadata and use only the published content/client seams; no resource deletion in this decision. |
| Attachment Reference | The `AttachmentRef` value stored in a Record Attachment Field and pointing to a resource ID/source. It is a binding, not proof of exclusive ownership. | Read, render, add, and remove through the existing Record mutation path. |
| Detach | Remove one selected AttachmentRef from the current Record while preserving sibling references. The final reference is represented by `set: []`. | Delivered and confirmed in S3-C3-C2; never calls resource delete. |
| Resource Delete | Request the server soft-delete lifecycle for an Attachment Resource through the published resource operation. | Deferred; not used for Detach and not exposed as a current Plugin action. |
| Restore | Make a soft-deleted Attachment Resource usable again. | No current published restore contract; deferred. |
| GC / physical cleanup | Permanently remove or reclaim an unreferenced resource after retention and backup rules. | No current reference-count, reverse-reference, retention, or cleanup contract; deferred. |

## Evidence → Finding → Path

### Evidence

- The Plugin current-main ref is `4d6f79781ad0da5a679c8e76a737f74724302f8a`, including the S3-C3-C2 documentation closeout.
- S3-C3-C2 code was merged by PR #100 from head `634862e8e1aa7149cf508a27ab05976e7c7f799d` to `748775a31e431f8e1a04e6aebf7921a41d147b98`; its PR and main push checks passed.
- The current safe behavior uses existing Record mutation, Attachment lookup, and content/client seams. The current contract does not provide reference counts, reverse-reference lookup, ownership/share rules, restore, orphan lookup, or garbage-collection operations.
- The Plugin consumes Server runtime/API stable-support freeze `e02f055fecddc0852085dc5a71b4eb136860774a` and OpenAPI source `ef0c6bd751642f4a604fe1bf88980f64e39dd992`; neither is changed by this record.

### Finding

A Record Detach is safe to define because its scope is one known Record Field mutation. A resource Delete is not safe to expose from the Plugin without knowing whether other Records share the resource, who owns it, which lifecycle states are recoverable, and how failures are audited and retried. Calling the current resource DELETE after Detach could delete data still referenced elsewhere or create an unrecoverable partial operation.

### Path

S3-C3-C3 is therefore closed as a design decision and deferred for implementation. The next resource-level work must first publish and verify the minimum Server/OpenAPI contract below, then implement the ordered Plugin gates. S4, S5, and S6 are not started by this record.

## Minimum future Server/OpenAPI contract

The following are requirements for a future resource lifecycle proposal, not current Plugin or Server behavior.

| Requirement | Classification | Minimum evidence/behavior |
|---|---|---|
| Reference impact | MUST | A server-side atomic precondition or reverse-reference query that identifies all current Record/Field references before resource deletion. |
| Ownership and sharing | MUST | Explicit owner/share semantics, including whether a resource may be deleted while references from other Records or actors remain. |
| Lifecycle and revision | MUST | Documented pending/ready/soft-deleted/restorable/terminal states, `expectedRevision` rules for delete/restore, and deterministic 404/403/409/terminal responses. |
| Atomicity boundary | MUST | A documented safe ordering or server-side atomic operation for detach plus resource deletion; the client must not pretend two independent requests are one transaction. |
| Idempotency and audit | MUST | Idempotency behavior for destructive/recovery commands, request correlation, actor/time audit, and a way to distinguish applied, unchanged, and unknown outcomes. |
| Retention and backup safety | MUST | Retention window, backup/restore guarantees, legal or operational holds, and an explicit point after which physical cleanup is irreversible. |
| Cleanup execution and retry | MUST | Observable cleanup job/status, bounded retry semantics, terminal failure handling, and no blind recreation or repeated delete on unknown outcomes. |
| Impact preview payload | SHOULD | A bounded, non-sensitive preview of affected references and consequences before confirmation. |
| Batch lifecycle | OPTIONAL | Batch detach/delete/restore only if its atomicity, authorization, limits, and partial-result semantics are separately defined. |
| User Undo affordance | OPTIONAL | A time-bounded UI Undo only after the server restore/retention contract exists; it is not a client promise of recovery. |

Until the MUST rows are published and verified, `deleteAttachment` remains a resource-level client capability that is not a Record Detach implementation. No Plugin change in this slice consumes it.

## Future Plugin order and gates

1. **Detach** — remove only the selected Record reference through the existing mutation/Conflict/revision path.
2. **Reference impact query** — obtain server-authoritative shared-reference and ownership information; do not infer it locally.
3. **Explicit confirmation / optional Undo** — show the object, affected references, consequence, and available recovery window. Cancel/Escape is zero-side-effect. Undo is optional and only valid after a published restore contract.
4. **Resource soft-delete** — call the published resource lifecycle operation only after the impact/ownership gate and confirmation; preserve expectedRevision, idempotency, audit, and unknown-outcome readback.
5. **Restore / GC** — restore only through a published server contract; physical cleanup only after retention, backup, ownership, and reverse-reference checks, with observable failure handling.

Shared-reference findings must block or change the user choice; they must never be silently deleted. Permission/authentication/validation/conflict/unknown outcomes stay visible and non-Saved. Offline remains read-only: all detach, upload, save, retry, resource-delete, restore, and GC actions are disabled and make no request.

## Acceptance boundary

- S3-C3-C2 is the delivered safe subset: Record Detach and bounded Retry, not resource lifecycle completion.
- This decision record is documentation-only. It does not modify Server/API/OpenAPI, Attachment wire types, offline semantics, Mutation Queue, Conflict, revision, or changeCursor behavior.
- Current-main real Obsidian smoke remains `UNVERIFIED`; automated checks and prior DOM evidence are not desktop acceptance.
- S3-C3-C3 resource-level implementation is deferred. S4/S5/S6, new fields/views, CRUD, Filter/Sort, and Dashboard remain outside this decision.