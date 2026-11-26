import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { requestNativeApproval, startNativeApprovalServer } from '../src/native-approval.js';

describe('native WeCom approval bridge', () => {
  it('passes only a validated approval token to the native panel and deduplicates requests', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'wecom-native-approval-'));
    const socketPath = join(directory, 'bridge.sock');
    const calls: { token: string; position?: { x: number; y: number } }[] = [];
    const confirmPanel = vi.fn(async () => true);
    const cleanup = await startNativeApprovalServer({
      appVersion: 'test',
      socketPath,
      confirmPanel,
      position: () => ({ x: 120, y: 240 }),
      requestPanel(token, position) {
        calls.push({ token, ...(position ? { position } : {}) });
        return true;
      },
    });
    const url = 'wxwork://jump?target=agent_confirm&token=approval-token';

    try {
      expect(await requestNativeApproval(url, socketPath)).toBe(true);
      expect(await requestNativeApproval(url, socketPath)).toBe(true);
      expect(await requestNativeApproval('https://example.com/?token=no', socketPath)).toBe(false);
      expect(calls).toEqual([{ token: 'approval-token', position: { x: 120, y: 240 } }]);
      expect(confirmPanel).not.toHaveBeenCalled();
    } finally {
      await cleanup();
      rmSync(directory, { recursive: true, force: true });
    }

    expect(await requestNativeApproval(url, socketPath)).toBe(false);
  });

  it('auto-confirms only after a validated approval opens the native panel', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'wecom-native-approval-'));
    const socketPath = join(directory, 'bridge.sock');
    const confirmPanel = vi.fn(async () => true);
    const cleanup = await startNativeApprovalServer({
      appVersion: 'test',
      socketPath,
      autoConfirm: true,
      confirmPanel,
      position: () => undefined,
      requestPanel: () => true,
    });
    const url = 'wxwork://jump?target=agent_confirm&token=approval-token';

    try {
      expect(await requestNativeApproval(url, socketPath)).toBe(true);
      await vi.waitFor(() => expect(confirmPanel).toHaveBeenCalledTimes(1));
      expect(await requestNativeApproval('https://example.com/?token=no', socketPath)).toBe(false);
      expect(confirmPanel).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
