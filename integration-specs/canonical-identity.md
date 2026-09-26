# Canonical Project Identity

## Domain contract

```text
Project {
  id: UUID
  name: string
  ownerUserId: UUID
  createdAt: timestamp
  updatedAt: timestamp
}

LegacyProjectIdentity {
  canonicalProjectId: UUID
  sourceSystem: string
  legacyProjectId: string
  migratedAt: timestamp
}
```

這是概念規格，不是 table 或 migration 定義。

## Authority and invariants

- Project Domain Service 產生 canonical UUID（server-side UUID v4 或同等具 122-bit 隨機性的標準 UUID）並唯一寫入 `Project.name`。
- `id` 建立後不可變；`name` 必須 trim、非空、符合產品長度限制，但名稱不是識別鍵。
- `name` 以 NFC 正規化、上限 200 characters，且允許不同 Project 使用相同 normalized name；不得建立全域唯一限制。
- `(sourceSystem, legacyProjectId)` 唯一映射至一個 canonical Project；一個 canonical Project 可有多個 legacy mapping。
- `ownerUserId` 必須對應有效 user，且同時存在唯一 OWNER membership；所有權轉移是受稽核的 owner-only operation。

## Cross-module lookup

Module 只接收 canonical `projectId`，先由 server resolver 驗證 UUID、Project 存在與 membership，再回傳最小 Project Context。legacy ID 僅可送入受控 migration resolver，不得出現在新 route 或新 foreign key。

## Draft and offline identity

未登入 client 只能建立 `draft-{UUID}` Draft 或 `template-{UUID}` Template；這些 ID 不是 Formal Project UUID，不建立 owner membership、Production cloud row或正式 mapping。登入後由使用者明確觸發 idempotent promotion，才建立 canonical UUID。Draft identity 不被覆寫；完成後保存 `promotedProjectId`。

## Project display identity

顯示契約由 `Project Name` 加上可選的 display code、location/address、client/owner display name、year、status 組成。這些欄位僅供辨識，均不得成為 route、authorization 或關聯 identity。Display Code 產生格式、Address 是否必填與最終卡片版面屬 **FUTURE UI DECISION**。

## Collision prevention and validation

- 資料庫唯一約束是最終防線；不得以 project name 判斷同一專案。
- Dry-run 產出 legacy uniqueness、UUID 格式、owner existence、引用完整性、row count、mapping checksum 與 orphan 清單。
- 每筆遷移需可追溯 `sourceSystem + legacyProjectId → canonicalProjectId`，重跑必須 idempotent。
- 既有 `workflow_projects.project_id` 為 text 且主鍵含 `user_id`；在 Phase 1 只盤點與模擬 mapping，不直接改型別或覆寫。

## Rollback mapping

切換前凍結 mapping 版本並保存 legacy 快照、canonical-to-legacy 反向索引及 checksum。回滾只切回讀取/路由與舊 writer，不刪除 canonical UUID、不重用 UUID、不改寫 legacy ID。若一對多或多對一無法唯一解釋，標記 **DECISION REQUIRED**。
