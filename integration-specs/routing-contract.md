# Unified Routing Contract

所有 route 的 `:projectId` 必須是 canonical UUID。Gateway 先建立經 server 驗證的 Project Context `{projectId, userId, permissions, correlationId}`；module 不接受 client 宣稱的 role。

| Route | Module owner | Required permission | Project context | Deep link | Mobile | Fallback |
|---|---|---|---|---|---|---|
| `/projects/:projectId/overview` | Unified Shell | View Project | summary capabilities | restore overview state | project home tab | authorized overview/error |
| `/construction` | Construction module | View Project | phase/section/task refs | retain selected entity in query-safe ID | construction tab | read-only legacy module |
| `/progress` | Progress module | View Project | workflow version | selected phase/section | progress tab | project overview |
| `/field` | Construction module | View Project | site context | selected record ID | field tab | construction |
| `/risks` | Risk module | View Project | risk capabilities | risk ID | risk tab | project overview |
| `/meetings` | Meeting module | View Project | meeting capabilities | meeting ID | meeting tab | project overview |
| `/documents` | Document module | View Project | document capabilities | folder/filter as opaque UI query | documents tab | project overview |
| `/documents/:documentId` | Document module | View Project | document membership check | exact document/version | detail sheet/page | documents list/404 |
| `/mindmap` | Atlas module | View Project | canonical structure refs | selected node ID | responsive canvas/list | project overview |
| `/notifications` | Notification module | View Project | user inbox scope | notification ID | notifications tab | project overview |
| `/ai-reviews` | AI Review module | View AI Review | approval capabilities | review/job ID | review queue | project overview |

表中省略的共同前綴均為 `/projects/:projectId`。

## Behavior

- 未登入：導向登入並保存不含秘密的 return path；無 membership：403；不存在或不可揭露：404；module unavailable：顯示可追蹤錯誤與安全 fallback。
- Deep link 只攜帶不具權限意義的 entity ID；module 必須再次查驗 entity 屬於該 project。
- Mobile 保留同一 URL 與授權語義，只改導航呈現，不建立另一套 route/state。
- Gateway fallback 只能切讀取/呈現路徑；寫入不可在失敗時無聲改送另一 canonical writer。
- URL 禁止完整 project state、access/refresh token、role、secret、signed Storage URL 或敏感 payload。
