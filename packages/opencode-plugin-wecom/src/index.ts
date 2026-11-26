import { execFile } from 'node:child_process';
import { Plugin, type Skill } from '@opencode/plugin';
import type { StorageDomain } from '@opencode/plugin/promise/storage';
import {
  DAYUAN_READ_INSTRUCTIONS,
  DayuanA2AClient,
  type DayuanAction,
  type DayuanReadStartInput,
  type DayuanTaskResult,
} from './a2a/client.js';
import { WECOM_LOGIN_URL, WorkBuddyAuth, type WorkBuddyStatus } from './auth/workbuddy.js';
import { createDirectNativeApproval, requestNativeApproval } from './native-approval.js';
import { PLUGIN_ID, WecomRpc } from './rpc.js';
import type { Clock, HttpTransport, StorageAdapter } from './types.js';
import { WecomError } from './types.js';

export interface WecomPluginDeps {
  readonly transport?: HttpTransport;
  readonly clock?: Clock;
  readonly approvalOpener?: (url: string) => Promise<'native' | 'external'>;
}

async function openApprovalUrl(
  url: string,
  directNative?: ReturnType<typeof createDirectNativeApproval>,
): Promise<'native' | 'external'> {
  if (process.platform !== 'darwin') throw new WecomError('APPROVAL_OPEN_UNSUPPORTED', true);
  if ((await requestNativeApproval(url)) || directNative?.request(url)) return 'native';
  await new Promise<void>((resolve, reject) => {
    execFile('/usr/bin/open', [url], { timeout: 10_000 }, (err) => {
      if (err) reject(new WecomError('APPROVAL_OPEN_FAILED'));
      else resolve();
    });
  });
  return 'external';
}

const EMBEDDED_SKILL_CONTENT = `---
name: wecom-dayuan
description: 通过大圆查询企业微信内部单聊、群聊和消息；经显式启用后给本人或内部会话发消息、建内部群；处理登录、审批和任务恢复。
---

# 企业微信（WeCom / 大圆）使用规范

## 1. 查询
- 已登录时直接调用 \`wecom_read_start\`，无需每次扫码。按群名找群用 \`search_groups\`；有明确会话和问题用 \`read_chat\`（\`chat_name\`、\`question\`）；查近期工作或跨会话找消息用 \`search_messages\`（\`query\`、可选 \`time_range\`）。
- 找 @ 用 \`find_mentions\`，整理未读用 \`triage_unread\`，找聊天文件用 \`find_chat_files\`，按聊天上下文找人用 \`find_chat_contacts\`（必填 \`query\`）。读单聊优先用完整显示名。
- 例如「我最近在做什么」：查最近 7 天我发出的消息和提到我的消息，汇总项目、进展和待办，请大圆注明会话和日期。拿到 \`task_id\` 后用 \`wecom_read_result\` 查同一任务，直到完成、失败或需要用户处理。仅 \`text_clarification\` 可用 \`wecom_read_reply\` 回复。
- 回复时标明内容是大圆摘要，不是聊天原文。没有匹配就如实说明。为原查询保留稳定的 \`request_id\`；遇到 \`SUBMIT_OUTCOME_UNKNOWN\` 不要换 ID 重发。

## 2. 大圆写操作
- 仅在插件开启 \`write\` 且用户明确要求时调用 \`wecom_send_message\` 或 \`wecom_create_group\`。发送本人用 \`target_type: "self"\`；内部单聊/群分别用 \`single\` / \`group\` 并传完全匹配的 \`target_name\`。
- \`attachments\` 只接受用户明确提供的 HTTPS 文件地址，原样作为 A2A file parts 发送；不要本机探测或下载该地址。外部联系人、@提醒、卡片、批量发送或目标不唯一时停止。
- 每次写操作使用稳定 \`request_id\`。返回 \`task_id\` 后用 \`wecom_read_result\` 查同一任务；\`SUBMIT_OUTCOME_UNKNOWN\` 或审批等待都不换 ID 重发。
- 用户明确取消任务时调用 \`wecom_cancel_task\`。取消是 best-effort；已到终态或找不到任务时停止，不重试。

## 3. 登录、追加授权与恢复
- 未登录或 WorkBuddy 会话失效：调用 \`wecom_login({ mode: "start" })\`，**在面向用户的正文中贴出返回的 \`authorization_url\`**。请用户用同一企业账号在官方页面完成登录，确认后调用 \`wecom_login({ mode: "wait", wait_seconds: 60 })\`，再查询。不需要安装 WorkBuddy 或企业微信桌面端。
- 若结果为 \`authorization_required\`，或报 \`WECOM_AUTH_REQUIRED_OPEN_WECOM_LOGIN\`，先停下。**每个受阻事项的正文都要附上该结果的授权地址**；优先原样使用 \`authorization_url\`，缺失时调用 \`wecom_login({ mode: "wecom_auth" })\` 获取。请用户确认后调用 \`wecom_login({ mode: "verify_wecom" })\` 验证。已有 \`task_id\` 就继续查询原任务；仅在明确未提交时，才用原参数和原 \`request_id\` 重试。验证仍不通过就说明原因，不循环要求扫码。
- \`approval_required\` 是当前任务的审批卡，不是登录或应用追加授权。在本机 macOS 直接调用 \`wecom_open_approval\`；\`channel: native\` 表示已请求企微原生小窗，\`external\` 表示使用确认页降级。开启 \`write\` 时，GUI \`main\` 会通过辅助功能自动点击唯一明确的原生确认按钮，无需用户再次审批；随后必须用 \`wecom_read_result\` 查询原任务。系统锁屏或显示器休眠时不能自动点击，解锁后重试原任务即可。工具不会输出审批票据，不要用文本代批或切换通道绕过。
`;

