import { Command, Plugin, SettingsPage } from '@opencode/plugin/gui';
import { createComponent, createSignal } from 'solid-js';
import { startNativeApprovalServer } from './native-approval.js';
import { WecomRpc } from './rpc.js';

interface WecomStatusSnapshot {
  readonly auth: {
    readonly phase: string;
    readonly desktop_required: boolean;
    readonly wecom_configured: boolean;
    readonly account_expires_at_ms: number | null;
    readonly wecom_expires_at_ms: number | null;
  };
  readonly wecom_auth_url: string;
  readonly recent_receipts: readonly {
    readonly request_id: string;
    readonly action: string;
    readonly status: string;
    readonly summary_preview?: string;
  }[];
}

export default Plugin.define({
  i18n: {
    en: {
      title: 'WeCom / Dayuan',
      description:
        'Desktop-free Enterprise WeChat QR login and read-only Dayuan A2A chat summaries.',
      'cmd.login': 'WeCom: Sign in with QR code',
      'cmd.login.desc': 'Open WorkBuddy WeCom QR login in your browser (no desktop client needed).',
      'cmd.settings': 'WeCom: Open settings',
      'section.connection': 'Connection',
      'section.actions': 'Actions',
      'section.receipts': 'Recent Dayuan Queries',
      'row.status': 'Auth Status',
      'row.login': 'QR Code Login',
      'row.login.desc':
        'Scan with mobile Enterprise WeChat; credentials auto-refresh in the background.',
      'row.wecom_auth': 'WeCom App Authorization',
      'row.wecom_auth.desc':
        'Open the official authorization page. After granting access, verify the WeCom and Dayuan credentials.',
      'row.logout': 'Sign Out',
      'row.logout.desc': 'Remove stored WorkBuddy and WeCom tokens from OpenCode storage.',
      'btn.refresh': 'Refresh',
      'btn.login': 'Open QR Login',
      'btn.finish': 'Verify Scan',
      'btn.open_wecom_auth': 'Open WeCom Auth',
      'btn.verify_wecom_auth': 'Verify Authorization',
      'toast.auth_verified': 'WeCom authorization and Dayuan ticket verified',
      'btn.logout': 'Sign Out',
      'toast.login_opened': 'Opened WeCom QR login in browser',
      'toast.login_opened_desc': 'Scan with mobile Enterprise WeChat, then click Verify Scan.',
      'toast.ready': 'WeCom connected',
      'toast.logged_out': 'WeCom credentials cleared',
      'toast.no_server': 'No connected OpenCode server',
      'state.connected': 'Connected (WeCom ready)',
      'state.pending': 'Waiting for QR scan...',
      'state.logged_out': 'Not signed in',
      'receipts.empty': 'No recent Dayuan queries yet.',
    },
    zh: {
      title: '企业微信 / 大圆',
      description: '零桌面客户端依赖：手机企微扫码登录 + 大圆 A2A 只读群聊摘要。',
      'cmd.login': '企业微信：扫码登录',
      'cmd.login.desc': '在浏览器打开 WorkBuddy 企微扫码页（无需安装任何桌面客户端）。',
      'cmd.settings': '企业微信：打开设置',
      'section.connection': '连接状态',
      'section.actions': '登录与凭据操作',
      'section.receipts': '近期大圆查询回执',
      'row.status': '当前状态',
      'row.login': '手机企微扫码登录',
      'row.login.desc': '用手机企业微信扫一次码，后续自动后台续期换票，无需安装桌面端。',
      'row.wecom_auth': '企微应用二次授权',
      'row.wecom_auth.desc':
        '需要追加授权或授权失效时，打开官方页面确认，再验证企业微信和大圆凭据。',
      'row.logout': '退出登录',
      'row.logout.desc': '清除 OpenCode 本地持久化存储的 WorkBuddy / 企微凭据。',
      'btn.refresh': '刷新状态',
      'btn.login': '打开扫码页',
      'btn.finish': '确认已扫码',
      'btn.open_wecom_auth': '打开企微授权页',
      'btn.verify_wecom_auth': '确认已授权',
      'toast.auth_verified': '企业微信授权和大圆票据已验证',
      'btn.logout': '清除凭据',
      'toast.login_opened': '已在浏览器打开企微扫码页',
      'toast.login_opened_desc': '请用手机企业微信扫码确认，完成后点击「确认已扫码」。',
      'toast.ready': '企业微信已连接就绪',
      'toast.logged_out': '已清除企业微信登录凭据',
      'toast.no_server': '当前没有已连接的 OpenCode 服务',
      'state.connected': '已连接（企微凭据就绪）',
      'state.pending': '等待手机企微扫码...',
      'state.logged_out': '未登录',
      'receipts.empty': '暂无近期大圆查询记录。',
    },
  },
  setup(ctx) {
    const [snapshot, setSnapshot] = createSignal<WecomStatusSnapshot | undefined>(undefined);
    const [busy, setBusy] = createSignal(false);
    const [lastAuthUrl, setLastAuthUrl] = createSignal<string | undefined>(undefined);

    const getRpc = () => ctx.client.rpc(WecomRpc);

    const refresh = async () => {
      const rpc = getRpc();
      if (!rpc) return;
      setBusy(true);
      try {
        const res = (await rpc.status(
          {},
          { signal: ctx.signal },
        )) as unknown as WecomStatusSnapshot;
        setSnapshot(res);
      } catch {
        // Ignore transient disconnect while server reconnects
      } finally {
        setBusy(false);
      }
    };

    const startQrLogin = async () => {
      const rpc = getRpc();
      if (!rpc) {
        ctx.toast.show({ title: ctx.t('toast.no_server'), variant: 'error' });
        return;
      }
      setBusy(true);
      try {
        const started = (await rpc.startLogin({}, { signal: ctx.signal })) as {
          phase: string;
          authorization_url: string;
        };
        setLastAuthUrl(started.authorization_url);
        ctx.system.openExternal(started.authorization_url);
        await ctx.system.copy(started.authorization_url).catch(() => {});
        ctx.toast.show({
          title: ctx.t('toast.login_opened'),
          description: ctx.t('toast.login_opened_desc'),
        });
      } catch (err) {
        ctx.toast.show({
          title: err instanceof Error ? err.message : String(err),
          variant: 'error',
        });
      } finally {
        setBusy(false);
      }
    };

    const finishQrLogin = async () => {
      const rpc = getRpc();
      if (!rpc) return;
      setBusy(true);
      try {
        const res = (await rpc.finishLogin({ wait_seconds: 15 }, { signal: ctx.signal })) as {
          auth?: { phase?: string; wecom_configured?: boolean };
        };
        await refresh();
        if (res.auth?.phase === 'ready' && res.auth?.wecom_configured) {
          ctx.toast.show({ title: ctx.t('toast.ready'), variant: 'success' });
        }
      } catch (err) {
        ctx.toast.show({
          title: err instanceof Error ? err.message : String(err),
          variant: 'error',
        });
      } finally {
        setBusy(false);
      }
    };

    const verifyWecom = async () => {
      const rpc = getRpc();
      if (!rpc) return;
      setBusy(true);
      try {
        await rpc.verifyWecom({}, { signal: ctx.signal });
        await refresh();
        ctx.toast.show({ title: ctx.t('toast.auth_verified'), variant: 'success' });
      } catch (err) {
        ctx.toast.show({
          title: err instanceof Error ? err.message : String(err),
          variant: 'error',
        });
      } finally {
        setBusy(false);
      }
    };

    const logout = async () => {
      const rpc = getRpc();
      if (!rpc) return;
      setBusy(true);
      try {
        await rpc.logout({}, { signal: ctx.signal });
        setLastAuthUrl(undefined);
        await refresh();
        ctx.toast.show({ title: ctx.t('toast.logged_out') });
      } finally {
        setBusy(false);
      }
    };

    // Initial status load + live auth change subscription
    void refresh();
    const initialRpc = getRpc();
    const unsubAuth = initialRpc
      ? initialRpc.events.on(
          'authChanged',
          () => {
            void refresh();
          },
          { signal: ctx.signal },
        )
      : undefined;

    const cleanups = [
      ctx.add(Command, {
        id: 'login',
        get title() {
          return ctx.t('cmd.login');
        },
        get description() {
          return ctx.t('cmd.login.desc');
        },
        run: () => startQrLogin(),
      }),
      ctx.add(Command, {
        id: 'settings',
        get title() {
          return ctx.t('cmd.settings');
        },
        run: () => {
          ctx.layout.settings(ctx.id);
        },
      }),
      ctx.add(SettingsPage, {
        id: ctx.id,
        get title() {
          return ctx.t('title');
        },
        icon: 'bubble-5',
        entries: [
          { id: 'wecom.status', title: 'WeCom Auth Status', keywords: 'wecom dayuan workbuddy qr' },
          { id: 'wecom.login', title: 'WeCom QR Login', keywords: 'wecom login scan qr' },
        ],
        render() {
          void refresh();
          const statusLabel = () => {
            const snap = snapshot();
            if (!snap) return ctx.t('state.logged_out');
            if (snap.auth.phase === 'ready' && snap.auth.wecom_configured)
              return ctx.t('state.connected');
            if (snap.auth.phase === 'pending_token' || snap.auth.phase === 'pending_account') {
              return ctx.t('state.pending');
            }
            return `${ctx.t('state.logged_out')} (${snap.auth.phase})`;
          };

          const receiptsDescription = () => {
            const list = snapshot()?.recent_receipts ?? [];
            if (list.length === 0) return ctx.t('receipts.empty');
            return list
              .slice(0, 5)
              .map(
                (r) =>
                  `[${r.status}] ${r.action}${r.summary_preview ? `: ${r.summary_preview}` : ''}`,
              )
              .join(' | ');
          };

          return createComponent(ctx.ui.SettingsLayout, {
            get title() {
              return ctx.t('title');
            },
            get description() {
              return ctx.t('description');
            },
            get actions() {
              return createComponent(ctx.ui.Button, {
                get busy() {
                  return busy();
                },
                onClick: () => void refresh(),
                get children() {
                  return ctx.t('btn.refresh');
                },
              });
            },
            get children() {
              return [
                createComponent(ctx.ui.SettingsSection, {
                  get title() {
                    return ctx.t('section.connection');
                  },
                  get children() {
                    return [
                      createComponent(ctx.ui.SettingsRow, {
                        id: 'wecom.status',
                        get title() {
                          return ctx.t('row.status');
                        },
                        get description() {
                          return statusLabel();
                        },
                      }),
                    ];
                  },
                }),
                createComponent(ctx.ui.SettingsSection, {
                  get title() {
                    return ctx.t('section.actions');
                  },
                  get children() {
                    return [
                      createComponent(ctx.ui.SettingsRow, {
                        id: 'wecom.login',
                        get title() {
                          return ctx.t('row.login');
                        },
                        get description() {
                          return lastAuthUrl() ?? ctx.t('row.login.desc');
                        },
                        get children() {
                          return [
                            createComponent(ctx.ui.Button, {
                              variant: 'contrast',
                              get busy() {
                                return busy();
                              },
                              onClick: () => void startQrLogin(),
                              get children() {
                                return ctx.t('btn.login');
                              },
                            }),
                            createComponent(ctx.ui.Button, {
                              get busy() {
                                return busy();
                              },
                              onClick: () => void finishQrLogin(),
                              get children() {
                                return ctx.t('btn.finish');
                              },
                            }),
                          ];
                        },
                      }),
                      createComponent(ctx.ui.SettingsRow, {
                        id: 'wecom.auth_page',
                        get title() {
                          return ctx.t('row.wecom_auth');
                        },
                        get description() {
                          return ctx.t('row.wecom_auth.desc');
                        },
                        get children() {
                          return [
                            createComponent(ctx.ui.Button, {
                              onClick: () => {
                                const url =
                                  snapshot()?.wecom_auth_url ??
                                  'https://www.workbuddy.cn/login/wecom-auth';
                                ctx.system.openExternal(url);
                              },
                              get children() {
                                return ctx.t('btn.open_wecom_auth');
                              },
                            }),
                            createComponent(ctx.ui.Button, {
                              get busy() {
                                return busy();
                              },
                              onClick: () => void verifyWecom(),
                              get children() {
                                return ctx.t('btn.verify_wecom_auth');
                              },
                            }),
                          ];
                        },
                      }),
                      createComponent(ctx.ui.SettingsRow, {
                        id: 'wecom.logout',
                        get title() {
                          return ctx.t('row.logout');
                        },
                        get description() {
                          return ctx.t('row.logout.desc');
                        },
                        get children() {
                          return createComponent(ctx.ui.Button, {
                            get busy() {
                              return busy();
                            },
                            onClick: () => void logout(),
                            get children() {
                              return ctx.t('btn.logout');
                            },
                          });
                        },
                      }),
                    ];
                  },
                }),
                createComponent(ctx.ui.SettingsSection, {
                  get title() {
                    return ctx.t('section.receipts');
                  },
                  get children() {
                    return createComponent(ctx.ui.SettingsRow, {
                      get title() {
                        return ctx.t('section.receipts');
                      },
                      get description() {
                        return receiptsDescription();
                      },
                    });
                  },
                }),
              ];
            },
          });
        },
      }),
    ];

    return () => {
      unsubAuth?.();
      for (const cleanup of cleanups) cleanup();
    };
  },
  main(ctx) {
    if (ctx.options.write !== true || process.platform !== 'darwin') return;
    return startNativeApprovalServer({
      appVersion: ctx.app.version,
      autoConfirm: true,
      position: () => {
        const window = ctx.windows.focused() ?? ctx.windows.list()[0];
        const bounds = window?.getBounds();
        return bounds
          ? {
              x: bounds.x + Math.round(bounds.width / 2),
              y: bounds.y + Math.round(bounds.height / 2),
            }
          : undefined;
      },
    });
  },
});
