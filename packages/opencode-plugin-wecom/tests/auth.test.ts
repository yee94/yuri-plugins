import { describe, expect, it } from 'vitest';
import { WorkBuddyAuth } from '../src/auth/workbuddy.js';
import { createFetchTransport } from '../src/http.js';
import { WecomError } from '../src/types.js';
import {
  createFakeClock,
  createFakeTransport,
  createMemoryStorage,
  jsonResponse,
} from './helpers.js';

describe('WorkBuddyAuth — scan login lifecycle', () => {
  it('reports logged_out status without network calls', async () => {
    const storage = createMemoryStorage();
    const clock = createFakeClock();
    const { transport, requests } = createFakeTransport(() => {
      throw new Error('unexpected network call');
    });

    const auth = new WorkBuddyAuth({ storage, clock, transport });
    const status = await auth.status();

    expect(status).toEqual({
      phase: 'logged_out',
      desktop_required: false,
      cloud_dependency: 'https://www.workbuddy.cn',
      account_expires_at_ms: null,
      refresh_expires_at_ms: null,
      refresh_credential_present: false,
      wecom_expires_at_ms: null,
      wecom_configured: false,
      authorization_verified: false,
    });
    expect(requests).toHaveLength(0);
  });

  it('starts QR login with version=5.8.2 and force_login_type=wecom and reuses pending URL within 5 minutes', async () => {
    const storage = createMemoryStorage();
    const clock = createFakeClock(1_700_000_000_000);
    const { transport, requests } = createFakeTransport((req) => {
      if (req.url === 'https://www.workbuddy.cn/v2/plugin/auth/state?platform=workbuddy') {
        return jsonResponse({
          code: 0,
          data: {
            state: 'st_abc123',
            authUrl: 'https://www.workbuddy.cn/login?state=st_abc123',
          },
        });
      }
      throw new Error(`unexpected ${req.url}`);
    });

    const auth = new WorkBuddyAuth({ storage, clock, transport });
    const first = await auth.start();
    expect(first.phase).toBe('pending_token');
    expect(first.authorization_url).toBe(
      'https://www.workbuddy.cn/login?state=st_abc123&version=5.8.2&force_login_type=wecom',
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers['X-Domain']).toBe('www.workbuddy.cn');
    expect(requests[0]?.headers['X-Product']).toBe('SaaS');

    // Within 5 minutes, start() reuses existing pending state without issuing another state request
    clock.advance(60_000);
    const second = await auth.start();
    expect(second.authorization_url).toBe(first.authorization_url);
    expect(requests).toHaveLength(1);
  });

  it('rejects untrusted login URLs or mismatched state from server', async () => {
    const storage = createMemoryStorage();
    const clock = createFakeClock();
    const { transport } = createFakeTransport(() =>
      jsonResponse({
        code: 0,
        data: {
          state: 'st_abc123',
          authUrl: 'https://evil.example.com/login?state=st_abc123',
        },
      }),
    );

    const auth = new WorkBuddyAuth({ storage, clock, transport });
    await expect(auth.start()).rejects.toThrow('UNEXPECTED_LOGIN_URL');
  });

  it('polls pending code 11217 cleanly, then transitions pending_token -> pending_account -> ready', async () => {
    const storage = createMemoryStorage();
    const clock = createFakeClock(1_700_000_000_000);
    let tokenPolls = 0;

    const { transport } = createFakeTransport((req) => {
      if (req.url.endsWith('/v2/plugin/auth/state?platform=workbuddy')) {
        return jsonResponse({
          code: 0,
          data: { state: 'st_1', authUrl: 'https://www.workbuddy.cn/login?state=st_1' },
        });
      }
      if (req.url.endsWith('/v2/plugin/auth/token?state=st_1')) {
        tokenPolls += 1;
        if (tokenPolls === 1) {
          return jsonResponse({ code: 11217, message: 'waiting for scan' });
        }
        return jsonResponse({
          code: 0,
          data: {
            accessToken: 'wb_tok_1',
            refreshToken: 'wb_ref_1',
            expiresIn: 3600,
            refreshExpiresIn: 86400,
          },
        });
      }
      if (req.url.endsWith('/v2/plugin/account')) {
        expect(req.headers.Authorization).toBe('Bearer wb_tok_1');
        return jsonResponse({
          code: 0,
          data: { uid: 'u_001', enterpriseId: 'ent_99' },
        });
      }
      throw new Error(`unexpected ${req.url}`);
    });

    const auth = new WorkBuddyAuth({ storage, clock, transport });
    await auth.start();

    const pending = await auth.finish();
    expect(pending.phase).toBe('pending_token');

    const ready = await auth.finish();
    expect(ready).toEqual({
      phase: 'ready',
      desktop_required: false,
      cloud_dependency: 'https://www.workbuddy.cn',
    });

    const status = await auth.status();
    expect(status.phase).toBe('ready');
    expect(status.refresh_credential_present).toBe(true);
    expect(status.account_expires_at_ms).toBe(1_700_003_600_000);
  });

  it('completes scan + WeCom token exchange in one waitForLogin call and supports logout', async () => {
    const storage = createMemoryStorage();
    const clock = createFakeClock(1_700_000_000_000);
    let poll = 0;

    const { transport } = createFakeTransport((req) => {
      if (req.url.endsWith('/v2/plugin/auth/state?platform=workbuddy')) {
        return jsonResponse({
          code: 0,
          data: { state: 'st_wait', authUrl: 'https://www.workbuddy.cn/login?state=st_wait' },
        });
      }
      if (req.url.endsWith('/v2/plugin/auth/token?state=st_wait')) {
        poll += 1;
        if (poll < 2) return jsonResponse({ code: 12151 });
        return jsonResponse({
          code: 0,
          data: { accessToken: 'wb_tok', refreshToken: 'wb_ref', expiresIn: 3600 },
        });
      }
      if (req.url.endsWith('/v2/plugin/account')) {
        return jsonResponse({ code: 0, data: { uid: 'u_1', enterpriseId: 'ent_1' } });
      }
      if (req.url.endsWith('/console/enterprises/ent_1/oneid_openapi/exchange-wecom-token')) {
        return jsonResponse({
          code: 0,
          data: {
            access_token: 'wc_tok_1',
            alias_id: 'alice',
            src_tid: 'corp_1',
            expires_in: 7200,
          },
        });
      }
      throw new Error(`unexpected ${req.url}`);
    });

    const auth = new WorkBuddyAuth({ storage, clock, transport });
    await auth.start();
    const finalStatus = await auth.waitForLogin({ waitSeconds: 20 });

    expect(finalStatus.phase).toBe('ready');
    expect(finalStatus.wecom_configured).toBe(true);

    await auth.logout();
    expect((await auth.status()).phase).toBe('logged_out');
  });
});

