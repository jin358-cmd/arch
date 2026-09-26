# Draft → Formal Project Lifecycle

## Identity classes

| Class | ID namespace | Production identity | Cloud sync | Membership |
|---|---|---:|---:|---:|
| Draft | `draft-{UUID}` | No | No formal sync | None |
| Template | `template-{UUID}` | No | Template catalog only | None |
| Legacy local | `project-{timestamp}-{random}` / `legacy-project` | No new usage | Compatibility read only | None until explicit mapping |
| Formal canonical | UUID | Yes | Yes | Exactly one matching OWNER |
| Test | approved test/Atlas fixture IDs | No | Never | Never |

The known `project-1790371979975-ne4klf` 未命名專案 remains TEST/TEMPLATE and is not renamed, deleted or promoted.

## Lifecycle

1. An unauthenticated user creates a Draft with a namespaced local ID.
2. Draft edits remain local and never create a Production row or membership.
3. The user authenticates and explicitly selects “建立正式專案”.
4. The system revalidates NFC + trimmed name and the 200-character limit.
5. The server resolves the authenticated user and accepts one stable promotion key.
6. A canonical UUID is reserved for that promotion attempt.
7. Project, `owner_user_id`, and the matching unique OWNER membership are created atomically.
8. Draft data is imported using the canonical writer and validated by counts/checksums/orphans.
9. Only after validation does the Draft become PROMOTED and record `promotedProjectId`; its `draftId` remains unchanged.

## Promotion state and idempotency

Draft states are DRAFT, PROMOTING, PROMOTION_FAILED and PROMOTED. PROMOTING/PROMOTION_FAILED are Draft lifecycle states, not Formal Project statuses; Formal Project remains ACTIVE or ARCHIVED.

The tuple `(draftId, promotionKey)` identifies one promotion attempt. Replaying the same key returns the same reserved canonical UUID/result. A different key against an active or completed promotion is rejected. Partial creation must be transactional or compensatable; failure leaves the Draft retryable and never marks it PROMOTED. Completion requires matching project ID, authenticated owner, and exactly one matching OWNER membership.

## Duplicate names and display contract

Two Formal Projects may have the same normalized name and remain distinct by UUID. A display label consists of the name plus optional display code, location/address, client/owner display name, year and status. None of these fields changes authorization or identity.

## FUTURE UI DECISIONS

- Whether Project Display Code is generated automatically.
- Display Code format.
- Whether Address is required.
- Project card layout, color, ordering and visual style.

These decisions do not block the lifecycle or domain contract.

## Migration requirements

The future migration is additive, UUID-first, membership-aware, non-destructive and legacy-compatible. It must not add a global unique constraint on Project Name or alter/drop existing workflow text IDs. The migration file remains **NOT CREATED** until an approved Supabase CLI environment generates its filename.
