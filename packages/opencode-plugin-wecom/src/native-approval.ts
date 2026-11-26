import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createConnection, createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORKBUDDY_UNPACKED = '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked';
const SDK_PATH = join(
  WORKBUDDY_UNPACKED,
  'resources/wecom-agent-confirm/libWeComAgentConfirmSDK.dylib',
);
const MAX_REQUEST_BYTES = 16 * 1024;

interface Position {
  readonly x: number;
  readonly y: number;
}

interface NativeApprovalServerOptions {
  readonly appVersion: string;
  readonly position: () => Position | undefined;
  readonly socketPath?: string;
  readonly requestPanel?: (token: string, position?: Position) => boolean;
  readonly confirmPanel?: () => boolean | Promise<boolean>;
  readonly autoConfirm?: boolean;
}

interface KoffiLibrary {
  func(signature: string): unknown;
}

interface Koffi {
  load(path: string): KoffiLibrary;
}

interface NativeBinding {
  initialize(appVersion: string): number;
  uninitialize(): void;
  requestPanel(tokens: string[], x: number, y: number): number;
  closePanel(tokens: string[]): number;
  isWeComAlive(): boolean;
  getWeComVersion(): string | undefined;
  confirmApproval?: () => boolean;
}

function socketPath(): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  return join(tmpdir(), `opencode-plugin-wecom-${uid}.sock`);
}

function tokenFromApprovalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'wxwork:' ||
      url.hostname !== 'jump' ||
      url.pathname ||
      url.searchParams.get('target') !== 'agent_confirm' ||
      [...url.searchParams.keys()].some((key) => key !== 'target' && key !== 'token')
    ) {
      return undefined;
    }
    const token = url.searchParams.get('token')?.trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

function compareVersion(left: string, right: string): number {
  const a = left.split('.');
  const b = right.split('.');
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = Number.parseInt(a[index] ?? '0', 10) - Number.parseInt(b[index] ?? '0', 10);
    if (difference !== 0) return difference;
  }
  return 0;
}

