import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BoardData, DocLink, Requirement, TaskItem } from './types';

// OpenCode runs on Bun; the workspace tests and Node hosts use Node's built-in SQLite.
const SQLite = process.versions.bun
  ? (await import('bun:sqlite')).Database
  : (await import('node:sqlite')).DatabaseSync;

type Value = string | number | null;
type Statement = ReturnType<InstanceType<typeof SQLite>['prepare']>;

export class Database {
  private readonly connection: InstanceType<typeof SQLite>;

  constructor(path: string) {
    this.connection = new SQLite(path);
  }

  query<Row = unknown, Args extends Value[] = Value[]>(sql: string) {
    const statement: Statement = this.connection.prepare(sql);
    return {
      get: (...args: Args) => statement.get(...args) as Row | undefined,
      all: (...args: Args) => statement.all(...args) as Row[],
      run: (...args: Args) => statement.run(...args),
    };
  }

  exec(sql: string) {
    this.connection.exec(sql);
  }

  close() {
    this.connection.close();
  }

  transaction<T>(write: boolean, callback: () => T): T {
    this.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try {
      const result = callback();
      this.exec('COMMIT');
      return result;
    } catch (error) {
      this.exec('ROLLBACK');
      throw error;
    }
  }
}

export function todayISO(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function saveRequirement(db: Database, requirement: Requirement) {
  const { id, title, stage, note, order, docs } = requirement;
  db.query(`INSERT INTO requirements VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, stage=excluded.stage,
      note=excluded.note, sort_order=excluded.sort_order`).run(id, title, stage, note, order);
  db.query('DELETE FROM requirement_docs WHERE req_id = ?').run(id);
  const insert = db.query('INSERT INTO requirement_docs VALUES (?, ?, ?, ?)');
  docs?.forEach(({ label, url }, index) => {
    insert.run(id, index, label, url);
  });
}

export function saveTask(db: Database, task: TaskItem) {
  const { id, reqId, title, status, note, updatedAt, order } = task;
  db.query(`INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET req_id=excluded.req_id, title=excluded.title,
      status=excluded.status, note=excluded.note, updated_at=excluded.updated_at,
      sort_order=excluded.sort_order`).run(id, reqId, title, status, note, updatedAt, order);
}

export function readBoard(db: Database): BoardData {
  const metadata = db
    .query<Pick<BoardData, 'title' | 'updatedAt'>, []>(
      'SELECT title, updated_at AS "updatedAt" FROM board',
    )
    .get();
  if (!metadata) throw new Error('TapTable 数据库缺少看板记录');
  const links = new Map<string, DocLink[]>();
  for (const { reqId, ...link } of db
    .query<DocLink & { reqId: string }, []>(
      'SELECT req_id AS "reqId", label, url FROM requirement_docs ORDER BY req_id, position',
    )
    .all()) {
    const docs = links.get(reqId) ?? [];
    docs.push(link);
    links.set(reqId, docs);
  }
  const requirements = db
    .query<Requirement, []>(
      'SELECT id, title, stage, note, sort_order AS "order" FROM requirements ORDER BY rowid',
    )
    .all()
    .map((requirement) => ({ ...requirement, docs: links.get(requirement.id) ?? [] }));
  const tasks = db
    .query<TaskItem, []>(
      'SELECT id, req_id AS "reqId", title, status, note, updated_at AS "updatedAt", sort_order AS "order" FROM tasks ORDER BY rowid',
    )
    .all();
  return { ...metadata, requirements, tasks };
}

export function updatedBoard(db: Database): BoardData {
  db.query('UPDATE board SET updated_at = ?').run(todayISO());
  return readBoard(db);
}

export function openBoardDatabase(dataPath: string): Database {
  mkdirSync(dirname(dataPath), { recursive: true });
  const db = new Database(dataPath);
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    if (db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version === 0) {
      db.transaction(true, () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS board (
            id INTEGER PRIMARY KEY CHECK (id = 1), title TEXT NOT NULL, updated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS requirements (
            id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL,
            stage TEXT NOT NULL, note TEXT NOT NULL, sort_order REAL NOT NULL
          );
          CREATE TABLE IF NOT EXISTS requirement_docs (
            req_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
            position INTEGER NOT NULL, label TEXT NOT NULL, url TEXT NOT NULL,
            PRIMARY KEY (req_id, position)
          );
          CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY NOT NULL, req_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
            title TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'verifying', 'done')),
            note TEXT NOT NULL, updated_at TEXT NOT NULL, sort_order REAL NOT NULL
          );
          CREATE INDEX IF NOT EXISTS tasks_req_id ON tasks(req_id);
        `);
        db.query('INSERT OR IGNORE INTO board VALUES (1, ?, ?)').run('需求跟进', todayISO());
        db.exec('PRAGMA user_version = 1');
      });
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
