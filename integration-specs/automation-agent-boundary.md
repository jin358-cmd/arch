# Automation and Agent Boundary

## Provider-neutral contract

- **Event:** 已發生且不可變的 domain fact，含 event ID、project ID、type、occurredAt、schemaVersion、producer、dedupe key。
- **Job:** 根據 Event 或人工請求建立的工作命令，含 scoped input references、policy、deadline、attempt 與 idempotency key。
- **Result:** provider 回傳的不可變輸出與 provenance，不等於 domain truth。
- **Notification:** 對特定 audience/channel 的待送訊息與 delivery policy。
- **Approval:** 合格 human actor 依 policy 對 proposal 的決策。
- **Action:** 經授權、版本檢查及核准後，由內部 executor 執行的 canonical command。

核心 schema 使用 capability/type 欄位與 provider reference，不把 ChatGPT、Codex、Hermes、scheduled jobs、Email、Telegram 或未來 Agent 名稱寫死成 domain 欄位或狀態。

## Trust boundary

AI工程管理是 System of Record、Authorization Authority、Approval Authority 與 Audit Authority。外部 provider 只能透過 scoped API/interface/job contract：讀取最小必要資料、回傳 Result 或提出 Action proposal。Provider token 置於受控 secret store，不出現在 URL、log、Result 或 domain row；provider 絕不持有 database service-role。

## Execution controls

- 每次呼叫具有 project scope、user/service identity、allowed capability、短效 credential、rate limit、timeout 與 correlation ID。
- Webhook/event 需驗證簽章、timestamp、replay window 與 dedupe key；scheduled job 亦適用同一 authorization/policy。
- Email/Telegram 等 outbound delivery 由 Notification Service 依 consent、recipient、impact 等級與 approval policy 發送。
- Provider failure 只能重試同一 idempotent Job 或進 dead-letter queue；不得改寫 canonical domain 或自動擴大 scope。
- 所有 Action 由內部 executor 再查 membership、approval、target version；無法驗證即 fail closed。