function createAccessibilityConfirmation(koffi: Koffi): (() => boolean) | undefined {
  try {
    const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
    const ax = koffi.load(
      '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices',
    );
    const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
    const objc = koffi.load('/usr/lib/libobjc.dylib');
    const createString = cf.func(
      'void *CFStringCreateWithCString(void *, const char *, uint32_t)',
    ) as (allocator: null, value: string, encoding: number) => unknown;
    const readCString = cf.func('bool CFStringGetCString(void *, char *, long, uint32_t)') as (
      value: unknown,
      buffer: Buffer,
      length: number,
      encoding: number,
    ) => boolean;
    const release = cf.func('void CFRelease(void *)') as (value: unknown) => void;
    const retain = cf.func('void *CFRetain(void *)') as (value: unknown) => unknown;
    const hash = cf.func('unsigned long CFHash(void *)') as (value: unknown) => number;
    const arrayCount = cf.func('long CFArrayGetCount(void *)') as (value: unknown) => number;
    const arrayValue = cf.func('void *CFArrayGetValueAtIndex(void *, long)') as (
      value: unknown,
      index: number,
    ) => unknown;
    const trusted = ax.func('bool AXIsProcessTrusted()') as () => boolean;
    const mainDisplay = cg.func('uint32_t CGMainDisplayID()') as () => number;
    const displayIsActive = cg.func('bool CGDisplayIsActive(uint32_t)') as (
      display: number,
    ) => boolean;
    const createApplication = ax.func('void *AXUIElementCreateApplication(int)') as (
      pid: number,
    ) => unknown;
    const copyAttribute = ax.func(
      'int AXUIElementCopyAttributeValue(void *, void *, _Out_ void **)',
    ) as (element: unknown, attribute: unknown, output: unknown[]) => number;
    const performAction = ax.func('int AXUIElementPerformAction(void *, void *)') as (
      element: unknown,
      action: unknown,
    ) => number;
    const getValue = ax.func('bool AXValueGetValue(void *, uint32_t, void *)') as (
      value: unknown,
      type: number,
      output: Buffer,
    ) => boolean;
    const getClass = objc.func('void *objc_getClass(const char *)') as (name: string) => unknown;
    const getSelector = objc.func('void *sel_registerName(const char *)') as (
      name: string,
    ) => unknown;
    const objectMessageWithIndex = objc.func(
      'void *objc_msgSend(void *, void *, unsigned long)',
    ) as (receiver: unknown, selector: unknown, index: number) => unknown;
    const objectMessageWithObject = objc.func('void *objc_msgSend(void *, void *, void *)') as (
      receiver: unknown,
      selector: unknown,
      argument: unknown,
    ) => unknown;
    const intMessage = objc.func('int objc_msgSend(void *, void *)') as (
      receiver: unknown,
      selector: unknown,
    ) => number;
    const encoding = 0x08000100;
    const confirmLabels = new Set([
      '同意',
      '允许',
      '确认',
      '继续',
      '仍然允许',
      '仍要发送',
      'accept',
      'allow',
      'confirm',
      'continue',
    ]);
    const cancelLabels = new Set(['取消', '拒绝', '暂不允许', 'cancel', 'decline', 'reject']);

    const stringRef = (value: string) => createString(null, value, encoding);
    const stringValue = (value: unknown) => {
      const buffer = Buffer.alloc(1024);
      return readCString(value, buffer, buffer.length, encoding)
        ? buffer.toString('utf8', 0, buffer.indexOf(0))
        : undefined;
    };
    const attribute = (element: unknown, name: string) => {
      const key = stringRef(name);
      const output: unknown[] = [null];
      try {
        return copyAttribute(element, key, output) === 0 ? output[0] : undefined;
      } finally {
        release(key);
      }
    };
    const attributeString = (element: unknown, name: string) => {
      const value = attribute(element, name);
      if (!value) return undefined;
      try {
        return stringValue(value);
      } finally {
        release(value);
      }
    };
    const visit = (root: unknown, visitor: (element: unknown) => void) => {
      const seen = new Set<number>();
      let visited = 0;
      const walk = (element: unknown, depth: number) => {
        if (depth > 12 || visited >= 300) return;
        const identity = hash(element);
        if (seen.has(identity)) return;
        seen.add(identity);
        visited += 1;
        visitor(element);
        const children =
          attribute(element, 'AXVisibleChildren') ?? attribute(element, 'AXChildren');
        if (!children) return;
        try {
          const count = Math.min(arrayCount(children), 100);
          for (let index = 0; index < count; index += 1) {
            walk(arrayValue(children, index), depth + 1);
          }
        } finally {
          release(children);
        }
      };
      walk(root, 0);
    };
    const buttonLabel = (element: unknown) => {
      if (attributeString(element, 'AXRole') !== 'AXButton') return undefined;
      const label = [attributeString(element, 'AXTitle'), attributeString(element, 'AXDescription')]
        .find((value) => value?.trim())
        ?.trim();
      return label ? { label, normalized: label.toLowerCase() } : undefined;
    };
    const isPanelWindow = (element: unknown) => {
      const value = attribute(element, 'AXSize');
      if (!value) return true;
      try {
        const size = Buffer.alloc(16);
        if (!getValue(value, 1, size)) return false;
        return size.readDoubleLE(0) <= 700 && size.readDoubleLE(8) <= 400;
      } finally {
        release(value);
      }
    };

    return () => {
      if (!trusted() || !displayIsActive(mainDisplay())) return false;
      let bundle: unknown;
      let applications: unknown;
      const candidates: unknown[] = [];
      try {
        bundle = stringRef('com.tencent.WeWorkMac');
        applications = objectMessageWithObject(
          getClass('NSRunningApplication'),
          getSelector('runningApplicationsWithBundleIdentifier:'),
          bundle,
        );
        if (!applications) return false;
        const applicationCount = Math.min(intMessage(applications, getSelector('count')), 8);
        for (let applicationIndex = 0; applicationIndex < applicationCount; applicationIndex += 1) {
          const running = objectMessageWithIndex(
            applications,
            getSelector('objectAtIndex:'),
            applicationIndex,
          );
          if (!running) continue;
          const application = createApplication(
            intMessage(running, getSelector('processIdentifier')),
          );
          if (!application) continue;
          const windows = attribute(application, 'AXWindows');
          if (!windows) {
            release(application);
            continue;
          }
          try {
            const count = Math.min(arrayCount(windows), 32);
            for (let index = 0; index < count; index += 1) {
              const window = arrayValue(windows, index);
              if (!isPanelWindow(window)) continue;
              let hasConfirm = false;
              let hasCancel = false;
              visit(window, (element) => {
                const button = buttonLabel(element);
                if (!button) return;
                hasConfirm ||= confirmLabels.has(button.normalized);
                hasCancel ||= cancelLabels.has(button.normalized);
              });
              if (hasConfirm && hasCancel) candidates.push(retain(window));
            }
          } finally {
            release(windows);
            release(application);
          }
        }
        if (candidates.length !== 1) return false;
        let confirmed = false;
        visit(candidates[0], (element) => {
          if (confirmed) return;
          const button = buttonLabel(element);
          if (!button || !confirmLabels.has(button.normalized)) return;
          const action = stringRef('AXPress');
          try {
            confirmed = performAction(element, action) === 0;
          } finally {
            release(action);
          }
        });
        return confirmed;
      } catch {
        return false;
      } finally {
        for (const candidate of candidates) release(candidate);
        if (bundle) release(bundle);
      }
    };
  } catch {
    return undefined;
  }
}

