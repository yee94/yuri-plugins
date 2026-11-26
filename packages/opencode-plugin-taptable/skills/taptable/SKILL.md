---
name: taptable
description: TapTable 需求跟进：查主线需求和任务、更新阶段或任务状态与备注、新增或删除条目、导出 Markdown 进度简报。
---

# TapTable 需求跟进

Yuri 的「需求跟进」与 `taptable_board` 工具共用一份数据。使用此工具查询或维护看板。

```json
{ "method": "GET", "path": "/api/board" }
```

1. 每次查询或更新前读取看板，按标题和所属需求匹配实际 ID。重名或指代不清时，让用户选定条目。
2. 按用户提供的事实更新指定字段；未提及的字段保留原值。需求的 `stage` 是自由文本，任务的 `status` 只能是 `todo`（待开始）、`doing`（进行中）、`verifying`（验收中）、`done`（已完成）。
3. 检查 HTTP 状态及返回的 `board`，按需求汇报当前阶段、任务进展和用户要跟进的动作。服务不可达时说明失败；写入超时先重新读取确认，再决定是否重试，避免重复创建。

| 操作 | API | JSON 字段 |
| --- | --- | --- |
| 新建需求 | `POST /api/requirements` | `title` 必填；可选 `stage`、`note`、`docs`（`[{label,url}]`） |
| 更新需求 | `PATCH /api/requirements/{id}` | 仅发送要改的 `title`、`stage`、`note`、`docs` |
| 新建任务 | `POST /api/tasks` | `reqId`、`title` 必填；可选 `status`、`note` |
| 更新任务 | `PATCH /api/tasks/{id}` | 仅发送要改的 `reqId`、`title`、`status`、`note` |
| 删除任务或需求 | `DELETE /api/tasks/{id}` 或 `DELETE /api/requirements/{id}` | 删除需求会同时删除其全部任务；操作前确认范围 |
| 导出简报 | `GET /api/export/markdown` | 返回 Markdown 文本 |

新建或更新时，把 JSON 字段放在 `payload`，例如 `{"method":"PATCH","path":"/api/tasks/实际任务ID","payload":{"status":"verifying"}}`。ID 从读取结果获取。已打开的页面重新进入后会读取最新数据。
