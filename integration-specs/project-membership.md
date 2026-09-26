# Project Membership and Authorization

## Model

`Project` 是授權範圍；`ProjectMembership(projectId, userId, role, status, createdAt, updatedAt)` 是 server/database 的權威關係。每個 Project 必須恰有一個 OWNER。角色不得由 URL、request body、client storage 或 user-editable metadata 決定。

`Project.ownerUserId` 與唯一 OWNER membership 必須同時存在且 user ID 一致；不一致是 integrity violation。建立或 promotion Formal Project 時兩者須在同一 transaction 完成，Draft/Template 不建立 membership。

## Permission matrix

| Permission | OWNER | MANAGER | EDITOR | VIEWER |
|---|:---:|:---:|:---:|:---:|
| View Project | ✓ | ✓ | ✓ | ✓ |
| Edit Project | ✓ | ✓ | Assigned content | — |
| Manage Members | ✓ | ✓* | — | — |
| Edit Construction | ✓ | ✓ | ✓ | — |
| Edit Schedule | ✓ | ✓ | ✓ | — |
| Manage Risk | ✓ | ✓ | ✓ | — |
| Create Meeting | ✓ | ✓ | ✓ | — |
| Edit Document | ✓ | ✓ | ✓ | — |
| Upload File | ✓ | ✓ | ✓ | — |
| Delete File | ✓ | ✓ | — | — |
| View AI Review | ✓ | ✓ | ✓ | ✓ |
| Approve AI Action | ✓ | ✓** | — | — |
| Manage Notifications | ✓ | ✓ | Own preferences | Own preferences |

`*` MANAGER 可管理 EDITOR/VIEWER，不可授予或移除 OWNER、提升為 OWNER、刪除最後一位管理者，或執行 owner-only destructive action。

`**` 僅限 approval policy 允許的非 owner-only action。

## Enforcement

- Server 每次以 authenticated user、canonical project ID、active membership 與 action policy 重新授權；UI capability 只供顯示。
- Supabase exposed tables 必須啟用 RLS；policy 同時驗證 project membership。UPDATE 同時具備舊列 `USING` 與新列 `WITH CHECK` 條件。
- 不使用 `user_metadata` 做授權；若使用 JWT app metadata，仍需考慮 token freshness，高影響操作應查詢即時 membership/session。
- membership 變更、owner transfer、file delete、AI approval 均留下 actor、project、before/after、policy、timestamp、correlation ID。

## Future engineering roles

監造、設計、承包商、工班、業主等先以未來「role profile/capability set」擴充，不加入 v1 enum、不改變四個正式角色的語義。引入前需另立 ADR 與 policy tests。