function loadNativeBinding(): NativeBinding | undefined {
  try {
    const requireWorkBuddy = createRequire(join(WORKBUDDY_UNPACKED, 'index.cjs'));
    const koffi = requireWorkBuddy('koffi') as Koffi;
    const library = koffi.load(SDK_PATH);
    const initialize = library.func('int Initialize(const char *)') as (version: string) => number;
    const uninitialize = library.func('void Uninitialize()') as () => void;
    const withColorScheme = (() => {
      try {
        return library.func(
          'int RequestPanelWithColorScheme(const char **, int, int, int, const char *)',
        ) as (tokens: string[], count: number, x: number, y: number, scheme: string) => number;
      } catch {
        return undefined;
      }
    })();
    const request = library.func('int RequestPanel(const char **, int, int, int)') as (
      tokens: string[],
      count: number,
      x: number,
      y: number,
    ) => number;
    const close = library.func('int ClosePanel(const char **, int)') as (
      tokens: string[],
      count: number,
    ) => number;
    return {
      initialize,
      uninitialize,
      requestPanel: (tokens, x, y) =>
        withColorScheme
          ? withColorScheme(tokens, tokens.length, x, y, '')
          : request(tokens, tokens.length, x, y),
      closePanel: (tokens) => close(tokens, tokens.length),
      isWeComAlive: library.func('bool IsWXWorkAlive()') as () => boolean,
      getWeComVersion: library.func('const char *GetWXWorkVersion()') as () => string | undefined,
      confirmApproval: createAccessibilityConfirmation(koffi),
    };
  } catch {
    return undefined;
  }
}