function wrapOpenCodeStorage(storage: StorageDomain): StorageAdapter {
  return {
    get: (key) => storage.get(key),
    set: (key, value) => storage.set(key, value as Parameters<StorageDomain['set']>[1]),
    remove: (key) => storage.remove(key),
    scan: (options) => storage.scan(options),
  };
}

function formatErrorHint(err: unknown): string {
  const code =
    err instanceof WecomError ? err.code : err instanceof Error ? err.message : String(err);
  switch (code) {
    case 'LOGIN_REQUIRED':
    case 'WECOM_TOKEN_REJECTED_LOGIN_REQUIRED':
      return `${code}: 当前未登录或凭据已失效，请运行 /wecom-login 或调用 wecom_login({ mode: "start" }) 扫码登录。`;
    case 'REFRESH_OUTCOME_UNKNOWN_LOGIN_REQUIRED':
      return `${code}: 上一次续期请求网络状态不确定，为避免重放一次性 refresh_token 已中止自动续期，请重新扫码登录。`;
    case 'WECOM_AUTH_REQUIRED_OPEN_WECOM_LOGIN':
      return `${code}: 企业微信授权未完成或已失效。请用同一企业账号在官方页面 ${WECOM_LOGIN_URL} 确认，再运行 wecom_login({ mode: "verify_wecom" }) 检查。`;
    case 'DAYUAN_NOT_AVAILABLE':
      return `${code}: 当前账号的 WorkBuddy 服务未提供可用的大圆接口；请确认企业开通及账号权限。`;
    case 'ENTERPRISE_ACCOUNT_REQUIRED':
      return `${code}: 当前账号缺少企业 ID，请使用企业微信企业账号登录。`;
    case 'APPROVAL_INTERACTION_BLOCKED':
      return `${code}: 审批卡不能用文本回复代批；请调用 wecom_open_approval 处理原审批卡，再查询原任务。`;
    default:
      return code;
  }
}

function formatTaskSummaryText(result: DayuanTaskResult): string {
  const lines = [
    `状态: ${result.state} | 任务 ID: ${result.task_id}${result.from_cache ? ' (缓存)' : ''}`,
    result.is_summary
      ? '说明: 以下内容由大圆 A2A 生成，属于只读摘要而非逐字原始记录。'
      : '说明: 以下为大圆返回的自发测试任务结果。',
  ];
  if (result.summary) {
    lines.push('', result.summary);
  }
  if (result.guidance) {
    lines.push('', `提示: ${result.guidance}`);
  }
  if (result.authorization_url) {
    lines.push('', `授权地址: ${result.authorization_url}`);
  }
  return lines.join('\n');
}

