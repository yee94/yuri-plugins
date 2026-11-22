# opencode-plugin-wecom

[![npm version](https://img.shields.io/npm/v/opencode-plugin-wecom.svg)](https://www.npmjs.com/package/opencode-plugin-wecom)
[![CI](https://github.com/yee94/yuri-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/yee94/yuri-plugins/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

标准 OpenCode V2 插件（`@opencode/plugin`），为 OpenCode CLI / TUI 与 Yuri 桌面端提供**零客户端依赖**的企业微信（WeCom / 大圆）集成能力。

## 核心特性

- **零桌面客户端依赖**：纯 HTTPS 协议实现，**不需要**在电脑上安装 WorkBuddy 客户端或企业微信桌面端，本机与远程 Linux 服务器均可直接运行。
- **Device Flow 风格扫码登录 + 自动静默续期**：获取官方扫码链接，用手机企业微信扫一次码后，凭据持久化到 OpenCode 原生 `storage`，后续自动在后台刷新并换取企微 `access_token`。
- **大圆 A2A 只读聊天查询**：按当前企业账号发现大圆并换取专用票据，支持查群、读会话摘要、搜消息摘要，内置：
  - `request_id` 幂等回执与参数指纹冲突检测
  - 终态结果本地缓存与 `401` / 过期错误码自动强制换票重试
   - 追加授权返回官方入口；仅允许回复纯文本澄清，审批卡交给本人处理
- **可选 `@wecom/cli` 结构化办公域桥接**：如果本机安装了官方 `@wecom/cli`，可直接查询文档、智能表格、日程、会议、邮件、微盘、通讯录（默认严格只读；未安装完全不影响大圆 A2A）。
- **Yuri / Desktop GUI 薄壳**：通过 `./gui-experimental` 提供中英文界面、顶栏连接状态 Pill、命令面板一键扫码与独立设置页，状态经 OpenCode RPC 实时同步。

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
        "enableCliTool": true,
        "allowCliWrite": false,
        "cliBinary": "wecom"
      }
    ]
  ]
}
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enableCliTool` | `boolean` | `true` | 是否注册可选的 `wecom_cli` 工具 |
| `allowCliWrite` | `boolean` | `false` | 是否允许 `wecom_cli` 执行写操作子命令（`create`/`update`/`delete`/`send` 等）；默认严格只读 |
| `cliBinary` | `string` | `"wecom"` | 自定义 `@wecom/cli` 可执行文件路径 |

---

## 快速上手：用 OpenCode 查企业微信

安装插件后，在 OpenCode 里直接提问即可，不必手动调用工具。插件内置 `wecom-dayuan` Skill，Agent 会按需要查消息、引导授权或恢复原任务。支持企业微信内部单聊和群聊，不是个人微信，也不提供聊天原文。

- 「根据最近 7 天我发出的消息和提到我的消息，看看我最近在跟进什么，注明会话和日期。」
- 「总结『项目群』近 3 天的结论和待办。」
- 「在企业微信里找一下与『联调』相关的讨论。」

### 首次登录

1. 在 OpenCode 会话中运行 `/wecom-login`（或让 Agent 调用 `wecom_login({ mode: "start" })`；在 Yuri 桌面端也可从设置页或命令面板选择 **「企业微信：扫码登录」**）。
2. 在浏览器打开返回的 `authorization_url`，用**手机企业微信**扫码确认。
3. 调用 `wecom_login({ mode: "wait", wait_seconds: 60 })`（或在 Yuri 设置页点击 **「确认已扫码」**），插件将轮询登录态并自动换取企业微信 user token。
4. 首次查询时，插件通过当前账号的 Agent Card 发现大圆并换取专用 Agent Ticket；仅在有票据后提交只读查询。企业微信用户 Token 不用于提交大圆任务。

### 查询要求追加授权时

1. 工具返回 `interaction_kind: "authorization_required"`，并在正文和 `authorization_url` 字段提供官方授权地址。Agent 应把链接写到**每个受阻事项的回复正文**里，不要只说「请先授权」。
2. 用同一企业账号打开链接确认。确认后，Agent 调用 `wecom_login({ mode: "verify_wecom" })`；Yuri 也可以点「确认已授权」。验证只换票，不提交查询。
3. 如果已拿到 `task_id`，用 `wecom_read_result` 继续查同一个任务；如果明确尚未提交才重试原查询。原任务仍待授权时，到官方界面查看该任务；若企业未开通权限，找管理员处理。

任务审批卡是另一条流程。WorkBuddy 可用 `wxwork://` 唤起企业微信确认当前任务；本插件不生成或转发含审批票据的 deep link，也不代批。请在企业微信官方界面处理原审批卡，再查询原任务。

