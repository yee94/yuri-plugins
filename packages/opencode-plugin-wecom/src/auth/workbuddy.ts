import { createHash } from 'node:crypto';
import { createFetchTransport } from '../http.js';
import {
  AsyncKeyLock,
  type Clock,
  type HttpTransport,
  hasControlOrSpaceChar,
  type StorageAdapter,
  systemClock,
  WecomError,
} from '../types.js';

export const WORKBUDDY_ORIGIN = 'https://www.workbuddy.cn';
export const WORKBUDDY_PREFIX = '/v2/plugin';
export const WECOM_LOGIN_URL = `${WORKBUDDY_ORIGIN}/login/wecom-auth`;
// Official WorkBuddy login page hides WeCom QR login when version is absent or < 5.8.0.
export const AUTH_FLOW_VERSION = '5.8.2';
export const AUTH_STORAGE_KEY = 'wecom/cloud-auth';
export const AUTH_MAX_RESPONSE_BYTES = 1024 * 1024;
const PENDING_TTL_MS = 300_000;
const FRESH_BUFFER_MS = 60_000;
const LOGIN_POLL_INTERVAL_MS = 2_000;
const MAX_WAIT_SECONDS = 300;
const USER_AGENT = 'opencode-plugin-wecom/0.1.0 (local interoperability client)';

export type AuthPhase =
  | 'logged_out'
  | 'pending_token'
  | 'pending_account'
  | 'ready'
  | 'refresh_unknown'
  | 'login_required'
  | 'account_changed';

export interface NormalizedAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  refreshExpiresAt: number;
  [key: string]: unknown;
}

export interface WorkBuddyAccount {
  uid: string;
  enterpriseId?: string;
  [key: string]: unknown;
}

export interface WecomCredential {
  access_token: string;
  identity: string;
  expires_at_ms: number;
  source: 'workbuddy_cloud';
}

interface StoredCloudAuth {
  phase: AuthPhase;
  pending?: {
    state: string;
    url: string;
    created_at_ms: number;
  };
  auth?: NormalizedAuth;
  account?: WorkBuddyAccount;
  wecom?: WecomCredential;
}

export interface WorkBuddyStatus {
  phase: AuthPhase;
  desktop_required: false;
  cloud_dependency: string;
  account_expires_at_ms: number | null;
  refresh_expires_at_ms: number | null;
  refresh_credential_present: boolean;
  wecom_expires_at_ms: number | null;
  wecom_configured: boolean;
  authorization_verified: boolean;
}

export interface StartLoginResult {
  phase: 'pending_token';
  authorization_url: string;
}

export interface FinishLoginResult {
  phase: 'pending_token' | 'pending_account' | 'ready';
  desktop_required?: false;
  cloud_dependency?: string;
}

export interface WecomLoginInfo {
  authorization_url: string;
  instruction: string;
}

export interface WorkBuddyAuthOptions {
  storage: StorageAdapter;
  transport?: HttpTransport;
  clock?: Clock;
  onAuthChange?: (status: WorkBuddyStatus) => void | Promise<void>;
}

const TOKEN_STATE_PATH_RE = /^\/v2\/plugin\/auth\/token\?state=[A-Za-z0-9_%.-]+$/;
const EXCHANGE_PATH_RE =
  /^\/console\/enterprises\/[A-Za-z0-9_%.-]+\/oneid_openapi\/exchange-wecom-token$/;

export function formatLoginUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  parsed.searchParams.set('version', AUTH_FLOW_VERSION);
  parsed.searchParams.set('force_login_type', 'wecom');
  parsed.hash = '';
  return parsed.toString();
}

function assertSecret(value: unknown): string {
  if (typeof value !== 'string' || !value || hasControlOrSpaceChar(value)) {
    throw new WecomError('INVALID_CREDENTIAL', true);
  }
  return value;
}

function parseDeadline(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return 0;
}

function normalizeAuth(value: unknown, nowMs: number): NormalizedAuth {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WecomError('INVALID_AUTH_RESPONSE');
  }
  const raw = { ...(value as Record<string, unknown>) };
  const accessToken = assertSecret(raw.accessToken);
  let refreshToken: string | undefined;
  if (raw.refreshToken !== undefined && raw.refreshToken !== null && raw.refreshToken !== '') {
    refreshToken = assertSecret(raw.refreshToken);
  }
  const expiresIn = parseDeadline(raw.expiresIn);
  const expiresAt = parseDeadline(raw.expiresAt) || (expiresIn ? nowMs + expiresIn * 1000 : 0);
  const refreshExpiresIn = parseDeadline(raw.refreshExpiresIn);
  const refreshExpiresAt =
    parseDeadline(raw.refreshExpiresAt) || (refreshExpiresIn ? nowMs + refreshExpiresIn * 1000 : 0);

  return {
    ...raw,
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    expiresAt,
    refreshExpiresAt,
  };
}

