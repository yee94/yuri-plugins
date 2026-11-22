import { describe, expect, it } from 'vitest';
import { DayuanA2AClient } from '../src/a2a/client.js';
import type { DayuanCredential } from '../src/auth/workbuddy.js';
import { WecomError } from '../src/types.js';
import {
  createFakeClock,
  createFakeTransport,
  createMemoryStorage,
  jsonResponse,
} from './helpers.js';

function createFakeAuthProvider(tokens: string[] = ['wc_tok_1']) {
  let idx = 0;
  let forceCalls = 0;
  return {
    get forceCalls() {
      return forceCalls;
    },
    async ensureDayuan(options?: { force?: boolean }): Promise<DayuanCredential> {
      if (options?.force) {
        forceCalls += 1;
        idx = Math.min(idx + 1, tokens.length - 1);
      }
      return {
        access_token: tokens[idx] ?? tokens[0] ?? 'wc_tok_fallback',
        identity: 'id_hash_alice',
        expires_at_ms: 1_900_000_000_000,
        endpoint: 'https://qyapi.weixin.qq.com/cgi-bin/a2a/api',
        headers: {},
      };
    },
  };
}

describe('DayuanA2AClient — read-only queries, polling, and caching', () => {
  it('pauses on additional authorization and resumes the same task without submitting again', async () => {
    const { transport, requests } = createFakeTransport((req) =>
      jsonResponse({
        id: 'task_needs_auth',
        status:
          req.method === 'POST'
            ? {
                state: 'auth-required',
                message: {
                  parts: [{ kind: 'text', text: 'untrusted authorization instructions' }],
                },
              }
            : {
                state: 'completed',
                message: { parts: [{ kind: 'text', text: '已授权后的摘要' }] },
              },
      }),
    );
    const client = new DayuanA2AClient({
      auth: createFakeAuthProvider(),
      storage: createMemoryStorage(),
      clock: createFakeClock(),
      transport,
    });
    const input = {
      action: 'search_messages',
      query: '联调',
      request_id: 'auth-recovery-1',
    } as const;
    const pending = await client.start(input);
    expect(pending).toMatchObject({
      state: 'auth_required',
      interaction_kind: 'authorization_required',
      authorization_url: 'https://www.workbuddy.cn/login/wecom-auth',
      summary: '',
      can_reply_in_text: false,
    });
    expect(requests).toHaveLength(1);
    await expect(client.reply({ task_id: pending.task_id, text: '同意' })).rejects.toThrow(
      'TASK_NOT_WAITING_FOR_INPUT',
    );
    const resumed = await client.start(input);
    expect(resumed).toMatchObject({ task_id: pending.task_id, state: 'completed' });
    expect(requests.map((req) => req.method)).toEqual(['POST', 'GET']);
  });

  it('sends search_groups to whitelisted A2A endpoint and returns structured summary', async () => {
    const storage = createMemoryStorage();
    const clock = createFakeClock(1_700_000_000_000);
    const auth = createFakeAuthProvider(['wc_tok_live']);

    const { transport, requests } = createFakeTransport((req) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('https://qyapi.weixin.qq.com/cgi-bin/a2a/api/message:send');
      expect(req.headers.Authorization).toBe('Bearer wc_tok_live');
      const body = JSON.parse(req.body ?? '{}');
      expect(req.headers.Accept).toBe('application/a2a+json, application/json');
      expect(body.message?.role).toBe('ROLE_USER');
      expect(Object.keys(body.message.parts[0])).toEqual(['text']);
      expect(body.message?.parts?.[0]?.text).toContain('研发');

      return jsonResponse({
        id: 'task_100',
        contextId: 'ctx_100',
        status: {
          state: 'completed',
          message: {
            role: 'agent',
            parts: [{ kind: 'text', text: '找到 2 个相关群：1. 核心研发群 2. 研发效能群' }],
          },
        },
      });
    });

    const client = new DayuanA2AClient({ auth, storage, clock, transport });
    const result = await client.start({
      action: 'search_groups',
      query: '研发',
      limit: 5,
      request_id: 'req_1',
    });

    expect(requests).toHaveLength(1);
    expect(result.task_id).toBe('task_100');
    expect(result.context_id).toBe('ctx_100');
    expect(result.state).toBe('completed');
    expect(result.completed).toBe(true);
    expect(result.is_summary).toBe(true);
    expect(result.summary).toContain('核心研发群');
  });

  it('polls GET /tasks/{id}?historyLength=0 until completed and caches terminal result', async () => {
    const storage = createMemoryStorage();
    const clock = createFakeClock(1_700_000_000_000);
    const auth = createFakeAuthProvider();
    let polls = 0;

    const { transport, requests } = createFakeTransport((req) => {
      if (req.method === 'POST' && req.url.endsWith('/message:send')) {
        return jsonResponse({
          id: 'task_poll_1',
          contextId: 'ctx_p1',
          status: { state: 'working' },
        });
      }
      if (
        req.method === 'GET' &&
        req.url === 'https://qyapi.weixin.qq.com/cgi-bin/a2a/api/tasks/task_poll_1?historyLength=0'
      ) {
        polls += 1;
        if (polls < 2) {
          return jsonResponse({
            id: 'task_poll_1',
            contextId: 'ctx_p1',
            status: { state: 'working' },
          });
        }
        return jsonResponse({
          id: 'task_poll_1',
          contextId: 'ctx_p1',
          status: { state: 'completed' },
          artifacts: [
            {
              parts: [{ kind: 'text', text: '群聊摘要：本周五发版，灰度 10%。' }],
            },
          ],
        });
      }
      throw new Error(`unexpected ${req.method} ${req.url}`);
    });

    const progressUpdates: string[] = [];
    const client = new DayuanA2AClient({ auth, storage, clock, transport });
    const started = await client.start(
      {
        action: 'read_chat',
        chat_name: '发版同步群',
        question: '本周发版安排是什么？',
        time_range: '最近3天',
        wait_seconds: 15,
      },
      {
        onProgress: (info) => {
          progressUpdates.push(info.state);
        },
      },
    );

    expect(started.state).toBe('completed');
    expect(started.summary).toBe('群聊摘要：本周五发版，灰度 10%。');
    expect(progressUpdates).toContain('working');
    const networkCount = requests.length;

    // Subsequent getResult serves from local terminal cache without network calls
    const cached = await client.getResult({ task_id: 'task_poll_1' });
    expect(cached.summary).toBe('群聊摘要：本周五发版，灰度 10%。');
    expect(cached.from_cache).toBe(true);
    expect(requests).toHaveLength(networkCount);
  });

  it('returns non-terminal working result when wait_seconds is 0 and allows resuming via getResult', async () => {
    const storage = createMemoryStorage();
    const clock = createFakeClock();
    const auth = createFakeAuthProvider();

    const { transport } = createFakeTransport((req) => {
      if (req.method === 'POST') {
        return jsonResponse({
          id: 'task_async',
          contextId: 'ctx_a',
          status: { state: 'submitted' },
        });
      }
      if (req.method === 'GET' && req.url.endsWith('/tasks/task_async?historyLength=0')) {
        return jsonResponse({
          id: 'task_async',
          contextId: 'ctx_a',
          status: {
            state: 'completed',
            message: { role: 'agent', parts: [{ kind: 'text', text: '检索结果摘要' }] },
          },
        });
      }
      throw new Error(`unexpected ${req.url}`);
    });

    const client = new DayuanA2AClient({ auth, storage, clock, transport });
    const pending = await client.start({
      action: 'search_messages',
      query: '压测报告',
      wait_seconds: 0,
    });

    expect(pending.completed).toBe(false);
    expect(pending.state).toBe('submitted');

    const done = await client.getResult({ task_id: 'task_async', wait_seconds: 5 });
    expect(done.completed).toBe(true);
    expect(done.summary).toBe('检索结果摘要');
  });
});

