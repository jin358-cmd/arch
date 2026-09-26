# AI 工程管理整合規格

本目錄是 AI工程管理與 Project Atlas 的整合施工基線，只描述契約、權責與安全遷移順序；不包含 application code、資料庫 migration 或 Production 操作。

## 已核准基線

1. 以 B → A 漸進方式，由既有施工核心與獨立 Atlas module 過渡至 Next.js Unified Shell。
2. Project 使用 canonical UUID 與唯一 canonical name；舊 ID 只供遷移、稽核與回滾。
3. 採 Hybrid Data Model，但每個 domain 只能有一個 canonical writer。
4. 由分離部署經 single gateway 與 same-domain routes，最終合併為單一 App。
5. 授權以 Project Membership 為準，且必須由 server/database policy 驗證。

## 文件索引

- [Architecture Decisions](architecture-decisions.md)
- [Canonical Identity](canonical-identity.md)
- [Domain Ownership](domain-ownership.md)
- [Project Membership](project-membership.md)
- [Project Lifecycle](project-lifecycle.md)
- [Routing Contract](routing-contract.md)
- [Document and Attachment Model](document-attachment-model.md)
- [AI Review Contract](ai-review-contract.md)
- [Automation and Agent Boundary](automation-agent-boundary.md)
- [Migration Safety Plan](migration-safety-plan.md)

## 不變條件

- 禁止 dual master、跨 canonical store 的 last-write-wins 與 silent overwrite。
- 所有公開 schema 的資料表均須以 RLS 防護；角色與權限不得信任 client 傳入值或可由使用者編輯的 metadata。
- 外部 provider 不持有 database service-role；binary 只存於受控 Storage，metadata 與關聯由系統記錄。
- 本基線未授權實作、migration、搬資料、部署或任何外部寫入。

## NEXT IMPLEMENTATION GATE

Phase 1 僅允許 canonical identity 的 inventory、mapping 草案與 dry-run。執行前仍須重新驗證現行 schema、RLS、備份可還原性及 row-count/checksum/orphan 報告。若任何 canonical ownership 無法唯一判定、ID 轉換不可逆、RLS 無法安全映射、附件可能遺失、需變更 ADR、需 Production credential/destructive migration，或 UI 行為需使用者選擇，狀態立即改為 **DECISION REQUIRED** 並停止。

目前依唯讀盤點，已知舊文字 `project_id`、單一 owner RLS 與 meeting-specific attachment model 均有明確的 staged mapping 與 rollback 邊界，未構成 Phase 1 dry-run 的阻塞。Gate：**READY FOR PHASE 1**。
