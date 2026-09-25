# AI Review Contract

## State separation

1. **AIJob:** provider-neutral execution request，含 project、request type、input references、policy、requestedBy、idempotency key、status 與期限。
2. **AIResult:** provider output 與 provenance 的不可變記錄；包含 model/provider reference、input/output hash、時間與安全分類，但不是已核准事實。
3. **AIReview:** 工程業務層的 review record，將 Result 轉為可讀 finding、影響範圍、證據、信心與建議。
4. **HumanApproval:** 人工 actor 對特定 review/action proposal 的 approve/reject/request-changes 決策，含 policy version、理由與時間。
5. **Action:** 只有 approval policy 滿足後才建立的明確系統 command，具有 target、expected version、scope、idempotency、executor 與完整 audit。

狀態流：`AIJob → AIResult → AIReview → HumanApproval → Action`。任何階段都不可把模型輸出直接視為 canonical domain update。

## Safety policy

AI 不得直接修改工程進度、刪除文件、修改 Project membership、對外發送高影響通知，或執行 destructive action。只有明確 policy 指定 action 類型、合格 approver、scope、期限、expected version、dry-run/preview 與可回滾策略後，Action Executor 才可執行。

- 高風險/不可逆操作一律人工核准；過期、內容 hash 改變或 target version 改變時核准失效。
- OWNER-only action 不得由 MANAGER approval 取代；AI 或 provider 永遠不是 approver。
- Result/Review 可被 supersede，不可 silent overwrite；所有重試共用或關聯 idempotency key。
- Executor 重新做 server-side authorization 與 membership 驗證，不信任 Job payload 中的 role。
- Audit 連結 job、result、review、approval、action、actor、policy version、before/after reference 與 correlation ID。
