import { type HttpRequest, type HttpResponse, type HttpTransport, WecomError } from './types.js';

const PRE_SEND_ERRNO = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH']);

function isPreSendError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as { code?: unknown; cause?: unknown };
  if (typeof record.code === 'string' && PRE_SEND_ERRNO.has(record.code)) return true;
  if (record.cause && record.cause !== err) return isPreSendError(record.cause);
  return false;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new WecomError('RESPONSE_TOO_LARGE');
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new WecomError('RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export function createFetchTransport(fetchImpl: typeof fetch = fetch): HttpTransport {
  return async (request: HttpRequest): Promise<HttpResponse> => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new WecomError('WAIT_TIMEOUT')),
      request.timeoutMs,
    );
    const onExternalAbort = () => controller.abort(new WecomError('ABORTED'));
    request.signal?.addEventListener('abort', onExternalAbort, { once: true });

    let response: Response;
    try {
      response = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onExternalAbort);
      if (err instanceof WecomError) throw err;
      if (request.signal?.aborted) throw new WecomError('ABORTED');
      if (isPreSendError(err)) throw new WecomError('TRANSPORT_NOT_SENT');
      throw new WecomError('TRANSPORT_UNCERTAIN');
    }

    try {
      if (response.status >= 300 && response.status < 400) {
        throw new WecomError('REDIRECT_REJECTED', true);
      }
      const body = await readBoundedText(response, request.maxBytes);
      return { status: response.status, body };
    } catch (err) {
      if (err instanceof WecomError) throw err;
      if (request.signal?.aborted) throw new WecomError('ABORTED');
      throw new WecomError('TRANSPORT_UNCERTAIN');
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onExternalAbort);
    }
  };
}