describe('DayuanA2AClient — idempotency, token refresh retry, and approval guardrails', () => {
  it('reuses receipt for identical request_id and rejects conflicting parameters', async () => {
    const storage = createMemoryStorage();
    const clock = createFakeClock();
    const auth = createFakeAuthProvider();
    let sends = 0;

    const { transport } = createFakeTransport(() => {
      sends += 1;
      return jsonResponse({
        id: 'task_idem',
        contextId: 'ctx_i',
        status: {
          state: 'completed',
          message: { role: 'agent', parts: [{ kind: 'text', text: '幂等摘要' }] },
        },
      });
    });

    const client = new DayuanA2AClient({ auth, storage, clock, transport });
    const first = await client.start({
      action: 'search_groups',
      query: '告警群',
      request_id: 'req_fixed_1',
    });
    const second = await client.start({
      action: 'search_groups',
      query: '告警群',
      request_id: 'req_fixed_1',
    });

    expect(sends).toBe(1);
    expect(second.task_id).toBe(first.task_id);
    expect(second.from_cache).toBe(true);

    await expect(
      client.start({
        action: 'search_groups',
        query: '另一个群',
        request_id: 'req_fixed_1',
      }),
    ).rejects.toThrow('REQUEST_ID_CONFLICT');
  });

  it('blocks blind replay after TRANSPORT_UNCERTAIN but allows retry after TRANSPORT_NOT_SENT', async () => {
    const storage = createMemoryStorage();
    const clock = createFakeClock();
    const auth = createFakeAuthProvider();
    let attempt = 0;

    const { transport } = createFakeTransport(() => {
      attempt += 1;
      if (attempt === 1) throw new WecomError('TRANSPORT_NOT_SENT');
      if (attempt === 2) throw new WecomError('TRANSPORT_UNCERTAIN');
      return jsonResponse({
        id: 'task_ok',
        status: {
          state: 'completed',
          message: { role: 'agent', parts: [{ kind: 'text', text: 'ok' }] },
        },
      });
    });

    const client = new DayuanA2AClient({ auth, storage, clock, transport });

    // Pre-send failure does NOT poison request_id
    await expect(
      client.start({ action: 'search_groups', query: '测试', request_id: 'req_retry_1' }),
    ).rejects.toThrow('TRANSPORT_NOT_SENT');

    // Uncertain failure marks submit_unknown and blocks re-send
    await expect(
      client.start({ action: 'search_groups', query: '测试', request_id: 'req_retry_1' }),
    ).rejects.toThrow('TRANSPORT_UNCERTAIN');

    await expect(
      client.start({ action: 'search_groups', query: '测试', request_id: 'req_retry_1' }),
    ).rejects.toThrow('SUBMIT_OUTCOME_UNKNOWN');
  });

  it('forces WeCom token refresh once on HTTP 401 and succeeds on retry', async () => {
    const storage = createMemoryStorage();
    const clock = createFakeClock();
    const auth = createFakeAuthProvider(['wc_stale', 'wc_fresh']);

    const { transport, requests } = createFakeTransport((req) => {
      if (req.headers.Authorization === 'Bearer wc_stale') {
        return jsonResponse({ errcode: 42001, errmsg: 'access_token expired' }, 401);
      }
      return jsonResponse({
        id: 'task_refreshed',
        contextId: 'ctx_r',
        status: {
          state: 'completed',
          message: { role: 'agent', parts: [{ kind: 'text', text: '续期后查询成功' }] },
        },
      });
    });

    const client = new DayuanA2AClient({ auth, storage, clock, transport });
    const res = await client.start({ action: 'search_groups', query: '架构组' });

    expect(auth.forceCalls).toBe(1);
    expect(requests).toHaveLength(2);
    expect(res.summary).toBe('续期后查询成功');
  });

  it('allows text clarification reply but strictly blocks approval card interactions', async () => {
    const storage = createMemoryStorage();
    const clock = createFakeClock();
    const auth = createFakeAuthProvider();

    const { transport, requests } = createFakeTransport((req) => {
      const body = req.body ? JSON.parse(req.body) : undefined;
      if (body?.message?.taskId === 'task_clarify') {
        expect(body.message.contextId).toBe('ctx_clarify');
        return jsonResponse({
          id: 'task_clarify',
          contextId: 'ctx_clarify',
          status: {
            state: 'completed',
            message: { role: 'agent', parts: [{ kind: 'text', text: '已按确认的群返回摘要' }] },
          },
        });
      }
      if (body?.message?.parts?.[0]?.text?.includes('模糊群')) {
        return jsonResponse({
          id: 'task_clarify',
          contextId: 'ctx_clarify',
          status: {
            state: 'input_required',
            message: {
              role: 'agent',
              parts: [{ kind: 'text', text: '找到多个群，请确认是「研发A群」还是「研发B群」？' }],
            },
          },
        });
      }
      return jsonResponse({
        id: 'task_approval',
        contextId: 'ctx_approval',
        status: {
          state: 'input_required',
          message: {
            role: 'agent',
            parts: [
              {
                kind: 'data',
                metadata: { wecom_part_type: 'approval' },
                data: { token_id_list: ['apv_999'], title: '敏感权限审批' },
              },
            ],
          },
        },
      });
    });

    const client = new DayuanA2AClient({ auth, storage, clock, transport });

    const clarify = await client.start({
      action: 'read_chat',
      chat_name: '模糊群',
      question: '总结',
    });
    expect(clarify.state).toBe('input_required');
    expect(clarify.interaction_kind).toBe('text_clarification');
    expect(clarify.can_reply_in_text).toBe(true);

    const replied = await client.reply({ task_id: 'task_clarify', text: '研发A群' });
    expect(replied.state).toBe('completed');
    expect(replied.summary).toBe('已按确认的群返回摘要');

    const approval = await client.start({
      action: 'read_chat',
      chat_name: '高密群',
      question: '总结',
    });
    expect(approval.state).toBe('input_required');
    expect(approval.interaction_kind).toBe('approval_required');
    expect(approval.can_reply_in_text).toBe(false);
    expect(approval.human_action_required).toBe(true);

    const reqCountBeforeBlockedReply = requests.length;
    await expect(client.reply({ task_id: 'task_approval', text: '同意' })).rejects.toThrow(
      'APPROVAL_INTERACTION_BLOCKED',
    );
    expect(requests).toHaveLength(reqCountBeforeBlockedReply);
  });

  it('lists recent receipts newest-first without exposing credentials', async () => {
    const storage = createMemoryStorage();
    const clock = createFakeClock(1_700_000_000_000);
    const auth = createFakeAuthProvider(['super_secret_token']);
    let n = 0;

    const { transport } = createFakeTransport(() => {
      n += 1;
      return jsonResponse({
        id: `task_${n}`,
        contextId: `ctx_${n}`,
        status: {
          state: 'completed',
          message: { role: 'agent', parts: [{ kind: 'text', text: `摘要 ${n}` }] },
        },
      });
    });

    const client = new DayuanA2AClient({ auth, storage, clock, transport });
    await client.start({ action: 'search_groups', query: '群1', request_id: 'r1' });
    clock.advance(5_000);
    await client.start({ action: 'search_groups', query: '群2', request_id: 'r2' });

    const receipts = await client.listReceipts(10);
    expect(receipts).toHaveLength(2);
    expect(receipts[0]?.request_id).toBe('r2');
    expect(receipts[1]?.request_id).toBe('r1');
    expect(JSON.stringify(receipts)).not.toContain('super_secret_token');
  });
});