function accountIdentity(account: unknown): [string, string | undefined] {
  if (!account || typeof account !== 'object' || Array.isArray(account)) {
    throw new WecomError('INVALID_ACCOUNT_RESPONSE');
  }
  const record = account as Record<string, unknown>;
  if (typeof record.uid !== 'string' || !record.uid) {
    throw new WecomError('INVALID_ACCOUNT_RESPONSE');
  }
  const enterpriseId = typeof record.enterpriseId === 'string' ? record.enterpriseId : undefined;
  return [record.uid, enterpriseId];
}

function isFresh(expiryMs: unknown, nowMs: number): boolean {
  return parseDeadline(expiryMs) > nowMs + FRESH_BUFFER_MS;
}

function isAllowedEndpoint(method: 'GET' | 'POST', path: string): boolean {
  if (
    method === 'POST' &&
    (path === `${WORKBUDDY_PREFIX}/auth/state?platform=workbuddy` ||
      path === `${WORKBUDDY_PREFIX}/auth/token/refresh`)
  ) {
    return true;
  }
  if (
    method === 'GET' &&
    (path === `${WORKBUDDY_PREFIX}/account` || TOKEN_STATE_PATH_RE.test(path))
  ) {
    return true;
  }
  if (method === 'POST' && EXCHANGE_PATH_RE.test(path)) {
    return true;
  }
  return false;
}

export class WorkBuddyAuth {
  private readonly storage: StorageAdapter;
  private readonly transport: HttpTransport;
  private readonly clock: Clock;
  private readonly onAuthChange?: (status: WorkBuddyStatus) => void | Promise<void>;
  private readonly lock = new AsyncKeyLock();

  constructor(options: WorkBuddyAuthOptions) {
    this.storage = options.storage;
    this.transport = options.transport ?? createFetchTransport();
    this.clock = options.clock ?? systemClock;
    this.onAuthChange = options.onAuthChange;
  }

