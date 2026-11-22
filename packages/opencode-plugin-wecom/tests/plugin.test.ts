import type { Plugin } from '@opencode/plugin';
import { describe, expect, it } from 'vitest';
import { createWecomPlugin } from '../src/index.js';
import { WecomRpc } from '../src/rpc.js';
import {
  createFakeClock,
  createFakeTransport,
  createMemoryStorage,
  jsonResponse,
} from './helpers.js';

interface RegisteredTool {
  name: string;
  execute: (
    input: unknown,
    ctx: {
      sessionID: string;
      agent: string;
      messageID: string;
      id: string;
      signal: AbortSignal;
      progress: (update: Record<string, unknown>) => Promise<void>;
    },
  ) => Promise<{ output: Record<string, unknown>; content?: string }>;
}

interface RegisteredCommand {
  name: string;
  execute: (input: {
    sessionID: string;
    prompt: Record<string, unknown>;
    delivery: string;
  }) => Promise<void>;
}

type RpcHandlerFn = (
  input: unknown,
  ctx: { signal: AbortSignal },
) => Promise<Record<string, unknown>>;

function createMockPluginContext(options: Record<string, unknown> = {}) {
  const storage = createMemoryStorage();
  const tools = new Map<string, RegisteredTool>();
  const namespaces: { name: string; description: string }[] = [];
  const commands = new Map<string, RegisteredCommand>();
  const skills = new Map<string, { id: string }>();
  const synthetics: { sessionID: string; text: string }[] = [];
  const rpcEmitted: { name: string; data: unknown }[] = [];
  let rpcRegistered: { definition: unknown; handlers: Record<string, RpcHandlerFn> } | undefined;
  let disposedCount = 0;

  const makeDisposable = () => ({
    dispose: async () => {
      disposedCount += 1;
    },
  });

  const ctx = {
    options,
    storage,
    tool: {
      transform: async (fn: (editor: unknown) => void) => {
        fn({
          namespace: (ns: { name: string; description: string }) => namespaces.push(ns),
          add: (tool: RegisteredTool) => tools.set(tool.name, tool),
          list: () => [...tools.values()],
          get: (id: string) => tools.get(id),
          update: () => {},
          remove: (id: string) => tools.delete(id),
        });
        return makeDisposable();
      },
      reload: async () => {},
    },
    command: {
      transform: async (fn: (editor: unknown) => void) => {
        fn({
          add: (cmd: RegisteredCommand) => commands.set(cmd.name, cmd),
        });
        return makeDisposable();
      },
      reload: async () => {},
    },
    skill: {
      transform: async (fn: (editor: unknown) => void) => {
        fn({
          add: (skill: { id: string }) => skills.set(skill.id, skill),
          list: () => [...skills.values()],
          get: (id: string) => skills.get(id),
          update: () => {},
          remove: (id: string) => skills.delete(id),
        });
        return makeDisposable();
      },
      reload: async () => {},
    },
    rpc: {
      register: async (definition: unknown, handlers: Record<string, RpcHandlerFn>) => {
        rpcRegistered = { definition, handlers };
        return {
          ...makeDisposable(),
          events: {
            emit: async (name: string, data: unknown) => {
              rpcEmitted.push({ name, data });
            },
          },
        };
      },
    },
    session: {
      synthetic: async (input: { sessionID: string; text: string }) => {
        synthetics.push(input);
        return { id: 'syn_1' };
      },
    },
  };

  return {
    ctx: ctx as unknown as Plugin.Context,
    tools,
    namespaces,
    commands,
    skills,
    synthetics,
    rpcEmitted,
    get rpcRegistered() {
      return rpcRegistered;
    },
    get disposedCount() {
      return disposedCount;
    },
  };
}

function makeToolContext() {
  const controller = new AbortController();
  const progress: Record<string, unknown>[] = [];
  return {
    context: {
      sessionID: 'ses_test',
      agent: 'default',
      messageID: 'msg_1',
      id: 'call_1',
      signal: controller.signal,
      progress: async (update: Record<string, unknown>) => {
        progress.push(update);
      },
    },
    progress,
    controller,
  };
}

