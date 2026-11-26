import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createBoardHandler } from '../src/board/board';

test('persists requirements and tasks in SQLite, exports a brief, and cascades deletes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taptable-'));
  const path = join(dir, 'board.sqlite');
  try {
    const request = createBoardHandler(path);
    const created = request({
      method: 'POST',
      path: '/api/requirements',
      payload: { title: '云端小程序', docs: [{ label: '方案', url: 'https://example.com/' }] },
    });
    expect(created.status).toBe(201);
    const reqId = JSON.parse(created.text).requirement.id;
    const result = request({
      method: 'POST',
      path: '/api/tasks',
      payload: { title: '接入渠道', reqId },
    });
    expect(result.status).toBe(201);
    const id = JSON.parse(result.text).task.id;
    expect(
      request({ method: 'PATCH', path: `/api/tasks/${id}`, payload: { status: 'verifying' } })
        .status,
    ).toBe(200);
    expect(
      request({ method: 'PATCH', path: `/api/tasks/${id}`, payload: { reqId: 'missing' } }).status,
    ).toBe(400);
    expect(readFileSync(path).subarray(0, 16).toString()).toBe('SQLite format 3\0');

    const reopened = createBoardHandler(path);
    const brief = reopened({ method: 'GET', path: '/api/export/markdown' }).text;
    expect(brief).toContain('接入渠道 | 验收中');
    expect(brief).toContain('[方案](https://example.com/)');
    expect(reopened({ method: 'DELETE', path: `/api/requirements/${reqId}` }).status).toBe(200);
    expect(JSON.parse(reopened({ method: 'GET', path: '/api/board' }).text)).toMatchObject({
      requirements: [],
      tasks: [],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
