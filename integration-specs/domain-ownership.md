# Domain Ownership Matrix

`Normalized` 表示未來 canonical relational store；`Workflow JSON` 表示既有施工狀態 store。Read model 可投影資料，但不是 writer。

| Domain | Canonical Store | Canonical Writer | Read Model | Legacy Source | Migration Strategy |
|---|---|---|---|---|---|
| Project | Normalized | Project Domain Service | Project Context | `workflow_projects`, Atlas project | UUID mapping、shadow read、cutover |
| Membership | Normalized | Membership Service | Project Context/ACL | owner `user_id`, Atlas membership | owner backfill、policy shadow test |
| Phase | Normalized identity | Project Structure Service | Construction tree | Workflow JSON/Atlas phase | preserve legacy key, map UUID |
| Section | Normalized identity | Project Structure Service | Construction tree | Workflow JSON/Atlas section | parent-aware mapping |
| Task | Workflow JSON | Construction Workflow Service | Task projection | Workflow state | retain JSON until schema stabilizes |
| Gantt | Workflow JSON | Scheduling Service | Gantt projection | Workflow state/Atlas plan | versioned import, no dual write |
| Progress | Workflow JSON | Progress Service | Progress projection | Workflow state | event bridge then writer cutover |
| Risk | Workflow JSON | Risk Service | Risk register projection | Workflow state/Atlas risk | reconcile IDs, single writer cutover |
| Meeting | Normalized | Meeting Service | Meeting view | Workflow JSON/Atlas meeting | map project/entity IDs, checksum |
| Document | Normalized | Document Service | Search/document view | Atlas/legacy documents | metadata import and version baseline |
| DocumentVersion | Normalized | Document Service | Version history | file snapshots | immutable ordered import |
| File | Normalized metadata + Storage binary | File Service | File metadata | meeting attachment rows/Storage | checksum-led dedupe and copy verify |
| Attachment | Normalized | Attachment Service | Entity attachment view | meeting-specific links | translate to polymorphic relation |
| Notification | Normalized | Notification Service | Inbox | Atlas/legacy events | event replay with dedupe key |
| AIJob | Normalized | AI Orchestration Service | Job status | provider logs | register only future/approved jobs |
| AIReview | Normalized | AI Review Service | Review queue | Atlas review data | preserve provenance and status |
| AIResult | Normalized/immutable object reference | AI Orchestration Service | Result view | provider output | hash, provenance, immutable import |
| Approval | Normalized | Approval Service | Approval timeline | Atlas decisions/manual records | explicit actor/time/policy mapping |

## Enforcement rules

- 每列只能有一個 active canonical writer；bridge、gateway、read model 與 external agent 均不是第二 writer。
- 禁止 dual master、silent overwrite，以及 canonical stores 之間的 last-write-wins。
- 切換必須使用版本、idempotency key、expected-version/compare-and-swap 與 audit event；衝突進 quarantine，不自動覆蓋。
- normalized identity 可被 JSON 引用，JSON 不得重新定義 canonical Project/Phase/Section identity。
- 若實作盤點顯示 domain 無法依本表唯一歸屬，停止並標記 **DECISION REQUIRED**。
