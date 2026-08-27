# Supabase 設定與部署

## 已套用的遠端資源

Supabase project ref：`qmptlkgseffmeqnarwnb`

Migration 歷史：

1. `20260826020023_create_workflow_cloud_sync.sql`
2. `20260826020312_add_workflow_state_tombstones.sql`
3. `20260826022313_fix_workflow_storage_policy_path.sql`

建立的資源：

- `public.workflow_projects`
- `public.workflow_project_state`
- `public.workflow_meeting_attachments`
- 私人 bucket `workflow-meeting-attachments`（20 MB）

三張表都已啟用 RLS 與 FORCE RLS；`anon` 沒有 CRUD grant，`authenticated` 只能透過 policy 存取自己的 `user_id`。三張表已加入 Realtime publication。

## 必做的一次性 Auth 設定

到 Supabase Dashboard → Authentication → URL Configuration：

- Site URL：`https://jin358-cmd.github.io/arch/`
- Redirect URLs：加入 `https://jin358-cmd.github.io/arch/`

Authentication → Providers 需保持 Email 啟用。正式使用建議：

- 啟用電子郵件確認。
- 私人使用者完成註冊後關閉公開註冊，或啟用 CAPTCHA 與自訂 SMTP。
- 不在前端放 secret／service-role key。

目前公開 Auth settings 已確認 Email 與註冊開啟、電子郵件需要確認；URL allowlist 仍須在 Dashboard 核對。

## 本機 CLI

已測試 CLI：Supabase CLI `2.81.3`。本機需先安裝 Docker，然後可執行：

```powershell
npx --yes supabase@2.81.3 start
npx --yes supabase@2.81.3 db reset
```

要將後續 migration 推到此遠端專案：

```powershell
npx --yes supabase@2.81.3 link --project-ref qmptlkgseffmeqnarwnb
npx --yes supabase@2.81.3 migration list
npx --yes supabase@2.81.3 db push
```

不要提交 `supabase/.temp`、存取權杖、資料庫密碼或任何 `.env` secret。

## 上線驗收

- 未登入 REST 請求應回 401；已實測通過。
- 帳號 A 無法讀寫帳號 B 的專案與附件。
- 兩台裝置使用同帳號登入後，新增／修改／離線恢復會同步。
- 同一工作資料被兩台同時修改時會建立衝突備份；原案雲端附件保留於原案，已有本機快取的附件會複製至備份。
- 附件可跨裝置上傳、下載與刪除；刪除失敗會保留佇列重試。
- Security Advisor 應保持 0 項。
