import { createHash, randomUUID } from 'node:crypto';
import type { WecomCredential } from '../auth/workbuddy.js';
import { createFetchTransport } from '../http.js';
import {
  AsyncKeyLock,
  type Clock,
  type HttpTransport,
  hasControlChar,
  type StorageAdapter,
  systemClock,
  WecomError,
} from '../types.js';

export const DAYUAN_A2A_ORIGIN = 'https://qyapi.weixin.qq.com';
export const DAYUAN_A2A_BASE_PATH = '/cgi-bin/a2a/api';
export const A2A_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const RECEIPT_PREFIX = 'wecom/a2a/receipt/';
const TASK_PREFIX = 'wecom/a2a/task/';
const POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_WAIT_SECONDS = 120;
const DEFAULT_WAIT_SECONDS = 20;
const SAFE_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const TOKEN_EXPIRED_ERRCODES = new Set([40001, 40014, 42001]);

export type DayuanAction = 'search_groups' | 'read_chat' | 'search_messages';

export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected'
  | 'unknown';

export type InteractionKind = 'none' | 'text_clarification' | 'approval_required' | 'unsupported';

export interface SearchGroupsInput {
  readonly action: 'search_groups';
  readonly query: string;
  readonly limit?: number;
  readonly request_id?: string;
  readonly wait_seconds?: number;
}

export interface ReadChatInput {
  readonly action: 'read_chat';
  readonly chat_name: string;
  readonly question: string;
  readonly time_range?: string;
  readonly request_id?: string;
  readonly wait_seconds?: number;
}

export interface SearchMessagesInput {
  readonly action: 'search_messages';
  readonly query: string;
  readonly chat_name?: string;
  readonly time_range?: string;
  readonly request_id?: string;
  readonly wait_seconds?: number;
}

export type DayuanReadStartInput = SearchGroupsInput | ReadChatInput | SearchMessagesInput;

export interface DayuanReadResultInput {
  readonly task_id: string;
  readonly wait_seconds?: number;
}

export interface DayuanReadReplyInput {
  readonly task_id: string;
  readonly text: string;
  readonly request_id?: string;
  readonly wait_seconds?: number;
}

export interface DayuanProgressUpdate {
  readonly task_id: string;
  readonly state: A2ATaskState;
  readonly poll_count: number;
}

export interface DayuanCallOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (update: DayuanProgressUpdate) => void | Promise<void>;
}

export interface DayuanTaskResult {
  readonly task_id: string;
  readonly context_id?: string;
  readonly request_id?: string;
  readonly action?: DayuanAction;
  readonly state: A2ATaskState;
  readonly completed: boolean;
  readonly is_summary: true;
  readonly summary: string;
  readonly interaction_kind: InteractionKind;
  readonly can_reply_in_text: boolean;
  readonly human_action_required: boolean;
  readonly guidance?: string;
  readonly from_cache: boolean;
  readonly updated_at_ms: number;
}

export interface DayuanReceiptSummary {
  readonly request_id: string;
  readonly action: DayuanAction;
  readonly status: 'submit_unknown' | A2ATaskState;
  readonly task_id?: string;
  readonly summary_preview?: string;
  readonly updated_at_ms: number;
}

interface StoredReceipt {
  request_id: string;
  identity: string;
  action: DayuanAction;
  fingerprint: string;
  status: 'submit_unknown' | A2ATaskState;
  task_id?: string;
  context_id?: string;
  result?: DayuanTaskResult;
  created_at_ms: number;
  updated_at_ms: number;
}

interface StoredTaskRecord {
  task_id: string;
  context_id?: string;
  identity: string;
  action?: DayuanAction;
  request_id?: string;
  result: DayuanTaskResult;
}

export interface WecomCredentialProvider {
  ensureWecom(options?: {
    force?: boolean;
    refreshAccount?: boolean;
    deadlineMonoMs?: number;
    signal?: AbortSignal;
  }): Promise<WecomCredential>;
}

export interface DayuanA2AClientOptions {
  readonly auth: WecomCredentialProvider;
  readonly storage: StorageAdapter;
  readonly transport?: HttpTransport;
  readonly clock?: Clock;
}

