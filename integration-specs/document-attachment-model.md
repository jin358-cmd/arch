# Document, File and Attachment Model

## Concepts

- **File:** binary object 的 canonical metadata；binary 本體存於 Supabase Storage，不放進 relational row 或 Document body。
- **Document:** 可搜尋、可編輯的邏輯文件，具有 title、status 與 current version reference。
- **DocumentVersion:** Document 的不可變歷史快照；每版可引用一個或多個 File/structured content，版本序號在 Document 內唯一。
- **Attachment:** File 與任一 domain entity 的關聯，至少含 `projectId`, `fileId`, `entityType`, `entityId`。
- **Meeting Attachment:** 不建立獨立 binary model；使用 Attachment，`entityType = meeting`、`entityId = meetingId`。

## File contract

每個 File metadata 至少記錄：canonical UUID、project ID、owner/uploader user ID、SHA-256 checksum、server-verified MIME、size bytes、原始檔名、安全顯示名稱、不可由 client 指定的 Storage object path、created/updated time、retention class、scan state、tombstone/deletedAt 與 audit correlation ID。Storage path 不作 business identity。

## Integrity, retention and versioning

- 上傳採 quarantine → size/MIME/checksum/惡意內容驗證 → metadata commit → attachment link；失敗不得留下可讀 orphan object。
- checksum 用於完整性與受控 dedupe，不代表兩個不同 project 自動共用授權。
- DocumentVersion 建立後不可原地改寫；新內容建立新版本並原子更新 current version。
- 刪除先建立 tombstone、撤銷一般讀取並記錄 actor/reason；binary 依 retention/legal hold 延遲清除。restore 與永久刪除須有明確權限及 audit。
- audit trail 記錄 upload、link/unlink、new version、download authorization、tombstone、restore、purge，不記錄 secret/signed URL。

## Authorization and migration

所有 metadata 與 Storage object policy 以 canonical project membership 驗證；private bucket 只產生短效 signed access。外部 provider 不得持有 service-role。

既有 `workflow_meeting_attachments` 與 bucket 先唯讀 inventory。以 project/meeting legacy mapping 建立 File + Attachment dry-run，逐一比對 row count、object existence、size、checksum、MIME 與 orphan。任何缺檔、重複 object path、checksum 不符或 entity 無法映射即停止；舊資料在驗證完成前不刪除。
