# Architecture Decision Records

## ADR-001 — B → A Progressive Architecture

**Status:** APPROVED

**Context:** 現行 AI工程管理施工核心可運作，Project Atlas 為獨立 Next.js 系統；一次重寫會同時放大資料與交付風險。

**Decision:** 第一階段保留施工核心，將 Atlas 作為獨立 module/sub-app 接入；沿共同契約逐步收斂，最終成為 Next.js Unified Shell 下的單一 App、導航與 Project Context。

**Reason:** 維持營運連續性，讓身份、權限與路由可分段驗證。

**Consequences:** 過渡期存在兩個 runtime，gateway 與契約相容性成為必要邊界；UI 必須隱藏產品分裂。

**Rollback considerations:** 每一階段保留舊入口及 feature flag；未通過 gate 時路由回舊模組，不回寫未核准的新模型。

**Future migration path:** read-only bridge → shared project context → unified navigation → Next.js module migration → legacy retirement。

## ADR-002 — Canonical UUID + Unified Project Name

**Status:** APPROVED

**Context:** 兩系統的 project ID/name 來源不同，無法安全關聯與授權。

**Decision:** 一個 Project 使用一個 canonical UUID 與一個 canonical name；`legacy_project_id` 僅供 migration、audit、history、rollback。

**Reason:** 消除名稱比對與多 ID 主鍵造成的碰撞、誤連結與越權風險。

**Consequences:** 所有 module 必須以 UUID 交換 context；舊文字 ID 需不可變 mapping。Project Domain Service 是名稱唯一 writer。

**Rollback considerations:** 保留雙向 legacy mapping 與來源快照，不覆寫舊 ID；失敗時以 mapping 將讀取導回 legacy record。

**Future migration path:** inventory → dry-run mapping → collision/orphan 驗證 → read-only lookup → controlled cutover。

## ADR-003 — Hybrid Data Model + Single Canonical Writer

**Status:** APPROVED

**Context:** 穩定實體適合 normalized DB，施工動態結構與離線同步仍需 Workflow JSON。

**Decision:** identity、membership、phase/section identity、documents/files/attachments、meetings、notifications、AI/approval 採 normalized records；排程細節、UI state、動態施工設定、未穩定結構、offline snapshot 與 sync payload 採 Workflow JSON。每一 domain 只有一個 canonical writer。

**Reason:** 同時保留關聯完整性與施工流程演進彈性，且避免雙主。

**Consequences:** read model 可組合兩種 store，但不得反向寫入；跨 store 更新必須使用具 idempotency、version 與 audit 的 command/event。

**Rollback considerations:** 新 writer 啟用前保留舊 writer；切換失敗時關閉新 command path，從不可變事件與快照重建 read model。

**Future migration path:** 依 domain-ownership matrix 個別 shadow read、checksum、cutover，不以全域 last-write-wins 合併。

## ADR-004 — Separate Deployment → Gateway → Same-domain → Single App

**Status:** APPROVED

**Context:** 模組目前分開部署，但使用者需要一致入口、URL、身份與導航。

**Decision:** 過渡期保留 separate deployments，透過 single gateway 提供 `/projects/:projectId/...` same-domain paths；最終 single deployment/app/navigation/context。

**Reason:** 解耦部署風險，同時先穩定使用者與整合契約。

**Consequences:** gateway 必須做 server-side membership check、context propagation、fallback 與 trace correlation；URL 不得攜帶 token、role、secret 或完整 state。

**Rollback considerations:** route-by-route feature flag 與健康檢查失敗回舊 module；不得把寫入請求無聲轉送到另一 writer。

**Future migration path:** gateway routes → shared shell → module-by-module same deployment → 移除 legacy route adapters。

## ADR-005 — Project Membership Authorization

**Status:** APPROVED

**Context:** 單一 owner 模型無法支援工程協作，client role 不可信。

**Decision:** 建立 OWNER、MANAGER、EDITOR、VIEWER membership；server/database policy 以 authenticated user 與 canonical project membership 驗證每個 action。

**Reason:** 讓授權可稽核、可撤銷並防止跨專案存取。

**Consequences:** UI 只呈現能力，不能成為授權來源；RLS 需同時限制讀取與寫入，UPDATE 必須驗證原列與新列。

**Rollback considerations:** staging 期間維持舊 owner-only write；membership policy 未驗證前不得放寬權限。

**Future migration path:** owner backfill → shadow authorization → policy tests → staged role enablement → future engineering-role mapping。