function cleanText(value: unknown, field: string, maxLength = 2000): string {
  if (typeof value !== 'string') {
    throw new WecomError(`INVALID_${field.toUpperCase()}`, true);
  }
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length > maxLength ||
    hasControlChar(trimmed, { allowWhitespace: true })
  ) {
    throw new WecomError(`INVALID_${field.toUpperCase()}`, true);
  }
  return trimmed;
}

function cleanOptionalText(value: unknown, field: string, maxLength = 500): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return cleanText(value, field, maxLength);
}

function assertSafeId(value: string, field: string): string {
  const trimmed = value.trim();
  if (!SAFE_ID_RE.test(trimmed)) {
    throw new WecomError(`INVALID_${field.toUpperCase()}`, true);
  }
  return trimmed;
}

function normalizeWaitSeconds(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WAIT_SECONDS;
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), MAX_WAIT_SECONDS);
}

function normalizeState(raw: unknown): A2ATaskState {
  if (typeof raw !== 'string') return 'unknown';
  const normalized = raw.trim().toLowerCase().replace(/-/g, '_');
  switch (normalized) {
    case 'submitted':
    case 'working':
    case 'input_required':
    case 'completed':
    case 'failed':
    case 'canceled':
    case 'rejected':
      return normalized;
    case 'cancelled':
      return 'canceled';
    default:
      return 'unknown';
  }
}

function isTerminalState(state: A2ATaskState): boolean {
  return (
    state === 'completed' || state === 'failed' || state === 'canceled' || state === 'rejected'
  );
}

function isSettledForWait(state: A2ATaskState): boolean {
  return isTerminalState(state) || state === 'input_required';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function collectParts(payload: Record<string, unknown>): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = [];
  const pushFrom = (container: unknown) => {
    const rec = asRecord(container);
    if (!rec) return;
    if (Array.isArray(rec.parts)) {
      for (const item of rec.parts) {
        const part = asRecord(item);
        if (part) parts.push(part);
      }
    }
  };

  if (Array.isArray(payload.artifacts)) {
    for (const artifact of payload.artifacts) {
      pushFrom(artifact);
    }
  }
  const status = asRecord(payload.status);
  if (status) {
    pushFrom(status.message);
  }
  pushFrom(payload.message);
  return parts;
}

function hasApprovalMarker(value: unknown, depth = 0): boolean {
  if (depth > 5 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasApprovalMarker(item, depth + 1));
  }
  const rec = value as Record<string, unknown>;
  if (rec.wecom_part_type === 'approval' || rec.part_type === 'approval') return true;
  if (Array.isArray(rec.token_id_list) && rec.token_id_list.length > 0) return true;
  if (typeof rec.approval_id === 'string' && rec.approval_id.length > 0) return true;
  for (const child of Object.values(rec)) {
    if (child && typeof child === 'object' && hasApprovalMarker(child, depth + 1)) {
      return true;
    }
  }
  return false;
}

function extractSummaryText(parts: readonly Record<string, unknown>[]): string {
  const lines: string[] = [];
  for (const part of parts) {
    if (typeof part.text === 'string' && part.text.trim()) {
      lines.push(part.text.trim());
    } else if (part.data && typeof part.data === 'object') {
      const data = part.data as Record<string, unknown>;
      if (typeof data.text === 'string' && data.text.trim()) {
        lines.push(data.text.trim());
      } else if (typeof data.title === 'string' && data.title.trim()) {
        lines.push(data.title.trim());
      }
    }
  }
  return lines.join('\n\n').trim();
}

