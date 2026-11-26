import type { BoardData, Requirement, TaskItem } from '../board/types';
import type { BoardReply, BoardRequest } from '../rpc';

export type BoardTransport = (input: BoardRequest) => Promise<BoardReply>;

export function createBoardApi(transport: BoardTransport) {
  async function read(path: string, method = 'GET', payload?: unknown): Promise<string> {
    const result = await transport({ path, method, ...(payload === undefined ? {} : { payload }) });
    if (result.status >= 400) throw new Error(result.text || `操作失败 (${result.status})`);
    return result.text;
  }

  async function request<T>(path: string, method?: string, payload?: unknown): Promise<T> {
    return JSON.parse(await read(path, method, payload)) as T;
  }

  function fetchBoard(): Promise<BoardData> {
    return request<BoardData>('/api/board');
  }

  function createRequirement(
    payload: Partial<Requirement> & { title: string },
  ): Promise<{ requirement: Requirement; board: BoardData }> {
    return request('/api/requirements', 'POST', payload);
  }

  function updateRequirement(
    id: string,
    patch: Partial<Requirement>,
  ): Promise<{ requirement: Requirement; board: BoardData }> {
    return request(`/api/requirements/${id}`, 'PATCH', patch);
  }

  function deleteRequirement(id: string): Promise<{ deleted: string; board: BoardData }> {
    return request(`/api/requirements/${id}`, 'DELETE');
  }

  function createTask(
    payload: Partial<TaskItem> & { reqId: string; title: string },
  ): Promise<{ task: TaskItem; board: BoardData }> {
    return request('/api/tasks', 'POST', payload);
  }

  function updateTask(
    id: string,
    patch: Partial<TaskItem>,
  ): Promise<{ task: TaskItem; board: BoardData }> {
    return request(`/api/tasks/${id}`, 'PATCH', patch);
  }

  function deleteTask(id: string): Promise<{ deleted: string; board: BoardData }> {
    return request(`/api/tasks/${id}`, 'DELETE');
  }

  function fetchMarkdownExport(): Promise<string> {
    return read('/api/export/markdown');
  }

  return {
    fetchBoard,
    createRequirement,
    updateRequirement,
    deleteRequirement,
    createTask,
    updateTask,
    deleteTask,
    fetchMarkdownExport,
  };
}