---

## 能力清单

### 1. Tools（namespace: `wecom`，`codemode: true`）

| 工具名 | 作用 | 主要参数 |
| --- | --- | --- |
| `wecom_status` | 零网络请求检查登录态、企微 Token 就绪度、可选 `@wecom/cli` 状态及近期回执 | `include_receipts?: boolean` |
| `wecom_login` | 扫码登录、追加授权与换票验证 | `mode: "start" \| "finish" \| "wait" \| "wecom_auth" \| "verify_wecom" \| "logout"`, `wait_seconds?: number` |
| `wecom_read_start` | 发起大圆 A2A 只读查询并返回摘要（`is_summary: true`） | `action: "search_groups" \| "read_chat" \| "search_messages"`, `query?`, `chat_name?`, `question?`, `time_range?`, `limit?`, `request_id?`, `wait_seconds?` |
| `wecom_read_result` | 按 `task_id` 轮询或读取本地缓存的终态结果 | `task_id: string`, `wait_seconds?: number` |
| `wecom_read_reply` | 对纯文本澄清类 `input_required` 任务回复澄清（审批卡片强制拒绝） | `task_id: string`, `text: string`, `request_id?`, `wait_seconds?` |
| `wecom_cli` | 可选 `@wecom/cli` 办公域只读桥接（`execFile` 无 Shell 插值） | `domain: "doc" \| "smartsheet" \| "calendar" \| "meeting" \| "mail" \| "wedrive" \| "contact" \| "auth"`, `args: string[]`, `timeout_ms?: number` |

### 2. Slash Commands

- `/wecom-login`：生成并在会话中展示手机企业微信扫码链接
- `/wecom-status`：查看当前登录态、企微凭据状态与近期查询回执数
- `/wecom-logout`：清除 OpenCode 存储的 WorkBuddy 与企业微信凭据

### 3. 内嵌 Skill

- `wecom-dayuan`：自动随插件注册，约束 Agent 遵守摘要边界（`is_summary: true`）、幂等 `request_id` 使用规范、以及遇到审批卡必须停下交由人工确认的护栏。

### 4. RPC 契约（`opencode-plugin-wecom/rpc`）

导出 `WecomRpc`（`id: "opencode-plugin-wecom"`），供 Yuri GUI / TUI 或其他插件调用：

- Methods：`status`、`startLogin`、`finishLogin`、`verifyWecom`、`logout`、`recentReceipts`
- Events：`authChanged`（`{ phase, wecom_configured }`）

---

## 安全护栏与已知限制

1. **只读摘要而非逐字原文**：大圆 A2A 返回的是 AI 总结后的群聊/消息摘要（结果对象固定带 `is_summary: true`），适合总结讨论要点与检索结论，不适合作为逐字原始日志取证。
2. **严禁自动代批**：当任务进入 `input_required` 且包含 `wecom_part_type: "approval"` 或 `token_id_list` 时，插件会标记 `interaction_kind: "approval_required"`，并在 `wecom_read_reply` 中直接抛出 `APPROVAL_INTERACTION_BLOCKED`（零网络请求），提醒用户在手机企业微信手动审批。
3. **一次性 `refresh_token` 防重放屏障**：发起续期请求前先持久化 `refresh_unknown` 屏障；若发生发送前网络错误（如 DNS 失败）会自动恢复可重试，若发生不确定中断则禁止自动重放，避免打废有效会话。
4. **企业权限前提**：需要企业微信企业账号，且所在企业允许授权 WorkBuddy 应用。

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
    "/Users/yee.wang/Code/selfs/yuri-plugins/packages/opencode-plugin-wecom"
  ]
}
```

## License

[MIT](LICENSE)