function buildReadOnlyPrompt(input: DayuanReadStartInput): {
  prompt: string;
  canonical: Record<string, unknown>;
} {
  if (input.action === 'search_groups') {
    const query = cleanText(input.query, 'query', 300);
    const limit =
      input.limit !== undefined && Number.isFinite(input.limit)
        ? Math.max(1, Math.min(20, Math.floor(input.limit)))
        : 10;
    return {
      prompt: `只读查询：请在企业微信中查找名称或主题与「${query}」相关的群聊，最多列出 ${limit} 个候选群名及简短说明。不要发送任何消息或执行写操作。`,
      canonical: { action: input.action, query, limit },
    };
  }
  if (input.action === 'read_chat') {
    const chatName = cleanText(input.chat_name, 'chat_name', 300);
    const question = cleanText(input.question, 'question', 1500);
    const timeRange = cleanOptionalText(input.time_range, 'time_range', 200);
    const timeClause = timeRange ? `（时间范围：${timeRange}）` : '';
    return {
      prompt: `只读查询：请阅读企业微信群聊「${chatName}」${timeClause}，回答以下问题并给出要点摘要：${question}。不要发送任何消息或执行写操作。`,
      canonical: {
        action: input.action,
        chat_name: chatName,
        question,
        time_range: timeRange ?? null,
      },
    };
  }
  const query = cleanText(input.query, 'query', 1000);
  const chatName = cleanOptionalText(input.chat_name, 'chat_name', 300);
  const timeRange = cleanOptionalText(input.time_range, 'time_range', 200);
  const scope = [
    chatName ? `限定群聊「${chatName}」` : null,
    timeRange ? `时间范围：${timeRange}` : null,
  ]
    .filter(Boolean)
    .join('，');
  const scopeClause = scope ? `（${scope}）` : '';
  return {
    prompt: `只读查询：请在企业微信消息中检索与「${query}」相关的内容${scopeClause}，汇总相关讨论结论与来源群名。不要发送任何消息或执行写操作。`,
    canonical: {
      action: input.action,
      query,
      chat_name: chatName ?? null,
      time_range: timeRange ?? null,
    },
  };
}