  private async load(): Promise<StoredCloudAuth> {
    const stored = await this.storage.get(AUTH_STORAGE_KEY);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return { phase: 'logged_out' };
    }
    const doc = stored as Partial<StoredCloudAuth>;
    return {
      ...doc,
      phase: doc.phase ?? 'logged_out',
    };
  }

  private async save(doc: StoredCloudAuth): Promise<void> {
    await this.storage.set(AUTH_STORAGE_KEY, doc);
    if (this.onAuthChange) {
      await Promise.resolve(this.onAuthChange(this.toStatus(doc))).catch(() => {});
    }
  }

  private toStatus(doc: StoredCloudAuth): WorkBuddyStatus {
    const auth = doc.auth;
    return {
      phase: doc.phase,
      desktop_required: false,
      cloud_dependency: WORKBUDDY_ORIGIN,
      account_expires_at_ms: auth?.expiresAt || null,
      refresh_expires_at_ms: auth?.refreshExpiresAt || null,
      refresh_credential_present: Boolean(auth?.refreshToken),
      wecom_expires_at_ms: doc.wecom?.expires_at_ms ?? null,
      wecom_configured: Boolean(doc.wecom?.access_token),
      authorization_verified: false,
    };
  }

  private async requestCloud(options: {
    method: 'GET' | 'POST';
    path: string;
    auth?: NormalizedAuth;
    refreshToken?: string;
    beforeSend?: () => Promise<void>;
    deadlineMonoMs?: number;
    signal?: AbortSignal;
  }): Promise<Record<string, unknown>> {
    const { method, path, auth, refreshToken, beforeSend, deadlineMonoMs, signal } = options;
    if (!isAllowedEndpoint(method, path)) {
      throw new WecomError('ENDPOINT_NOT_ALLOWED', true);
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Domain': 'www.workbuddy.cn',
      'X-Product': 'SaaS',
      'User-Agent': USER_AGENT,
    };
    if (auth) {
      headers.Authorization = `Bearer ${assertSecret(auth.accessToken)}`;
    }
    if (refreshToken) {
      headers['X-Refresh-Token'] = assertSecret(refreshToken);
      headers['X-Auth-Refresh-Source'] = 'plugin';
    }

    let timeoutMs = 25_000;
    if (deadlineMonoMs !== undefined) {
      const remaining = deadlineMonoMs - this.clock.monotonic();
      if (remaining <= 0) throw new WecomError('WAIT_TIMEOUT');
      timeoutMs = Math.min(timeoutMs, remaining);
    }

    if (beforeSend) {
      await beforeSend();
    }

    const response = await this.transport({
      method,
      url: `${WORKBUDDY_ORIGIN}${path}`,
      headers,
      body: method === 'POST' ? '{}' : undefined,
      timeoutMs,
      maxBytes: AUTH_MAX_RESPONSE_BYTES,
      signal,
    });

    if (response.status >= 300 && response.status < 400) {
      throw new WecomError('REDIRECT_REJECTED', true);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      if (response.status >= 400) {
        throw new WecomError(`HTTP_${response.status}`, response.status < 500);
      }
      throw new WecomError('INVALID_RESPONSE');
    }

    const bodyRecord =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;

    if (response.status >= 400) {
      const code = bodyRecord?.code;
      if (code === 11217 || code === 12151) {
        throw new WecomError(`PENDING_${code}`);
      }
      const suffix = typeof code === 'number' && Number.isInteger(code) ? `_CODE_${code}` : '';
      throw new WecomError(`HTTP_${response.status}${suffix}`, response.status < 500);
    }

    if (!bodyRecord) {
      throw new WecomError('INVALID_RESPONSE');
    }

    const code = bodyRecord.code;
    if (code === 11217 || code === 12151) {
      throw new WecomError(`PENDING_${code}`);
    }
    if (code !== 0) {
      throw new WecomError(
        typeof code === 'number' && Number.isInteger(code)
          ? `CLOUD_CODE_${code}`
          : 'INVALID_RESPONSE',
      );
    }

    const data = bodyRecord.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new WecomError('INVALID_RESPONSE');
    }
    return data as Record<string, unknown>;
  }

  async status(): Promise<WorkBuddyStatus> {
    return this.toStatus(await this.load());
  }

  wecomLoginInfo(): WecomLoginInfo {
    return {
      authorization_url: WECOM_LOGIN_URL,
      instruction: '在完成账号登录的同一浏览器中，授权同一企业微信账号，完成后执行 wecom_renew。',
    };
  }

  async start(options?: { signal?: AbortSignal }): Promise<StartLoginResult> {
    return this.lock.run('auth', async () => {
      const doc = await this.load();
      if (doc.phase === 'ready') {
        throw new WecomError('ALREADY_LOGGED_IN_USE_RENEW', true);
      }

      if (
        doc.phase === 'pending_token' &&
        doc.pending &&
        this.clock.now() - doc.pending.created_at_ms < PENDING_TTL_MS
      ) {
        const refreshedUrl = formatLoginUrl(doc.pending.url);
        doc.pending.url = refreshedUrl;
        await this.save(doc);
        return { phase: 'pending_token', authorization_url: refreshedUrl };
      }

      const data = await this.requestCloud({
        method: 'POST',
        path: `${WORKBUDDY_PREFIX}/auth/state?platform=workbuddy`,
        signal: options?.signal,
      });

      const state = data.state;
      const authUrl = data.authUrl;
      let parsed: URL;
      try {
        if (typeof authUrl !== 'string') throw new Error('not string');
        parsed = new URL(authUrl);
      } catch {
        throw new WecomError('UNEXPECTED_LOGIN_URL');
      }

      if (parsed.origin !== WORKBUDDY_ORIGIN || parsed.pathname !== '/login' || parsed.hash) {
        throw new WecomError('UNEXPECTED_LOGIN_URL');
      }
      if (typeof state !== 'string' || !state || parsed.searchParams.get('state') !== state) {
        throw new WecomError('INVALID_LOGIN_STATE');
      }

      const url = formatLoginUrl(authUrl);
      const next: StoredCloudAuth = {
        ...doc,
        phase: 'pending_token',
        pending: { state, url, created_at_ms: this.clock.now() },
      };
      await this.save(next);
      return { phase: 'pending_token', authorization_url: url };
    });
  }

  private async fetchAccount(
    doc: StoredCloudAuth,
    deadlineMonoMs?: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!doc.auth) {
      throw new WecomError('LOGIN_REQUIRED', true);
    }
    const account = (await this.requestCloud({
      method: 'GET',
      path: `${WORKBUDDY_PREFIX}/account`,
      auth: doc.auth,
      deadlineMonoMs,
      signal,
    })) as WorkBuddyAccount;

    const nextId = accountIdentity(account);
    if (doc.account) {
      const prevId = accountIdentity(doc.account);
      if (prevId[0] !== nextId[0] || prevId[1] !== nextId[1]) {
        doc.phase = 'account_changed';
        await this.save(doc);
        throw new WecomError('ACCOUNT_CHANGED_USE_SEPARATE_STATE', true);
      }
    }

    doc.account = account;
    doc.phase = 'ready';
    delete doc.pending;
    await this.save(doc);
  }

  async finish(options?: {
    signal?: AbortSignal;
    deadlineMonoMs?: number;
  }): Promise<FinishLoginResult> {
    return this.lock.run('auth', async () => {
      const doc = await this.load();
      if (doc.phase === 'pending_token') {
        if (!doc.pending?.state) {
          throw new WecomError('LOGIN_REQUIRED', true);
        }
        try {
          const data = await this.requestCloud({
            method: 'GET',
            path: `${WORKBUDDY_PREFIX}/auth/token?state=${encodeURIComponent(doc.pending.state)}`,
            deadlineMonoMs: options?.deadlineMonoMs,
            signal: options?.signal,
          });
          doc.auth = normalizeAuth(data, this.clock.now());
          doc.phase = 'pending_account';
          await this.save(doc);
        } catch (err) {
          if (err instanceof WecomError && err.code.startsWith('PENDING_')) {
            return { phase: 'pending_token' };
          }
          throw err;
        }
      }

      if (doc.phase === 'pending_account') {
        try {
          await this.fetchAccount(doc, options?.deadlineMonoMs, options?.signal);
        } catch (err) {
          if (err instanceof WecomError && err.code.startsWith('PENDING_')) {
            return { phase: 'pending_account' };
          }
          throw err;
        }
      }

      if (doc.phase !== 'ready') {
        throw new WecomError('LOGIN_REQUIRED', true);
      }
      return {
        phase: 'ready',
        desktop_required: false,
        cloud_dependency: WORKBUDDY_ORIGIN,
      };
    });
  }

  async waitForLogin(options: {
    waitSeconds: number;
    signal?: AbortSignal;
    exchangeWecom?: boolean;
  }): Promise<WorkBuddyStatus> {
    const boundedSeconds = Math.min(Math.max(Math.floor(options.waitSeconds), 0), MAX_WAIT_SECONDS);
    const deadlineMonoMs = this.clock.monotonic() + boundedSeconds * 1000;

    let result = await this.finish({ signal: options.signal, deadlineMonoMs });
    while (result.phase !== 'ready' && this.clock.monotonic() < deadlineMonoMs) {
      const remaining = deadlineMonoMs - this.clock.monotonic();
      await this.clock.sleep(Math.min(LOGIN_POLL_INTERVAL_MS, remaining), options.signal);
      if (this.clock.monotonic() >= deadlineMonoMs) break;
      result = await this.finish({ signal: options.signal, deadlineMonoMs });
    }

    if (result.phase === 'ready' && options.exchangeWecom !== false) {
      await this.ensureWecom({ signal: options.signal, deadlineMonoMs });
    }
    return this.status();
  }

  private async refreshAccount(
    doc: StoredCloudAuth,
    deadlineMonoMs?: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const refreshToken = doc.auth?.refreshToken;
    if (!refreshToken) {
      doc.phase = 'login_required';
      await this.save(doc);
      throw new WecomError('LOGIN_REQUIRED_NO_REFRESH_TOKEN', true);
    }

    const refreshExp = parseDeadline(doc.auth?.refreshExpiresAt);
    if (refreshExp && refreshExp <= this.clock.now()) {
      doc.phase = 'login_required';
      await this.save(doc);
      throw new WecomError('LOGIN_REQUIRED_REFRESH_EXPIRED', true);
    }

    const previousPhase = doc.phase;
    let refreshed: Record<string, unknown>;
    try {
      refreshed = await this.requestCloud({
        method: 'POST',
        path: `${WORKBUDDY_PREFIX}/auth/token/refresh`,
        auth: doc.auth,
        refreshToken,
        deadlineMonoMs,
        signal,
        beforeSend: async () => {
          // Persist refresh_unknown immediately before the network send so a lost response
          // never triggers an unsafe replay of a rotated refresh token.
          doc.phase = 'refresh_unknown';
          await this.save(doc);
        },
      });
    } catch (err) {
      if (err instanceof WecomError) {
        if (err.code.startsWith('HTTP_401') || err.code.startsWith('HTTP_403')) {
          doc.phase = 'login_required';
          await this.save(doc);
        } else if (err.code === 'TRANSPORT_NOT_SENT' && doc.phase === 'refresh_unknown') {
          doc.phase = previousPhase;
          await this.save(doc);
        }
      }
      throw err;
    }

    doc.auth = normalizeAuth(refreshed, this.clock.now());
    doc.phase = 'pending_account';
    await this.save(doc);
    await this.fetchAccount(doc, deadlineMonoMs, signal);
  }

  private cachedWecom(doc: StoredCloudAuth): WecomCredential | null {
    const nowMs = this.clock.now();
    if (
      doc.phase === 'ready' &&
      isFresh(doc.auth?.expiresAt, nowMs) &&
      doc.wecom &&
      isFresh(doc.wecom.expires_at_ms, nowMs)
    ) {
      return doc.wecom;
    }
    return null;
  }

  async ensureWecom(options?: {
    force?: boolean;
    refreshAccount?: boolean;
    deadlineMonoMs?: number;
    signal?: AbortSignal;
  }): Promise<WecomCredential> {
    const force = options?.force ?? false;
    const forceRefreshAccount = options?.refreshAccount ?? false;

    if (!force && !forceRefreshAccount) {
      const cached = this.cachedWecom(await this.load());
      if (cached) return cached;
    }

    return this.lock.run('auth', async () => {
      const doc = await this.load();
      if (doc.phase === 'refresh_unknown') {
        throw new WecomError('REFRESH_OUTCOME_UNKNOWN_LOGIN_REQUIRED', true);
      }
      if (doc.phase === 'pending_account') {
        await this.fetchAccount(doc, options?.deadlineMonoMs, options?.signal);
      }
      if (doc.phase !== 'ready' || !doc.auth) {
        throw new WecomError('LOGIN_REQUIRED', true);
      }

      if (forceRefreshAccount || !isFresh(doc.auth.expiresAt, this.clock.now())) {
        await this.refreshAccount(doc, options?.deadlineMonoMs, options?.signal);
      }

      if (!force && !forceRefreshAccount) {
        const cachedAfterLock = this.cachedWecom(doc);
        if (cachedAfterLock) return cachedAfterLock;
      }

      const enterpriseId = doc.account?.enterpriseId;
      if (typeof enterpriseId !== 'string' || !enterpriseId) {
        throw new WecomError('ENTERPRISE_ACCOUNT_REQUIRED', true);
      }

      const route = `/console/enterprises/${encodeURIComponent(enterpriseId)}/oneid_openapi/exchange-wecom-token`;
      let exchanged: Record<string, unknown>;
      try {
        exchanged = await this.requestCloud({
          method: 'POST',
          path: route,
          auth: doc.auth,
          deadlineMonoMs: options?.deadlineMonoMs,
          signal: options?.signal,
        });
      } catch (err) {
        if (err instanceof WecomError && err.code.startsWith('HTTP_403')) {
          throw new WecomError('WECOM_AUTH_REQUIRED_OPEN_WECOM_LOGIN', true);
        }
        throw err;
      }

      const accessToken = assertSecret(exchanged.access_token);
      const user = exchanged.alias_id;
      const corp = exchanged.src_tid;
      if (typeof user !== 'string' || !user || typeof corp !== 'string' || !corp) {
        throw new WecomError('WECOM_STABLE_IDENTITY_MISSING');
      }

      const identity = createHash('sha256')
        .update(JSON.stringify([corp, user]))
        .digest('hex');
      if (doc.wecom && doc.wecom.identity !== identity) {
        throw new WecomError('WECOM_IDENTITY_CHANGED', true);
      }

      const expiresIn = parseDeadline(exchanged.expires_in);
      if (!expiresIn) {
        throw new WecomError('WECOM_EXPIRY_MISSING');
      }

      const credential: WecomCredential = {
        access_token: accessToken,
        identity,
        expires_at_ms: this.clock.now() + expiresIn * 1000,
        source: 'workbuddy_cloud',
      };
      doc.wecom = credential;
      await this.save(doc);
      return credential;
    });
  }

  async logout(): Promise<WorkBuddyStatus> {
    return this.lock.run('auth', async () => {
      await this.storage.remove(AUTH_STORAGE_KEY);
      const status = await this.status();
      if (this.onAuthChange) {
        await Promise.resolve(this.onAuthChange(status)).catch(() => {});
      }
      return status;
    });
  }
}
