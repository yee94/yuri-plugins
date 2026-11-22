import { Plugin, type Skill } from '@opencode/plugin';
import type { StorageDomain } from '@opencode/plugin/promise/storage';
import {
  DayuanA2AClient,
  type DayuanAction,
  type DayuanReadStartInput,
  type DayuanTaskResult,
} from './a2a/client.js';
import { WECOM_LOGIN_URL, WorkBuddyAuth, type WorkBuddyStatus } from './auth/workbuddy.js';
import { PLUGIN_ID, WecomRpc } from './rpc.js';
import type { Clock, HttpTransport, StorageAdapter } from './types.js';
import { WecomError } from './types.js';
import {
  ALLOWED_CLI_DOMAINS,
  type ProcessRunner,
  WecomCliBridge,
  type WecomCliDomain,
} from './wecom/cli.js';

export interface WecomPluginDeps {
  readonly transport?: HttpTransport;
  readonly clock?: Clock;
  readonly cliRunner?: ProcessRunner;
}

const EMBEDDED_SKILL_CONTENT = `---
name: wecom-dayuan
description: 使用 opencode-plugin-wecom 零客户端依赖地连接企业微信（WorkBuddy 扫码换票 + 大圆 A2A 只读群聊摘要 + 可选 @wecom/cli 办公域）。
---

# 企业微信（WeCom / 大圆）使用规范

## 1. 登录与凭据
- 本插件**不需要**安装 WorkBuddy 桌面端或企业微信桌面端，只需要用手机企业微信扫码一次。
- 调用查询前可先用 \`wecom_status\` 检查状态（零网络请求）。
- 若未登录或遇到 \`LOGIN_REQUIRED\` / \`REFRESH_OUTCOME_UNKNOWN_LOGIN_REQUIRED\`，调用 \`wecom_login({ mode: "start" })\` 把 \`authorization_url\` 给用户，引导用户在浏览器打开并用手机企微扫码，随后调用 \`wecom_login({ mode: "wait", wait_seconds: 60 })\` 完成换票。
- 若遇到 \`WECOM_AUTH_REQUIRED_OPEN_WECOM_LOGIN\`，说明企业微信应用尚未在云端授权，请引导用户打开 \`${WECOM_LOGIN_URL}\` 完成授权。

## 2. 大圆 A2A 只读边界
- \`wecom_read_start\` / \`wecom_read_result\` / \`wecom_read_reply\` 仅支持只读查群、读群聊摘要和搜消息摘要。
- **返回值是大圆生成的摘要（\`is_summary: true\`），不是逐字原始聊天记录**，请如实向用户说明。
- 建议传稳定的 \`request_id\` 保证幂等；遇到 \`SUBMIT_OUTCOME_UNKNOWN\` 不要盲目重试同一请求。
- 当任务返回 \`interaction_kind === "text_clarification"\` 时，可用 \`wecom_read_reply\` 补充澄清。
- 当任务返回 \`interaction_kind === "approval_required"\` 时，**必须停下并告知用户在手机企业微信手动审批**，严禁尝试自动通过。

## 3. 结构化办公域（可选）
- 若用户需要查文档、智能表格、日程、会议、邮件、微盘或通讯录，且已安装 \`@wecom/cli\`，可调用 \`wecom_cli\`（默认仅允许只读子命令）。
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
      return `${code}: WorkBuddy 账号已登录，但尚未完成企业微信应用授权。请在浏览器打开 ${WECOM_LOGIN_URL} 完成授权后重试。`;
    case 'ENTERPRISE_ACCOUNT_REQUIRED':
      return `${code}: 当前账号缺少企业 ID，请使用企业微信企业账号登录。`;
    case 'APPROVAL_INTERACTION_BLOCKED':
      return `${code}: 该任务触发了企业微信敏感审批卡片，插件严禁代批，请用户在手机企业微信手动处理。`;
    case 'WECOM_CLI_NOT_INSTALLED':
      return `${code}: 未检测到 @wecom/cli。如需使用文档/日程/会议等办公域能力，请先执行 npm install -g @wecom/cli。`;
    case 'WECOM_CLI_WRITE_BLOCKED':
      return `${code}: wecom_cli 默认处于只读模式。如需启用写命令，请在 opencode.json 的插件 options 中显式设置 "allowCliWrite": true。`;
    default:
      return code;
  }
}

function formatTaskSummaryText(result: DayuanTaskResult): string {
  const lines = [
    `状态: ${result.state} | 任务 ID: ${result.task_id}${result.from_cache ? ' (缓存)' : ''}`,
    '说明: 以下内容由大圆 A2A 生成，属于只读摘要而非逐字原始记录。',
  ];
  if (result.summary) {
    lines.push('', result.summary);
  }
  if (result.guidance) {
    lines.push('', `提示: ${result.guidance}`);
  }
  return lines.join('\n');
}

function formatStatusText(
  status: WorkBuddyStatus,
  cliAvailable: boolean,
  receiptCount: number,
): string {
  const lines = [
    `WeCom 登录状态: ${status.phase}`,
    `桌面端依赖: 无需安装（desktop_required = false）`,
    `企微 Token 就绪: ${status.wecom_configured ? '是' : '否'}`,
    `可选 @wecom/cli: ${cliAvailable ? '已安装' : '未安装（不影响大圆 A2A 查群）'}`,
    `近期查询回执: ${receiptCount} 条`,
  ];
  if (status.phase !== 'ready') {
    lines.push('提示: 运行 /wecom-login 获取手机企微扫码链接。');
  }
  return lines.join('\n');
}

export function createWecomPlugin(deps?: WecomPluginDeps) {
  return Plugin.define({
    id: PLUGIN_ID,
    async setup(ctx) {
      const storage = wrapOpenCodeStorage(ctx.storage);
      const cliBinary =
        typeof ctx.options?.cliBinary === 'string' ? ctx.options.cliBinary : undefined;
      const allowCliWrite = ctx.options?.allowCliWrite === true;
      const enableCliTool = ctx.options?.enableCliTool !== false;

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

      const cli = new WecomCliBridge({
        binary: cliBinary,
        allowWrite: allowCliWrite,
        runner: deps?.cliRunner,
      });

      const rpcReg = await ctx.rpc.register(WecomRpc, {
        async status(_input, callCtx) {
          const [authStatus, cliProbe, receipts] = await Promise.all([
            auth.status(),
            cli.probe(callCtx.signal),
            a2a.listReceipts(10),
          ]);
          return {
            auth: authStatus,
            wecom_auth_url: WECOM_LOGIN_URL,
            cli: cliProbe,
            recent_receipts: receipts,
          };
        },
        async startLogin(_input, callCtx) {
          return auth.start({ signal: callCtx.signal });
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
            'Enterprise WeChat (WeCom) & Dayuan A2A read-only integration (desktop-free QR auth, group/chat summary queries, optional @wecom/cli office bridge).',
        });

        editor.add({
          name: 'wecom_status',
          description:
            'Inspect WeCom / WorkBuddy cloud auth status (zero network calls), optional @wecom/cli availability, and recent Dayuan query receipts.',
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
          options: { namespace: 'wecom', codemode: true },
          async execute(rawInput, toolCtx) {
            const input = (rawInput ?? {}) as { include_receipts?: boolean };
            const [authStatus, cliProbe, receipts] = await Promise.all([
              auth.status(),
              cli.probe(toolCtx.signal),
              input.include_receipts === false ? Promise.resolve([]) : a2a.listReceipts(10),
            ]);
            const output = {
              auth: authStatus,
              wecom_auth_url: WECOM_LOGIN_URL,
              cli: cliProbe,
              recent_receipts: receipts,
            };
            return {
              output,
              content: formatStatusText(authStatus, cliProbe.available, receipts.length),
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
                enum: ['start', 'finish', 'wait', 'wecom_auth', 'logout'],
                description:
                  'start: create/reuse QR login URL; finish: single poll check; wait: poll until scan completes and exchange WeCom token; wecom_auth: return secondary WeCom authorization URL; logout: clear stored credentials.',
              },
              wait_seconds: {
                type: 'number',
                description: 'Max seconds to wait when mode is "wait" (default 60, max 300).',
              },
            },
            additionalProperties: false,
          },
          options: { namespace: 'wecom', codemode: true },
          async execute(rawInput, toolCtx) {
            const input = (rawInput ?? {}) as {
              mode?: 'start' | 'finish' | 'wait' | 'wecom_auth' | 'logout';
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
            'Start a strictly read-only Dayuan A2A query (search_groups, read_chat, or search_messages). Returns AI-generated summaries (is_summary: true), never raw verbatim logs.',
          input: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['search_groups', 'read_chat', 'search_messages'],
                description: 'Read-only Dayuan A2A query action.',
              },
              query: {
                type: 'string',
                description: 'Search keyword for search_groups or search_messages.',
              },
              chat_name: {
                type: 'string',
                description:
                  'Target group/chat name (required for read_chat, optional scope for search_messages).',
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
            } else if (action === 'search_messages') {
              typedInput = {
                action: 'search_messages',
                query: String(input.query ?? ''),
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
              throw new Error(formatErrorHint(err));
            }
          },
        });

        editor.add({
          name: 'wecom_read_result',
          description:
            'Poll or retrieve the cached result of a Dayuan A2A read-only task by task_id.',
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
              throw new Error(formatErrorHint(err));
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
              throw new Error(formatErrorHint(err));
            }
          },
        });

        if (enableCliTool) {
          editor.add({
            name: 'wecom_cli',
            description:
              'Optional bridge to official @wecom/cli for structured office domains (doc, smartsheet, calendar, meeting, mail, wedrive, contact, auth). Read-only by default.',
            input: {
              type: 'object',
              properties: {
                domain: {
                  type: 'string',
                  enum: [...ALLOWED_CLI_DOMAINS],
                  description: 'Allowed @wecom/cli office domain.',
                },
                args: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'Subcommand and flags passed directly to the wecom CLI (no shell interpolation).',
                },
                timeout_ms: {
                  type: 'number',
                  description: 'Optional execution timeout in milliseconds (default 30000).',
                },
              },
              required: ['domain', 'args'],
              additionalProperties: false,
            },
            options: { namespace: 'wecom', codemode: true },
            async execute(rawInput, toolCtx) {
              const input = (rawInput ?? {}) as {
                domain: WecomCliDomain;
                args: string[];
                timeout_ms?: number;
              };
              try {
                const res = await cli.run(input, toolCtx.signal);
                return {
                  output: res,
                  content: res.ok
                    ? res.stdout.trim() || JSON.stringify(res.data ?? { ok: true })
                    : `wecom ${input.domain} 退出码 ${res.exit_code}: ${res.stderr.trim() || res.stdout.trim()}`,
                };
              } catch (err) {
                throw new Error(formatErrorHint(err));
              }
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
            const [authStatus, cliProbe, receipts] = await Promise.all([
              auth.status(),
              cli.probe(),
              a2a.listReceipts(5),
            ]);
            await ctx.session.synthetic({
              sessionID: invocation.sessionID,
              description: 'WeCom Status',
              resume: false,
              text: formatStatusText(authStatus, cliProbe.available, receipts.length),
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
            '企业微信大圆 A2A 只读群聊摘要与无桌面端扫码登录规范（含审批卡人工拦截与幂等回执要求）。',
          autoinvoke: false,
          path: '/embedded/opencode-plugin-wecom/wecom-dayuan/SKILL.md' as Skill.Info['path'],
          content: EMBEDDED_SKILL_CONTENT,
        });
      });

      return async () => {
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
export { ALLOWED_CLI_DOMAINS, WecomCliBridge } from './wecom/cli.js';