describe('WorkBuddyAuth — renewal, safety, and identity protection', () => {
  async function loginReadyAuth(options?: {
    clock?: ReturnType<typeof createFakeClock>;
    onRefresh?: () => ReturnType<typeof jsonResponse> | Promise<ReturnType<typeof jsonResponse>>;
    onExchange?: (count: number) => ReturnType<typeof jsonResponse>;
    onAccount?: (count: number) => ReturnType<typeof jsonResponse>;
  }) {
    const storage = createMemoryStorage();
    const clock = options?.clock ?? createFakeClock(1_700_000_000_000);
    let accountCalls = 0;
    let exchangeCalls = 0;

    const { transport, requests } = createFakeTransport(async (req) => {
      if (req.url.endsWith('/v2/plugin/auth/state?platform=workbuddy')) {
        return jsonResponse({
          code: 0,
          data: { state: 'st_s', authUrl: 'https://www.workbuddy.cn/login?state=st_s' },
        });
      }
      if (req.url.endsWith('/v2/plugin/auth/token?state=st_s')) {
        return jsonResponse({
          code: 0,
          data: {
            accessToken: 'wb_tok_init',
            refreshToken: 'wb_ref_init',
            expiresIn: 600,
            refreshExpiresIn: 86400,
          },
        });
      }
      if (req.url.endsWith('/v2/plugin/account')) {
        accountCalls += 1;
        if (options?.onAccount) return options.onAccount(accountCalls);
        return jsonResponse({ code: 0, data: { uid: 'u_1', enterpriseId: 'ent_1' } });
      }
      if (req.url.endsWith('/v2/plugin/auth/token/refresh')) {
        if (options?.onRefresh) return options.onRefresh();
        return jsonResponse({
          code: 0,
          data: {
            accessToken: 'wb_tok_refreshed',
            refreshToken: 'wb_ref_2',
            expiresIn: 3600,
            refreshExpiresIn: 86400,
          },
        });
      }
      if (req.url.endsWith('/console/enterprises/ent_1/oneid_openapi/exchange-wecom-token')) {
        exchangeCalls += 1;
        if (options?.onExchange) return options.onExchange(exchangeCalls);
        return jsonResponse({
          code: 0,
          data: {
            access_token: `wc_tok_${exchangeCalls}`,
            alias_id: 'alice',
            src_tid: 'corp_1',
            expires_in: 3600,
          },
        });
      }
      throw new Error(`unexpected ${req.url}`);
    });

    const auth = new WorkBuddyAuth({ storage, clock, transport });
    await auth.start();
    await auth.finish();
    return { auth, clock, requests, storage };
  }

  it('serves cached fresh WeCom token without hitting the network', async () => {
    const { auth, requests } = await loginReadyAuth();
    const first = await auth.ensureWecom();
    const countAfterFirst = requests.length;

    const second = await auth.ensureWecom();
    expect(second.access_token).toBe(first.access_token);
    expect(requests).toHaveLength(countAfterFirst);
  });

  it('automatically refreshes expired WorkBuddy session and exchanges a new WeCom token when WeCom expires', async () => {
    const { auth, clock, requests } = await loginReadyAuth();
    const first = await auth.ensureWecom();
    expect(first.access_token).toBe('wc_tok_1');

    // Advance past 600s WorkBuddy account token lifetime while WeCom token (3600s) is still fresh
    clock.advance(600_000);
    const afterAccountRefresh = await auth.ensureWecom();
    expect(afterAccountRefresh.access_token).toBe('wc_tok_1');

    const refreshReq = requests.find((r) => r.url.endsWith('/v2/plugin/auth/token/refresh'));
    expect(refreshReq?.headers['X-Refresh-Token']).toBe('wb_ref_init');
    expect(refreshReq?.headers['X-Auth-Refresh-Source']).toBe('plugin');

    // Advance past remaining WeCom token lifetime -> exchanges fresh WeCom token
    clock.advance(3_000_000);
    const second = await auth.ensureWecom();
    expect(second.access_token).toBe('wc_tok_2');
  });

  it('does not replay refresh token after TRANSPORT_UNCERTAIN but recovers after TRANSPORT_NOT_SENT', async () => {
    let refreshAttempt = 0;
    const { auth, clock } = await loginReadyAuth({
      onRefresh: () => {
        refreshAttempt += 1;
        if (refreshAttempt === 1) throw new WecomError('TRANSPORT_NOT_SENT');
        throw new WecomError('TRANSPORT_UNCERTAIN');
      },
    });

    await auth.ensureWecom();
    clock.advance(600_000);

    // Pre-send error restores ready phase so caller can safely retry
    await expect(auth.ensureWecom()).rejects.toThrow('TRANSPORT_NOT_SENT');
    expect((await auth.status()).phase).toBe('ready');

    // Uncertain network drop keeps refresh_unknown and refuses replay
    await expect(auth.ensureWecom()).rejects.toThrow('TRANSPORT_UNCERTAIN');
    expect((await auth.status()).phase).toBe('refresh_unknown');
    await expect(auth.ensureWecom()).rejects.toThrow('REFRESH_OUTCOME_UNKNOWN_LOGIN_REQUIRED');
  });

  it('maps HTTP 403 on WeCom token exchange to WECOM_AUTH_REQUIRED_OPEN_WECOM_LOGIN', async () => {
    const { auth } = await loginReadyAuth({
      onExchange: () => jsonResponse({ code: 40301 }, 403),
    });

    await expect(auth.ensureWecom()).rejects.toThrow('WECOM_AUTH_REQUIRED_OPEN_WECOM_LOGIN');
  });

  it('rejects silent WeCom identity change across token exchanges', async () => {
    const { auth } = await loginReadyAuth({
      onExchange: (count) =>
        jsonResponse({
          code: 0,
          data: {
            access_token: `wc_tok_${count}`,
            alias_id: count === 1 ? 'alice' : 'bob',
            src_tid: 'corp_1',
            expires_in: 3600,
          },
        }),
    });

    await auth.ensureWecom();
    await expect(auth.ensureWecom({ force: true })).rejects.toThrow('WECOM_IDENTITY_CHANGED');
  });

  it('rejects account identity change during refresh', async () => {
    const { auth, clock } = await loginReadyAuth({
      onAccount: (count) =>
        jsonResponse({
          code: 0,
          data: { uid: count === 1 ? 'u_1' : 'u_2', enterpriseId: 'ent_1' },
        }),
    });

    await auth.ensureWecom();
    clock.advance(600_000);
    await expect(auth.ensureWecom()).rejects.toThrow('ACCOUNT_CHANGED_USE_SEPARATE_STATE');
    expect((await auth.status()).phase).toBe('account_changed');
  });

  it('deduplicates concurrent ensureWecom calls through the auth lock', async () => {
    let exchangeCount = 0;
    const { auth } = await loginReadyAuth({
      onExchange: () => {
        exchangeCount += 1;
        return jsonResponse({
          code: 0,
          data: {
            access_token: 'wc_shared',
            alias_id: 'alice',
            src_tid: 'corp_1',
            expires_in: 3600,
          },
        });
      },
    });

    const [a, b] = await Promise.all([auth.ensureWecom(), auth.ensureWecom()]);
    expect(a.access_token).toBe('wc_shared');
    expect(b.access_token).toBe('wc_shared');
    expect(exchangeCount).toBe(1);
  });
});

