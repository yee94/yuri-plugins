import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command, type Context, SettingsPage } from '@opencode/plugin/gui';
import { describe, expect, it, vi } from 'vitest';
import guiPlugin from '../src/gui.js';
import { WecomRpc } from '../src/rpc.js';

function createMockGuiContext() {
  const contributions = new Map<string, unknown[]>();
  const openExternal = vi.fn();
  const copy = vi.fn(async () => {});
  const showToast = vi.fn(() => ({ dismiss: vi.fn() }));
  const openSettings = vi.fn();
  const rpcHandlers = {
    status: vi.fn(async () => ({
      auth: {
        phase: 'logged_out',
        desktop_required: false,
        cloud_dependency: 'https://www.workbuddy.cn',
        account_expires_at_ms: null,
        refresh_expires_at_ms: null,
        refresh_credential_present: false,
        wecom_expires_at_ms: null,
        wecom_configured: false,
        authorization_verified: false,
      },
      wecom_auth_url: 'https://www.workbuddy.cn/login/wecom-auth',
      recent_receipts: [],
    })),
    startLogin: vi.fn(async () => ({
      phase: 'pending_token',
      authorization_url:
        'https://www.workbuddy.cn/login?state=st_gui&version=5.8.2&force_login_type=wecom',
    })),
    finishLogin: vi.fn(async () => ({
      auth: { phase: 'ready', wecom_configured: true },
    })),
    logout: vi.fn(async () => ({
      auth: { phase: 'logged_out', wecom_configured: false },
    })),
    recentReceipts: vi.fn(async () => ({ receipts: [] })),
    events: {
      on: vi.fn(() => () => {}),
    },
  };

  const serverRef = {
    id: 'sidecar',
    name: 'Local',
    url: 'http://127.0.0.1:4096',
    local: true,
    builtin: true,
    compatible: true,
    connected: true,
    client: {
      rpc: vi.fn((def: unknown) => {
        expect(def).toBe(WecomRpc);
        return rpcHandlers;
      }),
    },
  };

  const uiCalls: string[] = [];
  const makeUiComp = (name: string) => (props: Record<string, unknown>) => {
    uiCalls.push(name);
    return { __ui: name, props };
  };

  const ctx = {
    id: 'opencode-plugin-wecom',
    signal: new AbortController().signal,
    client: serverRef.client,
    t: (key: string) => key,
    add: (registry: { id: string }, item: unknown) => {
      const list = contributions.get(registry.id) ?? [];
      list.push(item);
      contributions.set(registry.id, list);
      return () => {};
    },
    servers: {
      list: () => ['sidecar'],
      get: (id: string) => (id === 'sidecar' ? serverRef : undefined),
    },
    sessions: {
      current: () => undefined,
    },
    system: {
      openExternal,
      copy,
      save: async () => true,
    },
    toast: {
      show: showToast,
    },
    layout: {
      settings: openSettings,
    },
    ui: {
      SettingsLayout: makeUiComp('SettingsLayout'),
      SettingsSection: makeUiComp('SettingsSection'),
      SettingsRow: makeUiComp('SettingsRow'),
      Button: makeUiComp('Button'),
    },
  };

  return {
    ctx: ctx as unknown as Context,
    contributions,
    openExternal,
    copy,
    showToast,
    openSettings,
    rpcHandlers,
    uiCalls,
  };
}

describe('opencode-plugin-wecom GUI thin shell', () => {
  it('defines i18n copy and synchronous setup that registers commands and settings page', async () => {
    expect(guiPlugin.i18n?.en).toBeDefined();
    expect(guiPlugin.i18n?.zh).toBeDefined();
    expect(typeof guiPlugin.setup).toBe('function');

    const mock = createMockGuiContext();
    const cleanup = guiPlugin.setup?.(mock.ctx as never);

    // GUI setup must be synchronous (never a Promise/thenable)
    expect(cleanup && typeof (cleanup as { then?: unknown }).then).not.toBe('function');

    const commands = (mock.contributions.get(Command.id) ?? []) as {
      id: string;
      run: () => Promise<void> | void;
    }[];
    const settingsPages = (mock.contributions.get(SettingsPage.id) ?? []) as {
      render: (input: Record<string, unknown>) => unknown;
    }[];

    expect(commands.length).toBeGreaterThanOrEqual(2);
    expect(settingsPages).toHaveLength(1);

    // Trigger QR login command -> invokes server RPC startLogin and opens browser
    const loginCmd = commands.find((c) => c.id === 'login');
    expect(loginCmd).toBeDefined();
    await loginCmd?.run();

    expect(mock.rpcHandlers.startLogin).toHaveBeenCalledTimes(1);
    expect(mock.openExternal).toHaveBeenCalledWith(
      'https://www.workbuddy.cn/login?state=st_gui&version=5.8.2&force_login_type=wecom',
    );
    expect(mock.showToast).toHaveBeenCalled();

    // Render settings page cleanly via host UI primitives
    const rendered = settingsPages[0]?.render({});
    expect(rendered).toBeDefined();
    expect(mock.uiCalls).toContain('SettingsLayout');

    if (typeof cleanup === 'function') cleanup();
  });

  it('compiled dist/gui-experimental.cjs only requires allowed host-provided modules', () => {
    const bundlePath = resolve(import.meta.dirname, '../dist/gui-experimental.cjs');
    if (!existsSync(bundlePath)) return;
    const source = readFileSync(bundlePath, 'utf8');
    const requires = [...source.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
    const allowed = new Set([
      '@opencode/plugin/gui',
      '@opencode/plugin/rpc',
      'solid-js',
      'node:fs',
      'node:module',
      'node:net',
      'node:os',
      'node:path',
    ]);
    expect(requires.length).toBeGreaterThan(0);
    for (const specifier of requires) {
      expect(allowed.has(specifier ?? '')).toBe(true);
    }
    expect(source).toContain('module.exports =');
  });
});
