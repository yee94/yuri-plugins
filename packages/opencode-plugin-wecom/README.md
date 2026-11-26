# opencode-plugin-wecom

[![npm version](https://img.shields.io/npm/v/opencode-plugin-wecom.svg)](https://www.npmjs.com/package/opencode-plugin-wecom)
[![CI](https://github.com/yee94/yuri-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/yee94/yuri-plugins/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

标准 OpenCode V2 插件（`@opencode/plugin`），为 OpenCode CLI / TUI 与 Yuri 桌面端提供**零客户端依赖**的企业微信（WeCom / 大圆）集成能力。

## 核心特性

- **零桌面客户端依赖**：纯 HTTPS 协议实现，**不需要**在电脑上安装 WorkBuddy 客户端或企业微信桌面端，本机与远程 Linux 服务器均可直接运行。
- **Device Flow 风格扫码登录 + 自动静默续期**：获取官方扫码链接，用手机企业微信扫一次码后，凭据持久化到 OpenCode 原生 `storage`，后续自动在后台刷新并换取企微 `access_token`。
- **大圆 A2A 聊天读写**：按当前企业账号发现大圆并换取专用票据，支持查群、读会话摘要、搜消息摘要；显式开启后可给本人、内部单聊或群发送消息，并创建内部群：
  - `request_id` 幂等回执与参数指纹冲突检测
  - 终态结果本地缓存与 `401` / 过期错误码自动强制换票重试
   - 追加授权返回官方入口；仅允许回复纯文本澄清，审批卡支持原生自动确认与官方入口降级
- **Yuri / Desktop GUI 薄壳**：通过 `./gui-experimental` 提供命令面板一键扫码、独立设置页及 Electron 原生审批桥，状态经 OpenCode RPC 实时同步。

---

## 安装与配置

要求 Node.js `>= 22` 与 OpenCode V2（`@opencode/plugin` `^2.3.x`）。

在 `~/.config/opencode/opencode.jsonc` 中添加插件：

```jsonc
{
  "plugins": [
    "opencode-plugin-wecom"
  ]
}
```

### 可选插件参数（`options`）

```jsonc
{
  "plugins": [
    [
      "opencode-plugin-wecom",
      {
        "write": true
      }
    ]
  ]
}
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `write` | `boolean` | `false` | 统一开启大圆发消息、建群、自发测试、审批处理，以及本机 macOS 原生小窗和辅助功能自动确认；默认全部写操作关闭 |

---

## 快速上手：用 OpenCode 查企业微信、发消息

安装插件后，在 OpenCode 里直接提问即可，不必手动调用工具。插件内置 `wecom-dayuan` Skill，Agent 会按需要查消息、引导授权或恢复原任务。支持企业微信内部单聊和群聊，不是个人微信，也不提供聊天原文。

- 「根据最近 7 天我发出的消息和提到我的消息，看看我最近在跟进什么，注明会话和日期。」
- 「总结『项目群』近 3 天的结论和待办。」
- 「在企业微信里找一下与『联调』相关的讨论。」
- 「整理我的未读会话，按需处理、值得关注和其他分档。」
- 「找最近 7 天明确 @ 我的消息」，或「找项目群里分享过的文件」。
- 「从项目群的讨论里找参与某项协议评审的联系人。」
- 开启 `write` 后：「通过大圆给我自己发一条文本消息」「给内部群『项目联调』发这条通知」「创建内部群『发布协调』，成员为张三、李四」。

### 首次登录

1. 在 OpenCode 会话中运行 `/wecom-login`（或让 Agent 调用 `wecom_login({ mode: "start" })`；在 Yuri 桌面端也可从设置页或命令面板选择 **「企业微信：扫码登录」**）。
2. 在浏览器打开返回的 `authorization_url`，用**手机企业微信**扫码确认。
3. 调用 `wecom_login({ mode: "wait", wait_seconds: 60 })`（或在 Yuri 设置页点击 **「确认已扫码」**），插件将轮询登录态并自动换取企业微信 user token。
4. 首次调用时，插件通过当前账号的 Agent Card 发现大圆并换取专用 Agent Ticket；仅在有票据后提交任务。企业微信用户 Token 不用于提交大圆任务。

### 查询要求追加授权时

1. 工具返回 `interaction_kind: "authorization_required"`，并在正文和 `authorization_url` 字段提供官方授权地址。Agent 应把链接写到**每个受阻事项的回复正文**里，不要只说「请先授权」。
2. 用同一企业账号打开链接确认。确认后，Agent 调用 `wecom_login({ mode: "verify_wecom" })`；Yuri 也可以点「确认已授权」。验证只换票，不提交查询。
3. 如果已拿到 `task_id`，用 `wecom_read_result` 继续查同一个任务；如果明确尚未提交才重试原查询。原任务仍待授权时，到官方界面查看该任务；若企业未开通权限，找管理员处理。

任务审批卡是另一条流程。大圆只返回待审批任务和票据，不会主动推送卡片。开启 `write` 后，可在本机 macOS 调用 `wecom_open_approval`：GUI 插件 `main` 通过本机桥接请求企微原生小窗，本地服务提供同样的原生兜底，失败时打开官方 `wxwork://` 确认入口。原生能力复用已安装 WorkBuddy 的 SDK/Koffi，不新增依赖，不复制动态库或持久化审批票据。返回 `channel` 区分 `native` / `external`；工具不会输出票据。原生小窗出现后，GUI `main` 会通过辅助功能对唯一包含确认/取消按钮的原生窗口执行 `AXPress`，不使用坐标点击；随后必须查询原任务，不要重复提交。

---

## 能力清单

### 1. Tools（namespace: `wecom`，`codemode: true`）

| 工具名 | 作用 | 主要参数 |
| --- | --- | --- |
| `wecom_status` | 零网络请求检查登录态、企微 Token 就绪度及近期回执 | `include_receipts?: boolean` |
| `wecom_login` | 扫码登录、追加授权与换票验证 | `mode: "start" \| "finish" \| "wait" \| "wecom_auth" \| "verify_wecom" \| "logout"`, `wait_seconds?: number` |
| `wecom_read_start` | 发起大圆 A2A 只读查询并返回摘要（`is_summary: true`） | `action: "search_groups" \| "read_chat" \| "search_messages" \| "find_mentions" \| "triage_unread" \| "find_chat_files" \| "find_chat_contacts"`；按场景传 `query`、`chat_name`、`question`、`time_range`、`limit`；可选 `request_id`、`wait_seconds` |
| `wecom_read_result` | 按 `task_id` 轮询或读取本地缓存的终态结果 | `task_id: string`, `wait_seconds?: number` |
| `wecom_cancel_task` | best-effort 取消已有大圆任务；终态失败不重试 | `task_id: string` |
| `wecom_read_reply` | 对纯文本澄清类 `input_required` 任务回复澄清（审批卡片强制拒绝） | `task_id: string`, `text: string`, `request_id?`, `wait_seconds?` |
| `wecom_send_message` | 可选：给本人或名称完全匹配且唯一的内部单聊/群发消息；支持 HTTPS file parts | `target_type: "self" \| "single" \| "group"`, `target_name?`, `text`, `attachments?`, `request_id`, `wait_seconds?` |
| `wecom_create_group` | 可选：按完全匹配且唯一的内部成员创建内部群 | `group_name`, `members`, `request_id`, `wait_seconds?` |
| `wecom_test_send_self` | 可选：给当前登录用户发送一条固定测试消息 | `request_id: string` |
| `wecom_open_approval` | 可选：请求原生企微小窗或打开官方确认入口；启用自动确认后通过辅助功能点击原生确认按钮，不输出票据 | `task_id: string` |

### 2. Slash Commands

- `/wecom-login`：生成并在会话中展示手机企业微信扫码链接
- `/wecom-status`：查看当前登录态、企微凭据状态与近期查询回执数
- `/wecom-logout`：清除 OpenCode 存储的 WorkBuddy 与企业微信凭据

### 3. 内嵌 Skill

- `wecom-dayuan`：自动随插件注册，约束 Agent 遵守摘要边界（`is_summary: true`）、幂等 `request_id` 使用规范，以及审批卡的原生打开、可选自动确认和原任务恢复流程。

### 4. RPC 契约（`opencode-plugin-wecom/rpc`）

导出 `WecomRpc`（`id: "opencode-plugin-wecom"`），供 Yuri GUI / TUI 或其他插件调用：

- Methods：`status`、`startLogin`、`finishLogin`、`verifyWecom`、`logout`、`recentReceipts`
- Events：`authChanged`（`{ phase, wecom_configured }`）

---

## 安全护栏与已知限制

1. **只读摘要而非逐字原文**：大圆 A2A 返回的是 AI 总结后的群聊/消息摘要（结果对象固定带 `is_summary: true`），适合总结讨论要点与检索结论，不适合作为逐字原始日志取证。
2. **审批卡不允许文本代批**：当任务进入 `input_required` 且包含 `wecom_part_type: "approval"` 或 `token_id_list` 时，插件会标记 `interaction_kind: "approval_required"`，并在 `wecom_read_reply` 中直接抛出 `APPROVAL_INTERACTION_BLOCKED`（零网络请求）。审批只能走 `wecom_open_approval` 的原生窗口或官方确认页。
3. **一次性 `refresh_token` 防重放屏障**：发起续期请求前先持久化 `refresh_unknown` 屏障；若发生发送前网络错误（如 DNS 失败）会自动恢复可重试，若发生不确定中断则禁止自动重放，避免打废有效会话。
4. **企业权限前提**：需要企业微信企业账号，且所在企业允许授权 WorkBuddy 应用。
5. **写操作默认关闭**：只有 `write: true` 才注册发消息、建群、自发测试和审批打开工具，并启用本机原生自动确认。目标必须完全匹配且唯一，外部联系人、@提醒、卡片和批量发送不在支持范围内。
6. **自动确认有明确边界**：原生小窗和 `wxwork://` 入口目前仅支持本机 macOS。自动确认只在 `write: true` 的 GUI `main`、辅助功能权限可用且主显示器活跃时生效，找不到唯一确认/取消按钮组合就不点击；系统锁屏或显示器休眠时需先解锁，网页降级仍需本人确认。打开入口或调用 `AXPress` 都不代表任务已完成，必须继续查询原任务；终态、审批超时和取消失败都不重复提交。
7. **附件边界**：`attachments` 只把用户提供的 HTTPS URL 转为 A2A file parts，本插件不上传、托管、下载或探测附件内容。

---

## 本地开发与校验

在仓库根目录执行：

```sh
pnpm install
pnpm --filter opencode-plugin-wecom check
```

`check` 会依次运行 Biome lint、TypeScript 类型检查（`tsc --noEmit`）、`tsdown` 打包（ESM + CJS GUI bundle）、Vitest 单元测试，以及 `node --check dist/gui-experimental.cjs`。

本地联调时，可直接将绝对路径写入 `~/.config/opencode/opencode.jsonc`：

```jsonc
{
  "plugins": [
    "/path/to/yuri-plugins/packages/opencode-plugin-wecom"
  ]
}
```

## License

[MIT](LICENSE)