function fingerprintOf(canonical: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function buildWhitelistedUrl(route: { kind: 'send' } | { kind: 'task'; taskId: string }): string {
  if (route.kind === 'send') {
    return `${DAYUAN_A2A_ORIGIN}${DAYUAN_A2A_BASE_PATH}/message:send`;
  }
  const safeId = assertSafeId(route.taskId, 'task_id');
  return `${DAYUAN_A2A_ORIGIN}${DAYUAN_A2A_BASE_PATH}/tasks/${encodeURIComponent(safeId)}?historyLength=0`;
}

export class DayuanA2AClient {
  private readonly auth: WecomCredentialProvider;
  private readonly storage: StorageAdapter;
  private readonly transport: HttpTransport;
  private readonly clock: Clock;
  private readonly lock = new AsyncKeyLock();

  constructor(options: DayuanA2AClientOptions) {
    this.auth = options.auth;
    this.storage = options.storage;
    this.transport = options.transport ?? createFetchTransport();
    this.clock = options.clock ?? systemClock;
  }

  private receiptKey(identity: string, requestId: string): string {
    return `${RECEIPT_PREFIX}${identity}/${requestId}`;
  }

  private taskKey(taskId: string): string {
    return `${TASK_PREFIX}${taskId}`;
  }

  private parseTaskPayload(
    raw: Record<string, unknown>,
    meta: { request_id?: string; action?: DayuanAction; from_cache: boolean },
  ): DayuanTaskResult {
    const taskObj = asRecord(raw.result) ?? asRecord(raw.task) ?? raw;
    const rawId = taskObj.id ?? taskObj.taskId ?? raw.id;
    if (typeof rawId !== 'string' || !rawId.trim()) {
      throw new WecomError('A2A_TASK_ID_MISSING');
    }
    const taskId = assertSafeId(rawId, 'task_id');
    const contextId =
      typeof taskObj.contextId === 'string' && taskObj.contextId ? taskObj.contextId : undefined;
    const statusObj = asRecord(taskObj.status);
    const state = normalizeState(statusObj?.state ?? taskObj.state);
    const parts = collectParts(taskObj);
    const summary = extractSummaryText(parts);

    let interactionKind: InteractionKind = 'none';
    let canReplyInText = false;
    let humanActionRequired = false;
    let guidance: string | undefined;

    if (state === 'input_required') {
      if (hasApprovalMarker(parts) || hasApprovalMarker(taskObj)) {
        interactionKind = 'approval_required';
        canReplyInText = false;
        humanActionRequired = true;
        guidance =
          '检测到企业微信敏感审批卡片（approval），插件已禁止自动代批。请在手机企业微信中手动确认审批后再重新查询。';
      } else if (summary.length > 0) {
        interactionKind = 'text_clarification';
        canReplyInText = true;
        guidance = '大圆需要进一步澄清问题，请调用 wecom_read_reply 回复澄清文本。';
      } else {
        interactionKind = 'unsupported';
        canReplyInText = false;
        humanActionRequired = true;
        guidance =
          '任务处于 input_required 状态但未包含可回复的文本澄清内容，请在企业微信客户端查看。';
      }
    }

    return {
      task_id: taskId,
      ...(contextId ? { context_id: contextId } : {}),
      ...(meta.request_id ? { request_id: meta.request_id } : {}),
      ...(meta.action ? { action: meta.action } : {}),
      state,
      completed: isTerminalState(state),
      is_summary: true,
      summary,
      interaction_kind: interactionKind,
      can_reply_in_text: canReplyInText,
      human_action_required: humanActionRequired,
      ...(guidance ? { guidance } : {}),
      from_cache: meta.from_cache,
      updated_at_ms: this.clock.now(),
    };
  }

  private async requestA2A(options: {
    method: 'GET' | 'POST';
    route: { kind: 'send' } | { kind: 'task'; taskId: string };
    body?: Record<string, unknown>;
    signal?: AbortSignal;
    allowAuthRetry?: boolean;
  }): Promise<{ payload: Record<string, unknown>; identity: string }> {
    const url = buildWhitelistedUrl(options.route);
    let credential = await this.auth.ensureWecom({ signal: options.signal });

    const executeOnce = async (token: string) => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      };
      let serialized: string | undefined;
      if (options.method === 'POST') {
        headers['Content-Type'] = 'application/json';
        serialized = JSON.stringify(options.body ?? {});
      }
      const response = await this.transport({
        method: options.method,
        url,
        headers,
        body: serialized,
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxBytes: A2A_MAX_RESPONSE_BYTES,
        signal: options.signal,
      });

      let parsed: Record<string, unknown> = {};
      if (response.body.trim()) {
        try {
          const decoded = JSON.parse(response.body);
          if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
            throw new WecomError('INVALID_A2A_JSON');
          }
          parsed = decoded as Record<string, unknown>;
        } catch (err) {
          if (err instanceof WecomError) throw err;
          throw new WecomError('INVALID_A2A_JSON');
        }
      }

      const errcode = typeof parsed.errcode === 'number' ? parsed.errcode : 0;
      const isAuthFailure = response.status === 401 || TOKEN_EXPIRED_ERRCODES.has(errcode);
      return { status: response.status, errcode, parsed, isAuthFailure };
    };

    let attempt = await executeOnce(credential.access_token);
    if (attempt.isAuthFailure && (options.allowAuthRetry ?? true)) {
      credential = await this.auth.ensureWecom({ force: true, signal: options.signal });
      attempt = await executeOnce(credential.access_token);
    }

    if (attempt.isAuthFailure) {
      throw new WecomError('WECOM_TOKEN_REJECTED_LOGIN_REQUIRED', true);
    }
    if (attempt.status === 403) {
      throw new WecomError('A2A_FORBIDDEN', true);
    }
    if (attempt.status < 200 || attempt.status >= 300) {
      throw new WecomError(`A2A_HTTP_${attempt.status}`);
    }
    if (attempt.errcode !== 0) {
      throw new WecomError(`A2A_ERRCODE_${attempt.errcode}`);
    }
    return { payload: attempt.parsed, identity: credential.identity };
  }

  private async saveTaskRecord(record: StoredTaskRecord): Promise<void> {
    await this.storage.set(this.taskKey(record.task_id), record);
  }

  private async loadTaskRecord(taskId: string): Promise<StoredTaskRecord | undefined> {
    const raw = await this.storage.get(this.taskKey(taskId));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    return raw as StoredTaskRecord;
  }

  private async pollTask(
    initial: DayuanTaskResult,
    identity: string,
    waitSeconds: number,
    options?: DayuanCallOptions,
  ): Promise<DayuanTaskResult> {
    let current = initial;
    if (isSettledForWait(current.state) || waitSeconds <= 0) {
      return current;
    }

    const deadlineMono = this.clock.monotonic() + waitSeconds * 1000;
    let pollCount = 0;

    while (!isSettledForWait(current.state)) {
      const remaining = deadlineMono - this.clock.monotonic();
      if (remaining <= 0) break;

      pollCount += 1;
      if (options?.onProgress) {
        await Promise.resolve(
          options.onProgress({
            task_id: current.task_id,
            state: current.state,
            poll_count: pollCount,
          }),
        );
      }

      await this.clock.sleep(Math.min(POLL_INTERVAL_MS, remaining), options?.signal);
      const { payload } = await this.requestA2A({
        method: 'GET',
        route: { kind: 'task', taskId: current.task_id },
        signal: options?.signal,
      });

      current = this.parseTaskPayload(payload, {
        request_id: current.request_id,
        action: current.action,
        from_cache: false,
      });

      await this.saveTaskRecord({
        task_id: current.task_id,
        context_id: current.context_id,
        identity,
        action: current.action,
        request_id: current.request_id,
        result: current,
      });
    }

    return current;
  }

  async start(input: DayuanReadStartInput, options?: DayuanCallOptions): Promise<DayuanTaskResult> {
    const { prompt, canonical } = buildReadOnlyPrompt(input);
    const requestId = input.request_id
      ? assertSafeId(input.request_id, 'request_id')
      : randomUUID();
    const waitSeconds = normalizeWaitSeconds(input.wait_seconds);
    const fingerprint = fingerprintOf(canonical);

    const credential = await this.auth.ensureWecom({ signal: options?.signal });
    const receiptKey = this.receiptKey(credential.identity, requestId);

    return this.lock.run(`receipt:${receiptKey}`, async () => {
      const existingRaw = await this.storage.get(receiptKey);
      const existing = asRecord(existingRaw) as StoredReceipt | undefined;

      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new WecomError('REQUEST_ID_CONFLICT', true);
        }
        if (existing.status === 'submit_unknown') {
          throw new WecomError('SUBMIT_OUTCOME_UNKNOWN', true);
        }
        if (existing.result && isSettledForWait(existing.result.state)) {
          return { ...existing.result, from_cache: true };
        }
        if (existing.task_id) {
          const polled = await this.getResult(
            { task_id: existing.task_id, wait_seconds: waitSeconds },
            options,
          );
          existing.status = polled.state;
          existing.result = polled;
          existing.updated_at_ms = this.clock.now();
          await this.storage.set(receiptKey, existing);
          return polled;
        }
      }

      const now = this.clock.now();
      const pendingReceipt: StoredReceipt = {
        request_id: requestId,
        identity: credential.identity,
        action: input.action,
        fingerprint,
        status: 'submit_unknown',
        created_at_ms: now,
        updated_at_ms: now,
      };
      // Write-ahead barrier before network submission so uncertain failures never replay blindly.
      await this.storage.set(receiptKey, pendingReceipt);

      let payload: Record<string, unknown>;
      let identity: string;
      try {
        const res = await this.requestA2A({
          method: 'POST',
          route: { kind: 'send' },
          body: {
            message: {
              messageId: requestId,
              role: 'user',
              parts: [{ kind: 'text', text: prompt }],
            },
          },
          signal: options?.signal,
        });
        payload = res.payload;
        identity = res.identity;
      } catch (err) {
        if (err instanceof WecomError && (err.code === 'TRANSPORT_NOT_SENT' || err.definitive)) {
          await this.storage.remove(receiptKey);
        }
        throw err;
      }

      let result = this.parseTaskPayload(payload, {
        request_id: requestId,
        action: input.action,
        from_cache: false,
      });

      await this.saveTaskRecord({
        task_id: result.task_id,
        context_id: result.context_id,
        identity,
        action: input.action,
        request_id: requestId,
        result,
      });

      result = await this.pollTask(result, identity, waitSeconds, options);

      const finalized: StoredReceipt = {
        ...pendingReceipt,
        identity,
        status: result.state,
        task_id: result.task_id,
        context_id: result.context_id,
        result,
        updated_at_ms: this.clock.now(),
      };
      await this.storage.set(receiptKey, finalized);
      return result;
    });
  }

  async getResult(
    input: DayuanReadResultInput,
    options?: DayuanCallOptions,
  ): Promise<DayuanTaskResult> {
    const taskId = assertSafeId(input.task_id, 'task_id');
    const waitSeconds = normalizeWaitSeconds(input.wait_seconds);

    const existing = await this.loadTaskRecord(taskId);
    if (existing && isTerminalState(existing.result.state)) {
      return { ...existing.result, from_cache: true };
    }

    const { payload, identity } = await this.requestA2A({
      method: 'GET',
      route: { kind: 'task', taskId },
      signal: options?.signal,
    });

    let result = this.parseTaskPayload(payload, {
      request_id: existing?.request_id,
      action: existing?.action,
      from_cache: false,
    });

    await this.saveTaskRecord({
      task_id: result.task_id,
      context_id: result.context_id ?? existing?.context_id,
      identity,
      action: existing?.action,
      request_id: existing?.request_id,
      result,
    });

    result = await this.pollTask(result, identity, waitSeconds, options);

    if (existing?.request_id) {
      const rKey = this.receiptKey(identity, existing.request_id);
      const rRaw = asRecord(await this.storage.get(rKey)) as StoredReceipt | undefined;
      if (rRaw) {
        rRaw.status = result.state;
        rRaw.result = result;
        rRaw.updated_at_ms = this.clock.now();
        await this.storage.set(rKey, rRaw);
      }
    }

    return result;
  }

  async reply(input: DayuanReadReplyInput, options?: DayuanCallOptions): Promise<DayuanTaskResult> {
    const taskId = assertSafeId(input.task_id, 'task_id');
    const text = cleanText(input.text, 'text', 1500);
    const waitSeconds = normalizeWaitSeconds(input.wait_seconds);
    const replyMessageId = input.request_id
      ? assertSafeId(input.request_id, 'request_id')
      : randomUUID();

    return this.lock.run(`task:${taskId}`, async () => {
      let record = await this.loadTaskRecord(taskId);
      if (!record) {
        const fetched = await this.getResult({ task_id: taskId, wait_seconds: 0 }, options);
        record = await this.loadTaskRecord(fetched.task_id);
      }

      if (record?.result.state !== 'input_required') {
        throw new WecomError('TASK_NOT_WAITING_FOR_INPUT', true);
      }
      if (record.result.interaction_kind === 'approval_required') {
        throw new WecomError('APPROVAL_INTERACTION_BLOCKED', true);
      }
      if (!record.result.can_reply_in_text) {
        throw new WecomError('UNSUPPORTED_INTERACTION_BLOCKED', true);
      }

      const { payload, identity } = await this.requestA2A({
        method: 'POST',
        route: { kind: 'send' },
        body: {
          message: {
            messageId: replyMessageId,
            role: 'user',
            taskId,
            ...(record.context_id ? { contextId: record.context_id } : {}),
            parts: [{ kind: 'text', text }],
          },
        },
        signal: options?.signal,
      });

      let result = this.parseTaskPayload(payload, {
        request_id: record.request_id,
        action: record.action,
        from_cache: false,
      });

      await this.saveTaskRecord({
        task_id: result.task_id,
        context_id: result.context_id ?? record.context_id,
        identity,
        action: record.action,
        request_id: record.request_id,
        result,
      });

      result = await this.pollTask(result, identity, waitSeconds, options);

      if (record.request_id) {
        const rKey = this.receiptKey(identity, record.request_id);
        const rRaw = asRecord(await this.storage.get(rKey)) as StoredReceipt | undefined;
        if (rRaw) {
          rRaw.status = result.state;
          rRaw.result = result;
          rRaw.updated_at_ms = this.clock.now();
          await this.storage.set(rKey, rRaw);
        }
      }

      return result;
    });
  }

  async listReceipts(limit = 20): Promise<DayuanReceiptSummary[]> {
    const max = Math.max(1, Math.min(100, Math.floor(limit)));
    const items: StoredReceipt[] = [];
    let after: string | undefined;

    while (items.length < 200) {
      const page = await this.storage.scan({ prefix: RECEIPT_PREFIX, after, limit: 50 });
      for (const entry of page.entries) {
        const rec = asRecord(entry.value) as StoredReceipt | undefined;
        if (rec && typeof rec.request_id === 'string') {
          items.push(rec);
        }
      }
      if (!page.next) break;
      after = page.next;
    }

    items.sort((a, b) => (b.updated_at_ms ?? 0) - (a.updated_at_ms ?? 0));
    return items.slice(0, max).map((rec) => {
      const preview = rec.result?.summary ? rec.result.summary.slice(0, 140) : undefined;
      return {
        request_id: rec.request_id,
        action: rec.action,
        status: rec.status,
        ...(rec.task_id ? { task_id: rec.task_id } : {}),
        ...(preview ? { summary_preview: preview } : {}),
        updated_at_ms: rec.updated_at_ms,
      };
    });
  }
}