function createNativeRequest(appVersion: string): {
  request: (token: string, position?: Position) => boolean;
  confirm: () => Promise<boolean>;
  dispose: () => void;
} {
  let binding: NativeBinding | null | undefined;
  let initialized = false;
  const activeTokens = new Set<string>();
  return {
    request(token, position) {
      if (activeTokens.has(token)) return true;
      binding ??= loadNativeBinding();
      if (!binding) return false;
      if (!initialized) {
        if (binding.initialize(appVersion) !== 0) return false;
        initialized = true;
      }
      const version = binding.getWeComVersion();
      if (!version || compareVersion(version, '5.0.12') < 0 || !binding.isWeComAlive())
        return false;
      const code = binding.requestPanel(
        [token],
        Math.round(position?.x ?? 0),
        Math.round(position?.y ?? 0),
      );
      if (code === 0) activeTokens.add(token);
      return code === 0;
    },
    async confirm() {
      binding ??= loadNativeBinding();
      const confirmApproval = binding?.confirmApproval;
      if (!confirmApproval) return false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (confirmApproval()) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    },
    dispose() {
      if (!binding || !initialized) return;
      const tokens = [...activeTokens];
      if (tokens.length > 0) binding.closePanel(tokens);
      activeTokens.clear();
      binding.uninitialize();
      initialized = false;
    },
  };
}

function request(payload: Record<string, unknown>, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!existsSync(path)) {
      resolve(false);
      return;
    }
    const socket = createConnection(path);
    let response = '';
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), 3_000);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on('data', (chunk) => {
      response += chunk;
      if (response.length > 1024) {
        finish(false);
        return;
      }
      if (!response.includes('\n')) return;
      try {
        finish((JSON.parse(response.trim()) as { ok?: unknown }).ok === true);
      } catch {
        finish(false);
      }
    });
    socket.on('error', () => finish(false));
    socket.on('close', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export function createDirectNativeApproval(appVersion: string): {
  request: (url: string) => boolean;
  dispose: () => void;
} {
  const native = createNativeRequest(appVersion);
  return {
    request(url) {
      const token = tokenFromApprovalUrl(url);
      return token ? native.request(token) : false;
    },
    dispose: native.dispose,
  };
}

export async function requestNativeApproval(url: string, path = socketPath()): Promise<boolean> {
  if (!tokenFromApprovalUrl(url)) return false;
  return request({ url }, path);
}

export async function startNativeApprovalServer(
  options: NativeApprovalServerOptions,
): Promise<() => Promise<void>> {
  const path = options.socketPath ?? socketPath();
  if (await request({ ping: true }, path)) return async () => {};
  if (existsSync(path)) unlinkSync(path);

  const native = options.requestPanel ? undefined : createNativeRequest(options.appVersion);
  const activeTokens = new Set<string>();
  const confirm = () => {
    if (!options.autoConfirm) return;
    const operation = options.confirmPanel
      ? Promise.resolve().then(options.confirmPanel)
      : native?.confirm();
    if (operation) void operation.catch(() => false);
  };
  const server: Server = createServer((socket) => {
    let body = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_REQUEST_BYTES) {
        socket.destroy();
        return;
      }
      if (!body.includes('\n')) return;
      try {
        const payload = JSON.parse(body.trim()) as { ping?: unknown; url?: unknown };
        if (payload.ping === true) {
          socket.end('{"ok":true}\n');
          return;
        }
        const token =
          typeof payload.url === 'string' ? tokenFromApprovalUrl(payload.url) : undefined;
        if (!token) {
          socket.end('{"ok":false}\n');
          return;
        }
        if (activeTokens.has(token)) {
          confirm();
          socket.end('{"ok":true}\n');
          return;
        }
        const opened = options.requestPanel
          ? options.requestPanel(token, options.position())
          : (native?.request(token, options.position()) ?? false);
        if (opened) {
          activeTokens.add(token);
          confirm();
        }
        socket.end(`${JSON.stringify({ ok: opened })}\n`);
      } catch {
        socket.end('{"ok":false}\n');
      }
    });
    socket.on('error', () => socket.destroy());
  });
  server.unref();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.removeAllListeners('error');
      server.on('error', () => {});
      resolve();
    });
  });
  chmodSync(path, 0o600);

  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    native?.dispose();
    activeTokens.clear();
    if (existsSync(path)) unlinkSync(path);
  };
}