describe('opencode-plugin-wecom server plugin integration', () => {
  it('registers tools, commands, skill, and RPC handlers, and executes end-to-end login + Dayuan query', async () => {
    const clock = createFakeClock(1_700_000_000_000);
    let pollCount = 0;

    const { transport } = createFakeTransport((req) => {
      if (req.url.endsWith('/v2/plugin/auth/state?platform=workbuddy')) {
        return jsonResponse({
          code: 0,
          data: { state: 'st_e2e', authUrl: 'https://www.workbuddy.cn/login?state=st_e2e' },
        });
      }
      if (req.url.endsWith('/v2/plugin/auth/token?state=st_e2e')) {
        return jsonResponse({
          code: 0,
          data: { accessToken: 'wb_e2e', refreshToken: 'wb_ref_e2e', expiresIn: 3600 },
        });
      }
      if (req.url.endsWith('/v2/plugin/account')) {
        return jsonResponse({ code: 0, data: { uid: 'u_e2e', enterpriseId: 'ent_e2e' } });
      }
      if (req.url.endsWith('/console/enterprises/ent_e2e/oneid_openapi/exchange-wecom-token')) {
        return jsonResponse({
          code: 0,
          data: {
            access_token: 'wc_e2e',
            alias_id: 'alice',
            src_tid: 'corp_e2e',
            expires_in: 7200,
          },
        });
      }
      if (req.url === 'https://qyapi.weixin.qq.com/cgi-bin/a2a/api/message:send') {
        return jsonResponse({
          id: 'task_e2e',
          contextId: 'ctx_e2e',
          status: { state: 'working' },
        });
      }
      if (
        req.url === 'https://qyapi.weixin.qq.com/cgi-bin/a2a/api/tasks/task_e2e?historyLength=0'
      ) {
        pollCount += 1;
        return jsonResponse({
          id: 'task_e2e',
          contextId: 'ctx_e2e',
          status: {
            state: 'completed',
            message: {
              role: 'agent',
              parts: [{ kind: 'text', text: '项目群结论：明天上午联调。' }],
            },
          },
        });
      }
      throw new Error(`unexpected ${req.method} ${req.url}`);
    });

    const cliRunner = async (_bin: string, args: readonly string[]) => {
      if (args[0] === '--version') return { exitCode: 0, stdout: '1.0.0', stderr: '' };
      return { exitCode: 0, stdout: JSON.stringify({ docs: ['Spec.md'] }), stderr: '' };
    };

    const plugin = createWecomPlugin({ transport, clock, cliRunner });
    expect(plugin.id).toBe('opencode-plugin-wecom');

    const mock = createMockPluginContext();
    const cleanup = await plugin.setup(mock.ctx);

    expect(mock.namespaces.map((n) => n.name)).toContain('wecom');
    expect([...mock.tools.keys()].sort()).toEqual([
      'wecom_cli',
      'wecom_login',
      'wecom_read_reply',
      'wecom_read_result',
      'wecom_read_start',
      'wecom_status',
    ]);
    expect([...mock.commands.keys()].sort()).toEqual([
      'wecom-login',
      'wecom-logout',
      'wecom-status',
    ]);
    expect(mock.skills.has('wecom-dayuan')).toBe(true);
    expect(mock.rpcRegistered?.definition).toBe(WecomRpc);

    // 1. Initial status is logged_out
    const statusBefore = await mock.tools
      .get('wecom_status')
      ?.execute({}, makeToolContext().context);
    expect((statusBefore?.output.auth as { phase: string }).phase).toBe('logged_out');
    expect((statusBefore?.output.cli as { available: boolean }).available).toBe(true);

    // 2. Start QR login
    const startRes = await mock.tools
      .get('wecom_login')
      ?.execute({ mode: 'start' }, makeToolContext().context);
    expect(startRes?.output.authorization_url).toBe(
      'https://www.workbuddy.cn/login?state=st_e2e&version=5.8.2&force_login_type=wecom',
    );

    // 3. Complete login via wait
    const waitRes = await mock.tools
      .get('wecom_login')
      ?.execute({ mode: 'wait', wait_seconds: 10 }, makeToolContext().context);
    expect((waitRes?.output.auth as { phase: string }).phase).toBe('ready');
    expect((waitRes?.output.auth as { wecom_configured: boolean }).wecom_configured).toBe(true);
    expect(mock.rpcEmitted.some((e) => e.name === 'authChanged')).toBe(true);

    // 4. Query Dayuan A2A with progress reporting
    const tc = makeToolContext();
    const readRes = await mock.tools.get('wecom_read_start')?.execute(
      {
        action: 'read_chat',
        chat_name: '项目群',
        question: '今天结论是什么',
        wait_seconds: 10,
      },
      tc.context,
    );
    expect(pollCount).toBe(1);
    expect(tc.progress.length).toBeGreaterThan(0);
    expect(readRes?.output.state).toBe('completed');
    expect(readRes?.output.is_summary).toBe(true);
    expect(readRes?.output.summary).toContain('明天上午联调');

    // 5. Optional @wecom/cli tool works
    const cliRes = await mock.tools
      .get('wecom_cli')
      ?.execute({ domain: 'doc', args: ['list'] }, makeToolContext().context);
    expect(cliRes?.output.data).toEqual({ docs: ['Spec.md'] });

    // 6. RPC status & recentReceipts work for GUI/TUI
    const rpcStatus = await mock.rpcRegistered?.handlers.status?.(
      {},
      { signal: new AbortController().signal },
    );
    expect((rpcStatus?.auth as { phase: string }).phase).toBe('ready');
    expect(rpcStatus?.recent_receipts).toHaveLength(1);

    // 7. Slash commands emit synthetic session feedback
    await mock.commands
      .get('wecom-status')
      ?.execute({ sessionID: 'ses_1', prompt: {}, delivery: 'queue' });
    expect(mock.synthetics).toHaveLength(1);
    expect(mock.synthetics[0]?.text).toContain('ready');

    await mock.commands
      .get('wecom-logout')
      ?.execute({ sessionID: 'ses_1', prompt: {}, delivery: 'queue' });
    const statusAfterLogout = await mock.rpcRegistered?.handlers.status?.(
      {},
      { signal: new AbortController().signal },
    );
    expect((statusAfterLogout?.auth as { phase: string }).phase).toBe('logged_out');

    // 8. Cleanup disposes all 4 registrations
    if (typeof cleanup === 'function') await cleanup();
    expect(mock.disposedCount).toBe(4);
  });

  it('respects enableCliTool=false, supports wecom_auth mode, /wecom-login command, and blocks approval replies', async () => {
    const clock = createFakeClock(1_700_000_000_000);
    const { transport } = createFakeTransport((req) => {
      if (req.url.endsWith('/v2/plugin/auth/state?platform=workbuddy')) {
        return jsonResponse({
          code: 0,
          data: { state: 'st_2', authUrl: 'https://www.workbuddy.cn/login?state=st_2' },
        });
      }
      if (req.url.endsWith('/v2/plugin/auth/token?state=st_2')) {
        return jsonResponse({
          code: 0,
          data: { accessToken: 'wb_2', refreshToken: 'wb_ref_2', expiresIn: 3600 },
        });
      }
      if (req.url.endsWith('/v2/plugin/account')) {
        return jsonResponse({ code: 0, data: { uid: 'u_2', enterpriseId: 'ent_2' } });
      }
      if (req.url.endsWith('/console/enterprises/ent_2/oneid_openapi/exchange-wecom-token')) {
        return jsonResponse({
          code: 0,
          data: { access_token: 'wc_2', alias_id: 'alice', src_tid: 'corp_2', expires_in: 7200 },
        });
      }
      if (req.url.endsWith('/message:send')) {
        return jsonResponse({
          id: 'task_apv',
          contextId: 'ctx_apv',
          status: {
            state: 'input_required',
            message: {
              role: 'agent',
              parts: [
                {
                  kind: 'data',
                  metadata: { wecom_part_type: 'approval' },
                  data: { token_id_list: ['t1'] },
                },
              ],
            },
          },
        });
      }
      throw new Error(`unexpected ${req.url}`);
    });

    const plugin = createWecomPlugin({ transport, clock });
    const mock = createMockPluginContext({ enableCliTool: false });
    await plugin.setup(mock.ctx);

    expect(mock.tools.has('wecom_cli')).toBe(false);

    const wecomAuthInfo = await mock.tools
      .get('wecom_login')
      ?.execute({ mode: 'wecom_auth' }, makeToolContext().context);
    expect(wecomAuthInfo?.output.authorization_url).toBe(
      'https://www.workbuddy.cn/login/wecom-auth',
    );

    await mock.commands
      .get('wecom-login')
      ?.execute({ sessionID: 'ses_2', prompt: {}, delivery: 'queue' });
    expect(mock.synthetics[0]?.text).toContain('force_login_type=wecom');

    await mock.tools.get('wecom_login')?.execute({ mode: 'finish' }, makeToolContext().context);
    const apvStart = await mock.tools
      .get('wecom_read_start')
      ?.execute(
        { action: 'read_chat', chat_name: '敏感群', question: '总结' },
        makeToolContext().context,
      );
    expect(apvStart?.output.interaction_kind).toBe('approval_required');

    await expect(
      mock.tools
        .get('wecom_read_reply')
        ?.execute({ task_id: 'task_apv', text: '批准' }, makeToolContext().context),
    ).rejects.toThrow('APPROVAL_INTERACTION_BLOCKED');
  });
});
