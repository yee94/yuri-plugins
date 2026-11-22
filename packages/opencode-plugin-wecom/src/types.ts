export interface StorageScanOptions {
  readonly prefix: string;
  readonly after?: string;
  readonly limit?: number;
}

export interface StorageScanResult {
  readonly entries: readonly { readonly key: string; readonly value: unknown }[];
  readonly next?: string;
}

export interface StorageAdapter {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  scan(options: StorageScanOptions): Promise<StorageScanResult>;
}

export interface Clock {
  now(): number;
  monotonic(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface HttpRequest {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

export class WecomError extends Error {
  readonly code: string;
  readonly definitive: boolean;

  constructor(code: string, definitive = false) {
    super(code);
    this.name = 'WecomError';
    this.code = code;
    this.definitive = definitive;
  }
}

export const systemClock: Clock = {
  now: () => Date.now(),
  monotonic: () => performance.now(),
  sleep: (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new WecomError('ABORTED'));
        return;
      }
      const timer = setTimeout(
        () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        Math.max(0, ms),
      );
      const onAbort = () => {
        clearTimeout(timer);
        reject(new WecomError('ABORTED'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

export function hasControlOrSpaceChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function hasControlChar(
  value: string,
  options?: { readonly allowWhitespace?: boolean },
): boolean {
  const allowWhitespace = options?.allowWhitespace ?? false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x7f) return true;
    if (code < 0x20) {
      if (allowWhitespace && (code === 0x09 || code === 0x0a || code === 0x0d)) continue;
      return true;
    }
  }
  return false;
}

/**
 * Simple in-process async mutex keyed by string to prevent concurrent renewals or duplicate submits.
 */
export class AsyncKeyLock {
  private readonly queues = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.then(() => current);
    this.queues.set(key, next);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.queues.get(key) === next) {
        this.queues.delete(key);
      }
    }
  }
}