function dayuanAuthorizationResult(err: unknown, taskId?: string) {
  if (!(err instanceof WecomError) || err.code !== 'WECOM_AUTH_REQUIRED_OPEN_WECOM_LOGIN') {
    throw new Error(formatErrorHint(err));
  }
  return {
    output: {
      ...(taskId ? { task_id: taskId } : {}),
      state: 'auth_required',
      interaction_kind: 'authorization_required',
      human_action_required: true,
      authorization_url: WECOM_LOGIN_URL,
    },
    content: formatErrorHint(err),
  };
}

function formatStatusText(status: WorkBuddyStatus, receiptCount: number): string {
  const lines = [
    `WeCom 登录状态: ${status.phase}`,
    `桌面端依赖: 无需安装（desktop_required = false）`,
    `企微 Token 就绪: ${status.wecom_configured ? '是' : '否'}`,
    `近期查询回执: ${receiptCount} 条`,
  ];
  if (status.phase !== 'ready') {
    lines.push('提示: 运行 /wecom-login 获取手机企微扫码链接。');
  }
  return lines.join('\n');
}

const DAYUAN_TASK_RESULT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    task_id: { type: 'string' },
    state: { type: 'string' },
    is_summary: { type: 'boolean' },
    summary: { type: 'string' },
    interaction_kind: { type: 'string' },
    guidance: { type: 'string' },
    authorization_url: { type: 'string' },
    human_action_required: { type: 'boolean' },
    raw_parts_count: { type: 'number' },
    from_cache: { type: 'boolean' },
  },
  additionalProperties: true,
} as const;

