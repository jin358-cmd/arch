# Migration Safety Plan

本文件只定義計畫，不授權執行 migration、remote write、搬移資料或部署。

未來 canonical migration 必須為 additive、UUID-first、membership-aware、non-destructive、legacy-compatible，且不得建立 Project Name 全域唯一 constraint。Migration file 在正式 Supabase CLI 環境就緒前維持 **NOT CREATED**；不得手工偽造 timestamp filename。

## Universal stage gate

每一 stage 均須先滿足：前一 stage 已簽核、可還原 snapshot 已實測、schema/policy 版本固定、操作者與維護窗確認。唯讀驗證必須從 legacy 與 candidate 兩側獨立查詢，產出總 row count、按 project/entity 分組 count、stable-order canonical checksum、broken foreign reference/object orphan 清單。rollback condition 或 stop condition 一旦成立，停止 writer/cutover、保留證據、按既定 route/read toggle 回前版；禁止以 silent overwrite、刪除異常列或跨 store last-write-wins「修復」。

| Stage | Scope and preconditions | Read-only verification, count/checksum/orphans | Rollback condition | Stop condition |
|---|---|---|---|---|
| 0 — Backup/snapshot | 定義 RPO/RTO；DB、Storage、Workflow JSON、config 與 commit 均有 snapshot | 清冊、大小、object count、manifest checksum、restore drill；找未入 manifest object | restore drill 失敗或 snapshot 不一致 | 無可驗證 restore、需 Production credential 未核准 |
| 1 — Canonical identity dry-run | Stage 0 通過；來源 system 與 ID 規則固定；**不寫入** | project/user counts、mapping checksum；找 duplicate legacy ID、name-only match、missing owner/orphan refs | mapping 版本回退為未採用草案 | 多對多無法解釋、UUID/owner 不可安全映射 |
| 2 — Membership/Auth staging | identity mapping 可重現；role mapping/policy tests 已審核 | owner/member counts、permission test matrix checksum；找無 owner、多 owner、失效 user | 維持舊 owner-only policy，關閉 staged policy | RLS 無法 fail-closed、權限擴張或 session freshness 不足 |
| 3 — Read-only bridge | membership shadow auth 全通過；bridge 無 write capability | 逐 route compare count/content hash/latency；找 unmapped project/entity | gateway route 回 legacy reader | 任一 bridge 可寫、資料揭露或差異超門檻 |
| 4 — Documents/versions | File/Document/Attachment contract 與 retention 已核准 | document/version/file/object counts、binary SHA-256；找 missing object、dangling version/attachment | 關閉 candidate reads，保留 legacy object | checksum mismatch、附件遺失或 tombstone 語義不明 |
| 5 — Phase/Section identity | parent hierarchy 與 stable key 規則固定 | phase/section/project counts、tree checksum；找 cycle、duplicate、missing parent | 回 Workflow JSON identity lookup | hierarchy 無唯一 mapping 或循環 |
| 6 — Mind Map | Phase/Section IDs 可讀；Atlas adapter read-only | node/edge counts、graph checksum；找 dangling edge、跨 project edge | route 回 Atlas legacy view | graph 語義衝突或錯誤 project scope |
| 7 — Notifications | event/dedupe/consent policy 核准；先 shadow delivery | event/message/recipient counts、payload hash；找 missing recipient/event | 停 candidate delivery、回舊 queue | duplicate、高影響誤送或 consent 不明 |
| 8 — AI Review | AI contract、approval policy、provider scope 核准 | job/result/review/approval/action counts與 chain hash；找斷鏈/未授權 action | disable executor，保留 read-only reviews | AI 可直寫 domain、approval 無法驗證 |
| 9 — Construction event bridge | canonical writers 逐 domain 指定；idempotency/version 可用 | event vs state counts、projection checksum；找 gaps、duplicates、version conflicts | 關 bridge writer，從 snapshot/event 重建 | dual master、silent overwrite 或不可重播 event |
| 10 — Unified navigation | route contract、auth/fallback/mobile 測試完成 | route/deep-link matrix、membership results checksum；找 legacy/dead links | feature flag 回舊導航 | 越權、token/role/state 洩入 URL 或無安全 fallback |
| 11 — Next.js migration | 模組 parity、observability、容量與 rollback 演練通過 | business fixture counts/checksums、E2E parity；找失聯功能/資料 | module-by-module 回 separate deployment | parity、性能、RLS 或 restore 不達門檻 |
| 12 — Legacy retirement | 觀察期完成、zero-read/zero-write 證據、法遵核准 | legacy/canonical final counts/checksums、all-orphan zero；archive manifest | 取消 retirement，legacy 保持 read-only | 仍有流量、未解 orphan、audit/retention 未滿足 |

## Existing baseline risks

現有 `workflow_projects.project_id` 是 text，且以 `(user_id, project_id)` 為主鍵；現行 RLS 以 owner `user_id` 為主，附件亦是 meeting-specific table/path。這些不是立即修改項目。Stage 1 必須先建立 UUID dry-run mapping，Stage 2 才能證明 membership RLS 可安全替代 owner-only policy，Stage 4 才能將 meeting attachment 映射為 File + Attachment。三者不得合併成單次 destructive migration。

## NEXT IMPLEMENTATION GATE

目前 ownership 已唯一指定；已知 schema 差異均有非破壞 dry-run 與 stop/rollback 條件。Phase 1 不需要 Production credential、不改 RLS、不搬資料，因此：

- **Decision required:** NONE
- **Implementation readiness:** READY FOR PHASE 1（僅限唯讀 inventory、mapping dry-run 與報告）

若 dry-run 發現無法唯一映射、不可逆 ID 風險、RLS 無安全映射、附件資料遺失、需更改 ADR、需 credential/destructive operation 或需選擇 UI 行為，立即改為 **DECISION REQUIRED**，不得自行繼續。
