import { describe, expect, it } from 'vitest';
import { type ProcessRunResult, WecomCliBridge } from '../src/wecom/cli.js';

describe('WecomCliBridge — optional structured office domain bridge', () => {
  it('probes binary availability gracefully when not installed', async () => {
    const bridge = new WecomCliBridge({
      runner: async () => {
        throw Object.assign(new Error('spawn wecom ENOENT'), { code: 'ENOENT' });
      },
    });

    const probe = await bridge.probe();
    expect(probe).toEqual({
      available: false,
      binary: 'wecom',
      install_hint: 'npm install -g @wecom/cli',
    });

    await expect(bridge.run({ domain: 'doc', args: ['list'] })).rejects.toThrow(
      'WECOM_CLI_NOT_INSTALLED',
    );
  });

  it('executes allowed read-only domain commands and parses JSON stdout', async () => {
    const invocations: { bin: string; args: readonly string[] }[] = [];
    const bridge = new WecomCliBridge({
      runner: async (bin, args): Promise<ProcessRunResult> => {
        invocations.push({ bin, args });
        if (args[0] === '--version') {
          return { exitCode: 0, stdout: '0.4.2\n', stderr: '' };
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify({ items: [{ id: 'doc_1', title: 'Q4 架构规划' }] }),
          stderr: '',
        };
      },
    });

    const probe = await bridge.probe();
    expect(probe).toEqual({ available: true, binary: 'wecom', version: '0.4.2' });

    const res = await bridge.run({ domain: 'doc', args: ['list', '--limit', '5'] });
    expect(invocations[1]).toEqual({ bin: 'wecom', args: ['doc', 'list', '--limit', '5'] });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ items: [{ id: 'doc_1', title: 'Q4 架构规划' }] });
  });

  it('blocks disallowed domains and write subcommands unless allowWrite is enabled', async () => {
    const bridge = new WecomCliBridge({
      allowWrite: false,
      runner: async () => ({ exitCode: 0, stdout: '{}', stderr: '' }),
    });

    await expect(
      // @ts-expect-error testing runtime domain guard
      bridge.run({ domain: 'shell', args: ['whoami'] }),
    ).rejects.toThrow('WECOM_CLI_DOMAIN_BLOCKED');

    await expect(
      bridge.run({ domain: 'calendar', args: ['create', '--title', 'sync'] }),
    ).rejects.toThrow('WECOM_CLI_WRITE_BLOCKED');
    await expect(bridge.run({ domain: 'mail', args: ['send', '--to', 'a@b.com'] })).rejects.toThrow(
      'WECOM_CLI_WRITE_BLOCKED',
    );

    const writableBridge = new WecomCliBridge({
      allowWrite: true,
      runner: async () => ({ exitCode: 0, stdout: '{"created":true}', stderr: '' }),
    });
    const res = await writableBridge.run({
      domain: 'calendar',
      args: ['create', '--title', 'sync'],
    });
    expect(res.data).toEqual({ created: true });
  });

  it('returns non-zero exit status cleanly without throwing raw child_process objects', async () => {
    const bridge = new WecomCliBridge({
      runner: async () => ({ exitCode: 2, stdout: '', stderr: 'not authenticated' }),
    });

    const res = await bridge.run({ domain: 'meeting', args: ['list'] });
    expect(res.ok).toBe(false);
    expect(res.exit_code).toBe(2);
    expect(res.stderr).toBe('not authenticated');
  });
});