export function createWecomPlugin(deps?: WecomPluginDeps) {
  return Plugin.define({
    id: PLUGIN_ID,
    async setup(ctx) {
      const storage = wrapOpenCodeStorage(ctx.storage);
      const write = ctx.options?.write === true;
      const directNative =
        write && process.platform === 'darwin'
          ? createDirectNativeApproval(ctx.app.version)
          : undefined;
      const approvalOpener =
        deps?.approvalOpener ?? ((url: string) => openApprovalUrl(url, directNative));

      let emitAuthChanged: ((status: WorkBuddyStatus) => Promise<void>) | undefined;

      const auth = new WorkBuddyAuth({
        storage,
        transport: deps?.transport,
        clock: deps?.clock,
        onAuthChange: async (status) => {
          if (emitAuthChanged) {
            await emitAuthChanged(status);
          }
        },
      });

      const a2a = new DayuanA2AClient({
        auth,
        storage,
        transport: deps?.transport,
        clock: deps?.clock,
      });

      const rpcReg = await ctx.rpc.register(WecomRpc, {
        async status() {
          const [authStatus, receipts] = await Promise.all([auth.status(), a2a.listReceipts(10)]);
          return {
            auth: authStatus,
            wecom_auth_url: WECOM_LOGIN_URL,
            recent_receipts: receipts,
          };
        },
        async startLogin(_input, callCtx) {
          return auth.start({ signal: callCtx.signal });
        },
        async verifyWecom(_input, callCtx) {
          try {
            return { auth: await auth.verifyWecom(callCtx.signal) };
          } catch (err) {
            throw new Error(formatErrorHint(err));
          }
        },
        async finishLogin(input, callCtx) {
          const raw = input as { wait_seconds?: number } | undefined;
          const waitSeconds = typeof raw?.wait_seconds === 'number' ? raw.wait_seconds : 0;
          const status =
            waitSeconds > 0
              ? await auth.waitForLogin({ waitSeconds, signal: callCtx.signal })
              : await (async () => {
                  await auth.finish({ signal: callCtx.signal });
                  const current = await auth.status();
                  if (current.phase === 'ready') {
                    await auth.ensureWecom({ signal: callCtx.signal });
                  }
                  return auth.status();
                })();
          return { auth: status };
        },
        async logout() {
          const status = await auth.logout();
          return { auth: status };
        },
        async recentReceipts(input) {
          const raw = input as { limit?: number } | undefined;
          const receipts = await a2a.listReceipts(typeof raw?.limit === 'number' ? raw.limit : 20);
          return { receipts };
        },
      });

      emitAuthChanged = async (status) => {
        await rpcReg.events
          .emit('authChanged', {
            phase: status.phase,
            wecom_configured: status.wecom_configured,
          })
          .catch(() => {});
      };

      const toolReg = await ctx.tool.transform((editor) => {
        editor.namespace({
          name: 'wecom',
          description:
            'Enterprise WeChat (WeCom) & Dayuan A2A integration (desktop-free QR auth, chat read/search, opt-in internal messaging and groups, approval handoff).',
        });

        editor.add({
          name: 'wecom_status',
          description:
            'Inspect WeCom / WorkBuddy cloud auth status (zero network calls) and recent Dayuan query receipts.',
          input: {
            type: 'object',
            properties: {
              include_receipts: {
                type: 'boolean',
                description: 'Include recent Dayuan A2A receipts (default true).',
              },
            },
            additionalProperties: false,
          },
          output: {
            type: 'object',
            properties: {
              auth: { type: 'object', additionalProperties: true },
              wecom_auth_url: { type: 'string' },
              recent_receipts: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
            },
            additionalProperties: true,
          },
          options: { namespace: 'wecom', codemode: true },
          async execute(rawInput, _toolCtx) {
            const input = (rawInput ?? {}) as { include_receipts?: boolean };
            const [authStatus, receipts] = await Promise.all([
              auth.status(),
              input.include_receipts === false ? Promise.resolve([]) : a2a.listReceipts(10),
            ]);
            const output = {
              auth: authStatus,
              wecom_auth_url: WECOM_LOGIN_URL,
              recent_receipts: receipts,
            };
            return {
              output,
              content: formatStatusText(authStatus, receipts.length),
            };
          },
        });

        editor.add({
          name: 'wecom_login',
          description:
            'Manage desktop-free WeCom QR login via WorkBuddy cloud: start QR session, wait for scan & WeCom token exchange, get secondary wecom-auth URL, or logout.',
          input: {
            type: 'object',
            properties: {
              mode: {
                type: 'string',
                enum: ['start', 'finish', 'wait', 'wecom_auth', 'verify_wecom', 'logout'],
                description:
                  'start: create/reuse QR login URL; finish: single poll check; wait: poll until scan completes and exchange WeCom token; wecom_auth: return official authorization URL; verify_wecom: recheck user authorization and Dayuan ticket after user confirmation; logout: clear stored credentials.',
              },
              wait_seconds: {
                type: 'number',
                description: 'Max seconds to wait when mode is "wait" (default 60, max 300).',
              },
            },
            additionalProperties: false,
          },
          output: {
            type: 'object',
            properties: {
              authorization_url: { type: 'string' },
              state: { type: 'string' },
              expires_in_seconds: { type: 'number' },
              desktop_required: { type: 'boolean' },
              reused: { type: 'boolean' },
              auth: { type: 'object', additionalProperties: true },
              result: { type: 'object', additionalProperties: true },
            },
            additionalProperties: true,
          },
          options: { namespace: 'wecom', codemode: true },
          async execute(rawInput, toolCtx) {
            const input = (rawInput ?? {}) as {
              mode?: 'start' | 'finish' | 'wait' | 'wecom_auth' | 'verify_wecom' | 'logout';
              wait_seconds?: number;
            };
            const mode = input.mode ?? 'start';
            try {
              if (mode === 'wecom_auth') {
                const info = auth.wecomLoginInfo();
                return {
                  output: info,
                  content: `请在浏览器打开以下企业微信应用授权链接并确认：\n${info.authorization_url}`,
                };
              }
              if (mode === 'verify_wecom') {
                return {
                  output: { auth: await auth.verifyWecom(toolCtx.signal) },
                  content: '企业微信授权和大圆专用票据已验证，尚未发起聊天查询。',
                };
              }
              if (mode === 'logout') {
                const status = await auth.logout();
                return {
                  output: { auth: status },
                  content: '已清除本机保存的 WorkBuddy / 企业微信登录凭据。',
                };
              }
              if (mode === 'start') {
                const started = await auth.start({ signal: toolCtx.signal });
                return {
                  output: started,
                  content: [
                    '请在浏览器打开以下链接，并用手机企业微信扫码确认（无需安装桌面客户端）：',
                    started.authorization_url,
                    '',
                    '扫码确认后，调用 wecom_login({ mode: "wait" }) 即可完成换票。',
                  ].join('\n'),
                };
              }
              if (mode === 'finish') {
                const finishResult = await auth.finish({ signal: toolCtx.signal });
                if (finishResult.phase === 'ready') {
                  await auth.ensureWecom({ signal: toolCtx.signal });
                }
                const status = await auth.status();
                return {
                  output: { result: finishResult, auth: status },
                  content: `当前登录阶段: ${status.phase}，企微凭据就绪: ${status.wecom_configured ? '是' : '否'}`,
                };
              }
              const waitSeconds = typeof input.wait_seconds === 'number' ? input.wait_seconds : 60;
              await toolCtx.progress({ message: '正在等待手机企业微信扫码确认并换取凭据...' });
              const status = await auth.waitForLogin({ waitSeconds, signal: toolCtx.signal });
              return {
                output: { auth: status },
                content:
                  status.phase === 'ready' && status.wecom_configured
                    ? '企业微信登录与换票已完成，后续查询将自动静默续期。'
                    : `当前阶段: ${status.phase}（若仍未完成扫码，请确认已在浏览器完成企微扫码后再试）。`,
              };
            } catch (err) {
              throw new Error(formatErrorHint(err));
            }
          },
        });

        editor.add({
          name: 'wecom_read_start',
          description:
            'Query WeCom through Dayuan: groups, internal chats, history, mentions, unread triage, shared files, or chat contacts. Returns AI-generated summaries, not raw logs.',
          input: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['search_groups', 'read_chat', ...Object.keys(DAYUAN_READ_INSTRUCTIONS)],
                description: 'Read-only Dayuan A2A query action.',
              },
              query: {
                type: 'string',
                description:
                  'Required for search_groups, search_messages, and find_chat_contacts; optional filter for other searches.',
              },
              chat_name: {
                type: 'string',
                description:
                  'Target internal chat name (required for read_chat; optional scope for searches).',
              },
              question: {
                type: 'string',
                description: 'Question to answer from the chat (required for read_chat).',
              },
              time_range: {
                type: 'string',
                description: 'Optional time range hint, e.g. "今天" or "最近3天".',
              },
              limit: {
                type: 'number',
                description: 'Max group candidates for search_groups (1-20).',
              },
              request_id: {
                type: 'string',
                description: 'Optional stable idempotency key to prevent duplicate submissions.',
              },
              wait_seconds: {
                type: 'number',
                description:
                  'Seconds to poll before returning (default 20, 0 for immediate async return).',
              },
            },
            required: ['action'],
            additionalProperties: false,
          },
          output: DAYUAN_TASK_RESULT_OUTPUT_SCHEMA,
          options: { namespace: 'wecom', codemode: true },
          async execute(rawInput, toolCtx) {
            const input = (rawInput ?? {}) as Record<string, unknown>;
            const action = input.action as DayuanAction;
            let typedInput: DayuanReadStartInput;
            if (action === 'search_groups') {
              typedInput = {
                action: 'search_groups',
                query: String(input.query ?? ''),
                limit: typeof input.limit === 'number' ? input.limit : undefined,
                request_id: typeof input.request_id === 'string' ? input.request_id : undefined,
                wait_seconds:
                  typeof input.wait_seconds === 'number' ? input.wait_seconds : undefined,
              };
            } else if (action === 'read_chat') {
              typedInput = {
                action: 'read_chat',
                chat_name: String(input.chat_name ?? ''),
                question: String(input.question ?? ''),
                time_range: typeof input.time_range === 'string' ? input.time_range : undefined,
                request_id: typeof input.request_id === 'string' ? input.request_id : undefined,
                wait_seconds:
                  typeof input.wait_seconds === 'number' ? input.wait_seconds : undefined,
              };
            } else if (Object.hasOwn(DAYUAN_READ_INSTRUCTIONS, action)) {
              typedInput = {
                action: action as keyof typeof DAYUAN_READ_INSTRUCTIONS,
                query: typeof input.query === 'string' ? input.query : undefined,
                chat_name: typeof input.chat_name === 'string' ? input.chat_name : undefined,
                time_range: typeof input.time_range === 'string' ? input.time_range : undefined,
                request_id: typeof input.request_id === 'string' ? input.request_id : undefined,
                wait_seconds:
                  typeof input.wait_seconds === 'number' ? input.wait_seconds : undefined,
              };
            } else {
              throw new Error('INVALID_ACTION');
            }

            try {
              const result = await a2a.start(typedInput, {
                signal: toolCtx.signal,
                onProgress: async (update) => {
                  await toolCtx.progress({
                    task_id: update.task_id,
                    state: update.state,
                    poll_count: update.poll_count,
                  });
                },
              });
              return {
                output: result,
                content: formatTaskSummaryText(result),
              };
            } catch (err) {
              return dayuanAuthorizationResult(err);
            }
          },
        });

        editor.add({
          name: 'wecom_read_result',
          description:
            'Poll or retrieve the cached result of any known Dayuan A2A task by task_id.',
          input: {
            type: 'object',
            properties: {
              task_id: { type: 'string', description: 'Task ID returned by wecom_read_start.' },
              wait_seconds: {
                type: 'number',
                description: 'Seconds to poll before returning (default 20).',
              },
            },
            required: ['task_id'],
            additionalProperties: false,
          },
          output: DAYUAN_TASK_RESULT_OUTPUT_SCHEMA,
          options: { namespace: 'wecom', codemode: true },
          async execute(rawInput, toolCtx) {
            const input = (rawInput ?? {}) as { task_id: string; wait_seconds?: number };
            try {
              const result = await a2a.getResult(
                { task_id: input.task_id, wait_seconds: input.wait_seconds },
                {
                  signal: toolCtx.signal,
                  onProgress: async (update) => {
                    await toolCtx.progress({
                      task_id: update.task_id,
                      state: update.state,
                      poll_count: update.poll_count,
                    });
                  },
                },
              );
              return {
                output: result,
                content: formatTaskSummaryText(result),
              };
            } catch (err) {
              return dayuanAuthorizationResult(err, input.task_id);
            }
          },
        });

        editor.add({
          name: 'wecom_cancel_task',
          description:
            'Best-effort cancel of an existing Dayuan A2A task. Use only when the user asks to cancel; terminal-task failures are final and must not be retried.',
          input: {
            type: 'object',
            properties: {
              task_id: { type: 'string', description: 'Existing Dayuan task ID.' },
            },
            required: ['task_id'],
            additionalProperties: false,
          },
          output: DAYUAN_TASK_RESULT_OUTPUT_SCHEMA,
          options: { namespace: 'wecom', codemode: true },
          async execute(rawInput, toolCtx) {
            const taskId = (rawInput as { task_id: string }).task_id;
            try {
              const result = await a2a.cancelTask(taskId, { signal: toolCtx.signal });
              return { output: result, content: formatTaskSummaryText(result) };
            } catch (err) {
              return dayuanAuthorizationResult(err, taskId);
            }
          },
        });

        editor.add({
          name: 'wecom_read_reply',
          description:
            'Send a plain-text clarification reply to a Dayuan A2A task in input_required state. Automatically blocks approval cards for safety.',
          input: {
            type: 'object',
            properties: {
              task_id: {
                type: 'string',
                description: 'Task ID waiting for plain-text clarification.',
              },
              text: { type: 'string', description: 'Clarification text to send.' },
              request_id: { type: 'string', description: 'Optional message idempotency key.' },
              wait_seconds: {
                type: 'number',
                description: 'Seconds to wait after replying (default 20).',
              },
            },
            required: ['task_id', 'text'],
            additionalProperties: false,
          },
          output: DAYUAN_TASK_RESULT_OUTPUT_SCHEMA,
          options: { namespace: 'wecom', codemode: true },
          async execute(rawInput, toolCtx) {
            const input = (rawInput ?? {}) as {
              task_id: string;
              text: string;
              request_id?: string;
              wait_seconds?: number;
            };
            try {
              const result = await a2a.reply(input, {
                signal: toolCtx.signal,
                onProgress: async (update) => {
                  await toolCtx.progress({
                    task_id: update.task_id,
                    state: update.state,
                    poll_count: update.poll_count,
                  });
                },
              });
              return {
                output: result,
                content: formatTaskSummaryText(result),
              };
            } catch (err) {
              return dayuanAuthorizationResult(err, input.task_id);
            }
          },
        });

        if (write) {
          editor.add({
            name: 'wecom_send_message',
            description:
              'Send one explicit user-requested text message through Dayuan to the signed-in user or one exactly named internal WeCom single/group chat. Supports HTTPS file parts. Handle approval through wecom_open_approval; write enables GUI auto-confirmation.',
            input: {
              type: 'object',
              properties: {
                target_type: { type: 'string', enum: ['self', 'single', 'group'] },
                target_name: {
                  type: 'string',
                  description: 'Exact chat name; required for single/group and forbidden for self.',
                },
                text: { type: 'string' },
                attachments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      url: {
                        type: 'string',
                        description: 'HTTPS file URL; never fetched locally.',
                      },
                      filename: { type: 'string' },
                      media_type: { type: 'string' },
                    },
                    required: ['url'],
                    additionalProperties: false,
                  },
                },
                request_id: {
                  type: 'string',
                  description: 'Stable idempotency ID, 1–48 letters, digits or hyphens.',
                },
                wait_seconds: { type: 'number' },
              },
              required: ['target_type', 'text', 'request_id'],
              additionalProperties: false,
            },
            output: DAYUAN_TASK_RESULT_OUTPUT_SCHEMA,
            options: { namespace: 'wecom', codemode: true },
            async execute(rawInput, toolCtx) {
              try {
                const result = await a2a.sendMessage(
                  rawInput as Parameters<DayuanA2AClient['sendMessage']>[0],
                  { signal: toolCtx.signal },
                );
                return { output: result, content: formatTaskSummaryText(result) };
              } catch (err) {
                return dayuanAuthorizationResult(err);
              }
            },
          });

          editor.add({
            name: 'wecom_create_group',
            description:
              'Create one explicitly requested internal WeCom group through Dayuan with exactly named members. Stops on ambiguous or external members. Handle approval through wecom_open_approval; write enables GUI auto-confirmation.',
            input: {
              type: 'object',
              properties: {
                group_name: { type: 'string' },
                members: { type: 'array', items: { type: 'string' } },
                request_id: {
                  type: 'string',
                  description: 'Stable idempotency ID, 1–48 letters, digits or hyphens.',
                },
                wait_seconds: { type: 'number' },
              },
              required: ['group_name', 'members', 'request_id'],
              additionalProperties: false,
            },
            output: DAYUAN_TASK_RESULT_OUTPUT_SCHEMA,
            options: { namespace: 'wecom', codemode: true },
            async execute(rawInput, toolCtx) {
              try {
                const result = await a2a.createGroup(
                  rawInput as Parameters<DayuanA2AClient['createGroup']>[0],
                  { signal: toolCtx.signal },
                );
                return { output: result, content: formatTaskSummaryText(result) };
              } catch (err) {
                return dayuanAuthorizationResult(err);
              }
            },
          });
        }

        if (write) {
          editor.add({
            name: 'wecom_test_send_self',
            description:
              'Send one fixed test message to the signed-in user only. Use only when the user asks to test sending. Handle approval through wecom_open_approval; write enables GUI auto-confirmation.',
            input: {
              type: 'object',
              properties: {
                request_id: {
                  type: 'string',
                  description: 'Stable test ID, 1–48 letters, digits or hyphens.',
                },
              },
              required: ['request_id'],
              additionalProperties: false,
            },
            output: DAYUAN_TASK_RESULT_OUTPUT_SCHEMA,
            options: { namespace: 'wecom', codemode: true },
            async execute(rawInput, toolCtx) {
              const input = rawInput as { request_id: string };
              try {
                const result = await a2a.testSendSelf(input.request_id, { signal: toolCtx.signal });
                return { output: result, content: formatTaskSummaryText(result) };
              } catch (err) {
                return dayuanAuthorizationResult(err);
              }
            },
          });
        }

        if (write) {
          editor.add({
            name: 'wecom_open_approval',
            description:
              'Open the native WeCom confirmation panel for an existing approval task when available, with the external confirmation page as fallback. With write enabled, GUI main confirms the native panel through macOS Accessibility. Never returns the approval token.',
            input: {
              type: 'object',
              properties: {
                task_id: { type: 'string', description: 'Existing task awaiting approval.' },
              },
              required: ['task_id'],
              additionalProperties: false,
            },
            output: {
              type: 'object',
              properties: {
                task_id: { type: 'string' },
                opened: { type: 'boolean' },
                channel: { type: 'string', enum: ['native', 'external'] },
              },
              required: ['task_id', 'opened', 'channel'],
              additionalProperties: false,
            },
            options: { namespace: 'wecom', codemode: true },
            async execute(rawInput, toolCtx) {
              const taskId = (rawInput as { task_id: string }).task_id;
              const url = await a2a.getApprovalUrl(taskId, { signal: toolCtx.signal });
              const channel = await approvalOpener(url);
              return {
                output: { task_id: taskId, opened: true, channel },
                content:
                  channel === 'native'
                    ? write
                      ? '已请求企业微信原生小窗并启动自动确认，请查询原任务确认终态。'
                      : '已请求企业微信弹出确认小窗，请本人确认后查询原任务。'
                    : '已打开企业微信确认页，请本人确认后查询原任务。',
              };
            },
          });
        }
      });

      const cmdReg = await ctx.command.transform((editor) => {
        editor.add({
          name: 'wecom-login',
          description: 'Generate a desktop-free WeCom QR login link via WorkBuddy cloud',
          async execute(invocation) {
            const started = await auth.start();
            await ctx.session.synthetic({
              sessionID: invocation.sessionID,
              description: 'WeCom QR Login',
              resume: false,
              text: [
                '请在浏览器打开以下链接，并用手机企业微信扫码确认（无需安装桌面客户端）：',
                started.authorization_url,
                '',
                '扫码完成后，告诉助手「我已扫码」或调用 `wecom_login({ mode: "wait" })` 完成换票。',
              ].join('\n'),
            });
          },
        });

        editor.add({
          name: 'wecom-status',
          description: 'Show current WeCom / Dayuan A2A connection status',
          async execute(invocation) {
            const [authStatus, receipts] = await Promise.all([auth.status(), a2a.listReceipts(5)]);
            await ctx.session.synthetic({
              sessionID: invocation.sessionID,
              description: 'WeCom Status',
              resume: false,
              text: formatStatusText(authStatus, receipts.length),
            });
          },
        });

        editor.add({
          name: 'wecom-logout',
          description: 'Clear stored WorkBuddy & WeCom credentials',
          async execute(invocation) {
            await auth.logout();
            await ctx.session.synthetic({
              sessionID: invocation.sessionID,
              description: 'WeCom Logout',
              resume: false,
              text: '已清除本机保存的 WorkBuddy / 企业微信登录凭据。',
            });
          },
        });
      });

      const skillReg = await ctx.skill.transform((editor) => {
        editor.add({
          id: 'wecom-dayuan' as Skill.ID,
          name: 'wecom-dayuan' as Skill.Name,
          description:
            '企业微信大圆 A2A 只读群聊摘要与无桌面端扫码登录规范（含审批卡原生确认与幂等回执要求）。',
          autoinvoke: false,
          path: '/embedded/opencode-plugin-wecom/wecom-dayuan/SKILL.md' as Skill.Info['path'],
          content: EMBEDDED_SKILL_CONTENT,
        });
      });

      return async () => {
        directNative?.dispose();
        await Promise.allSettled([
          rpcReg.dispose(),
          toolReg.dispose(),
          cmdReg.dispose(),
          skillReg.dispose(),
        ]);
      };
    },
  });
}

export default createWecomPlugin();
export { DayuanA2AClient } from './a2a/client.js';
export {
  formatLoginUrl,
  WECOM_LOGIN_URL,
  WORKBUDDY_ORIGIN,
  WorkBuddyAuth,
} from './auth/workbuddy.js';
export { PLUGIN_ID, WecomRpc } from './rpc.js';
export { WecomError } from './types.js';
