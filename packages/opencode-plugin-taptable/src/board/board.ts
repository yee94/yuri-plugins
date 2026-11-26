import type { BoardReply, BoardRequest } from '../rpc';
import {
  type Database,
  openBoardDatabase,
  readBoard,
  saveRequirement,
  saveTask,
  todayISO,
  updatedBoard,
} from './database';
import type { BoardData, Requirement, TaskItem, TaskStatus } from './types';

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待开始',
  doing: '进行中',
  verifying: '验收中',
  done: '已完成',
};

export function exportBoardMarkdown(board: BoardData): string {
  const reqs = [...board.requirements].sort((a, b) => a.order - b.order);
  const openCount = board.tasks.filter((t) => t.status !== 'done').length;

  const lines: string[] = [
    `# ${board.title}（${board.updatedAt}）`,
    '',
    `> ${reqs.length} 个主线需求 · ${openCount} 项未完成`,
    '',
  ];

  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

  for (const req of reqs) {
    const list = board.tasks.filter((t) => t.reqId === req.id).sort((a, b) => a.order - b.order);
    const done = list.filter((t) => t.status === 'done').length;

    lines.push(`## ${req.title}（${req.stage} · ${done}/${list.length}）`);
    if (req.note) {
      lines.push('', req.note);
    }
    if (req.docs && req.docs.length > 0) {
      lines.push('', `参考文档：${req.docs.map((d) => `[${d.label}](${d.url})`).join(' · ')}`);
    }
    lines.push('');
    lines.push('| 任务 | 状态 | 备注 |');
    lines.push('| --- | --- | --- |');
    for (const task of list) {
      lines.push(
        `| ${esc(task.title)} | ${STATUS_LABELS[task.status]} | ${esc(task.note || '—')} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

function json(data: unknown, status = 200): BoardReply {
  return { status, text: JSON.stringify(data) };
}

const text = (value: unknown) => typeof value === 'string';
const order = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const status = (value: unknown) => typeof value === 'string' && Object.hasOwn(STATUS_LABELS, value);

const requirementFields = {
  title: text,
  stage: text,
  note: text,
  order,
  docs: (value: unknown) =>
    Array.isArray(value) &&
    value.every(
      (link) =>
        link &&
        typeof link.label === 'string' &&
        typeof link.url === 'string' &&
        /^https?:\/\//i.test(link.url),
    ),
};
const taskFields = { title: text, note: text, reqId: text, status, order };

function readFields<T>(
  body: unknown,
  fields: Record<string, (value: unknown) => boolean>,
): Partial<T> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const [key, value] of Object.entries(body)) {
    if (!Object.hasOwn(fields, key) || !fields[key](value)) return null;
  }
  return body as Partial<T>;
}

export function createBoardHandler(dataPath: string) {
  return function handleRequest({ method, path, payload }: BoardRequest): BoardReply {
    const db = openBoardDatabase(dataPath);
    try {
      return db.transaction(method !== 'GET', () => dispatch(db, path, method, payload));
    } finally {
      db.close();
    }
  };
}

function dispatch(db: Database, pathname: string, method: string, payload: unknown): BoardReply {
  if (pathname === '/api/board' && method === 'GET') {
    return json(readBoard(db));
  }
  // Requirements CRUD
  if (pathname === '/api/requirements' && method === 'POST') {
    const body = readFields<Requirement>(payload, requirementFields);
    if (!body) return json({ error: '需求字段不合法' }, 400);
    if (!body.title?.trim()) {
      return json({ error: '需求名称不能为空' }, 400);
    }
    const maxOrder =
      db.query<{ value: number }, []>('SELECT MAX(sort_order) AS value FROM requirements').get()
        ?.value ?? 0;
    const requirement: Requirement = {
      id: `req-${crypto.randomUUID().slice(0, 8)}`,
      title: body.title.trim(),
      stage: body.stage?.trim() || '进行中',
      note: body.note?.trim() || '',
      docs: Array.isArray(body.docs) ? body.docs : [],
      order: maxOrder + 1,
    };
    saveRequirement(db, requirement);
    return json({ requirement, board: updatedBoard(db) }, 201);
  }

  const reqMatch = pathname.match(/^\/api\/requirements\/([a-zA-Z0-9_-]+)$/);
  if (reqMatch && method === 'PATCH') {
    const id = reqMatch[1];
    const patch = readFields<Requirement>(payload, requirementFields);
    if (!patch) return json({ error: '需求字段不合法' }, 400);
    const current = readBoard(db).requirements.find((r) => r.id === id);
    if (!current) return json({ error: '需求不存在' }, 404);
    const nextReq: Requirement = {
      ...current,
      ...patch,
      id: current.id,
      title: patch.title !== undefined ? patch.title.trim() || current.title : current.title,
    };
    saveRequirement(db, nextReq);
    return json({ requirement: nextReq, board: updatedBoard(db) });
  }

  if (reqMatch && method === 'DELETE') {
    const id = reqMatch[1];
    if (!db.query('DELETE FROM requirements WHERE id = ?').run(id).changes) {
      return json({ error: '需求不存在' }, 404);
    }
    return json({ deleted: id, board: updatedBoard(db) });
  }

  // Tasks CRUD
  if (pathname === '/api/tasks' && method === 'POST') {
    const body = readFields<TaskItem>(payload, taskFields);
    if (!body) return json({ error: '任务字段不合法' }, 400);
    if (!body.title?.trim()) {
      return json({ error: '任务名称不能为空' }, 400);
    }
    if (!body.reqId || !db.query('SELECT 1 FROM requirements WHERE id = ?').get(body.reqId)) {
      return json({ error: '所属需求不存在' }, 400);
    }
    const maxOrder =
      db
        .query<{ value: number }, [string]>(
          'SELECT MAX(sort_order) AS value FROM tasks WHERE req_id = ?',
        )
        .get(body.reqId)?.value ?? 0;
    const task: TaskItem = {
      id: `t-${crypto.randomUUID().slice(0, 8)}`,
      reqId: body.reqId,
      title: body.title.trim(),
      status: body.status ?? 'todo',
      note: body.note?.trim() || '',
      updatedAt: todayISO(),
      order: maxOrder + 1,
    };
    saveTask(db, task);
    return json({ task, board: updatedBoard(db) }, 201);
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)$/);
  if (taskMatch && method === 'PATCH') {
    const id = taskMatch[1];
    const patch = readFields<TaskItem>(payload, taskFields);
    if (!patch || (patch.title !== undefined && !patch.title.trim()))
      return json({ error: '任务字段不合法' }, 400);
    if (
      patch.reqId !== undefined &&
      !db.query('SELECT 1 FROM requirements WHERE id = ?').get(patch.reqId)
    ) {
      return json({ error: '所属需求不存在' }, 400);
    }
    const current = readBoard(db).tasks.find((t) => t.id === id);
    if (!current) return json({ error: '任务不存在' }, 404);
    const nextTask: TaskItem = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: todayISO(),
    };
    saveTask(db, nextTask);
    return json({ task: nextTask, board: updatedBoard(db) });
  }

  if (taskMatch && method === 'DELETE') {
    const id = taskMatch[1];
    if (!db.query('DELETE FROM tasks WHERE id = ?').run(id).changes) {
      return json({ error: '任务不存在' }, 404);
    }
    return json({ deleted: id, board: updatedBoard(db) });
  }

  if (pathname === '/api/export/markdown' && method === 'GET') {
    const board = readBoard(db);
    return { status: 200, text: exportBoardMarkdown(board) };
  }

  return json({ error: 'Not found' }, 404);
}
