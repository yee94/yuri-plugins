import type {
  Clock,
  HttpRequest,
  HttpResponse,
  HttpTransport,
  StorageAdapter,
} from '../src/types.js';

export function createMemoryStorage(): StorageAdapter {
  const map = new Map<string, unknown>();
  return {
    async get(key: string) {
      const value = map.get(key);
      return value === undefined ? undefined : structuredClone(value);
    },
    async set(key: string, value: unknown) {
      map.set(key, structuredClone(value));
    },
    async remove(key: string) {
      map.delete(key);
    },
    async scan({ prefix, after, limit = 100 }) {
      const keys = [...map.keys()]
        .filter((key) => key.startsWith(prefix) && (!after || key > after))
        .sort();
      const slice = keys.slice(0, limit);
      return {
        entries: slice.map((key) => ({ key, value: structuredClone(map.get(key)) })),
        next: keys.length > limit ? slice[slice.length - 1] : undefined,
      };
    },
  };
}

export interface FakeClock extends Clock {
  advance(ms: number): void;
  setNow(ms: number): void;
}

export function createFakeClock(initialMs = 1_700_000_000_000): FakeClock {
  let wallMs = initialMs;
  let monoMs = 1000;
  return {
    now: () => wallMs,
    monotonic: () => monoMs,
    async sleep(ms: number, signal?: AbortSignal) {
      if (signal?.aborted) {
        throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      }
      wallMs += ms;
      monoMs += ms;
    },
    advance(ms: number) {
      wallMs += ms;
      monoMs += ms;
    },
    setNow(ms: number) {
      wallMs = ms;
    },
  };
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export type RouteHandler = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;

export function createFakeTransport(handler: RouteHandler): {
  transport: HttpTransport;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const transport: HttpTransport = async (req) => {
    requests.push({
      method: req.method,
      url: req.url,
      headers: { ...req.headers },
      body: req.body,
    });
    return handler(req);
  };
  return { transport, requests };
}

export function jsonResponse(body: unknown, status = 200): HttpResponse {
  return { status, body: JSON.stringify(body) };
}
