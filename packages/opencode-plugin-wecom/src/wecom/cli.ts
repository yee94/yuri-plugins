import { execFile } from 'node:child_process';
import { hasControlChar, WecomError } from '../types.js';

export const ALLOWED_CLI_DOMAINS = [
  'doc',
  'smartsheet',
  'calendar',
  'meeting',
  'mail',
  'wedrive',
  'contact',
  'auth',
] as const;

export type WecomCliDomain = (typeof ALLOWED_CLI_DOMAINS)[number];

const ALLOWED_DOMAIN_SET = new Set<string>(ALLOWED_CLI_DOMAINS);
const WRITE_VERBS = new Set([
  'create',
  'add',
  'new',
  'update',
  'edit',
  'patch',
  'set',
  'put',
  'delete',
  'del',
  'remove',
  'rm',
  'send',
  'reply',
  'forward',
  'upload',
  'share',
  'cancel',
  'revoke',
  'move',
  'rename',
  'copy',
  'write',
]);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

export interface ProcessRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type ProcessRunner = (
  binary: string,
  args: readonly string[],
  options: { readonly timeoutMs: number; readonly signal?: AbortSignal },
) => Promise<ProcessRunResult>;

export interface WecomCliProbe {
  readonly available: boolean;
  readonly binary: string;
  readonly version?: string;
  readonly install_hint?: string;
}

export interface WecomCliRunInput {
  readonly domain: WecomCliDomain;
  readonly args: readonly string[];
  readonly timeout_ms?: number;
}

export interface WecomCliRunResult {
  readonly ok: boolean;
  readonly exit_code: number;
  readonly domain: WecomCliDomain;
  readonly data?: unknown;
  readonly stdout: string;
  readonly stderr: string;
}

export interface WecomCliBridgeOptions {
  readonly binary?: string;
  readonly allowWrite?: boolean;
  readonly runner?: ProcessRunner;
}

function defaultProcessRunner(
  binary: string,
  args: readonly string[],
  options: { readonly timeoutMs: number; readonly signal?: AbortSignal },
): Promise<ProcessRunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      [...args],
      {
        shell: false,
        timeout: options.timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        signal: options.signal,
        encoding: 'utf8',
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ exitCode: 0, stdout: stdout ?? '', stderr: stderr ?? '' });
          return;
        }
        const record = err as NodeJS.ErrnoException & { code?: string | number };
        if (record.code === 'ENOENT') {
          reject(record);
          return;
        }
        if (typeof record.code === 'number') {
          resolve({ exitCode: record.code, stdout: stdout ?? '', stderr: stderr ?? '' });
          return;
        }
        reject(err);
      },
    );
  });
}

function isNotInstalledError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: unknown }).code === 'ENOENT');
}

function validateArgs(args: readonly string[], allowWrite: boolean): string[] {
  if (!Array.isArray(args) || args.length === 0 || args.length > 32) {
    throw new WecomError('INVALID_CLI_ARGS', true);
  }
  const clean: string[] = [];
  for (const raw of args) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1000 || hasControlChar(raw)) {
      throw new WecomError('INVALID_CLI_ARGS', true);
    }
    clean.push(raw);
  }

  if (!allowWrite) {
    for (const token of clean) {
      if (token.startsWith('-')) continue;
      const lower = token.toLowerCase();
      if (WRITE_VERBS.has(lower)) {
        throw new WecomError('WECOM_CLI_WRITE_BLOCKED', true);
      }
      break;
    }
  }
  return clean;
}

export class WecomCliBridge {
  private readonly binary: string;
  private readonly allowWrite: boolean;
  private readonly runner: ProcessRunner;

  constructor(options?: WecomCliBridgeOptions) {
    this.binary = options?.binary?.trim() || 'wecom';
    this.allowWrite = options?.allowWrite ?? false;
    this.runner = options?.runner ?? defaultProcessRunner;
  }

  async probe(signal?: AbortSignal): Promise<WecomCliProbe> {
    try {
      const res = await this.runner(this.binary, ['--version'], {
        timeoutMs: 5_000,
        signal,
      });
      if (res.exitCode === 0) {
        const version = res.stdout.trim().split(/\r?\n/)[0]?.trim() || 'unknown';
        return { available: true, binary: this.binary, version };
      }
      return {
        available: false,
        binary: this.binary,
        install_hint: 'npm install -g @wecom/cli',
      };
    } catch {
      return {
        available: false,
        binary: this.binary,
        install_hint: 'npm install -g @wecom/cli',
      };
    }
  }

  async run(input: WecomCliRunInput, signal?: AbortSignal): Promise<WecomCliRunResult> {
    if (typeof input.domain !== 'string' || !ALLOWED_DOMAIN_SET.has(input.domain)) {
      throw new WecomError('WECOM_CLI_DOMAIN_BLOCKED', true);
    }
    const cleanArgs = validateArgs(input.args, this.allowWrite);
    const timeoutMs =
      input.timeout_ms !== undefined && Number.isFinite(input.timeout_ms)
        ? Math.max(1_000, Math.min(120_000, Math.floor(input.timeout_ms)))
        : DEFAULT_TIMEOUT_MS;

    let result: ProcessRunResult;
    try {
      result = await this.runner(this.binary, [input.domain, ...cleanArgs], {
        timeoutMs,
        signal,
      });
    } catch (err) {
      if (isNotInstalledError(err)) {
        throw new WecomError('WECOM_CLI_NOT_INSTALLED', true);
      }
      if (signal?.aborted) {
        throw new WecomError('ABORTED');
      }
      throw new WecomError('WECOM_CLI_EXECUTION_FAILED');
    }

    let data: unknown;
    const trimmed = result.stdout.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        data = JSON.parse(trimmed);
      } catch {
        data = undefined;
      }
    }

    return {
      ok: result.exitCode === 0,
      exit_code: result.exitCode,
      domain: input.domain,
      ...(data !== undefined ? { data } : {}),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}