describe('createFetchTransport', () => {
  it('rejects HTTP redirects and oversized payloads, and distinguishes pre-send errors', async () => {
    const redirectTransport = createFetchTransport(
      async () => new Response('', { status: 302, headers: { Location: 'https://evil.example' } }),
    );
    await expect(
      redirectTransport({
        method: 'GET',
        url: 'https://www.workbuddy.cn/v2/plugin/account',
        headers: {},
        timeoutMs: 1000,
        maxBytes: 1024,
      }),
    ).rejects.toThrow('REDIRECT_REJECTED');

    const bigTransport = createFetchTransport(
      async () => new Response('x'.repeat(200), { status: 200 }),
    );
    await expect(
      bigTransport({
        method: 'GET',
        url: 'https://www.workbuddy.cn/v2/plugin/account',
        headers: {},
        timeoutMs: 1000,
        maxBytes: 100,
      }),
    ).rejects.toThrow('RESPONSE_TOO_LARGE');

    const dnsTransport = createFetchTransport(async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
      });
    });
    await expect(
      dnsTransport({
        method: 'GET',
        url: 'https://www.workbuddy.cn/v2/plugin/account',
        headers: {},
        timeoutMs: 1000,
        maxBytes: 1024,
      }),
    ).rejects.toThrow('TRANSPORT_NOT_SENT');
  });
});
