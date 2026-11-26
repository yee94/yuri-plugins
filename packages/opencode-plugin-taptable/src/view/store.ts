import { createContext, createMemo, createSignal, onCleanup, useContext } from 'solid-js';
import type { BoardData, Requirement, TaskItem, TaskStatus } from '../board/types';
import { createBoardApi, type BoardTransport } from './api';

export function createBoardStore(
  transport: BoardTransport,
  copy: (text: string) => Promise<unknown>,
) {
  let copyTimer: number | undefined;
  onCleanup(() => window.clearTimeout(copyTimer));
  const {
    createRequirement,
    createTask,
    deleteRequirement,
    deleteTask,
    fetchBoard,
    fetchMarkdownExport,
    updateRequirement,
    updateTask,
  } = createBoardApi(transport);

  const [boardState, setBoardState] = createSignal<BoardData | null>(null);
  const [loadingState, setLoadingState] = createSignal(true);
  const [errorState, setErrorState] = createSignal<string | null>(null);
  const [statusFilter, setStatusFilter] = createSignal<'all' | TaskStatus>('all');
  const [searchQuery, setSearchQuery] = createSignal('');
  const [collapsedReqIds, setCollapsedReqIds] = createSignal<string[]>([]);
  const [copiedState, setCopiedState] = createSignal(false);

  // 任务弹窗状态
  const [taskDialogOpen, setTaskDialogOpen] = createSignal(false);
  const [editingTaskId, setEditingTaskId] = createSignal<string | null>(null);
  const [taskFormReqId, setTaskFormReqId] = createSignal('');
  const [taskFormTitle, setTaskFormTitle] = createSignal('');
  const [taskFormStatus, setTaskFormStatus] = createSignal<TaskStatus>('todo');
  const [taskFormNote, setTaskFormNote] = createSignal('');
  const [taskSaving, setTaskSaving] = createSignal(false);

  // 需求弹窗状态
  const [reqDialogOpen, setReqDialogOpen] = createSignal(false);
  const [editingReqId, setEditingReqId] = createSignal<string | null>(null);
  const [reqFormTitle, setReqFormTitle] = createSignal('');
  const [reqFormStage, setReqFormStage] = createSignal('进行中');
  const [reqFormNote, setReqFormNote] = createSignal('');
  const [reqFormDocsText, setReqFormDocsText] = createSignal('');
  const [reqSaving, setReqSaving] = createSignal(false);

  const requirements = createMemo<Requirement[]>(() =>
    [...(boardState()?.requirements ?? [])].sort((a, b) => a.order - b.order),
  );

  const tasks = createMemo<TaskItem[]>(() =>
    [...(boardState()?.tasks ?? [])].sort((a, b) => a.order - b.order),
  );

  const statusCounts = createMemo(() => {
    const list = tasks();
    return {
      all: list.length,
      todo: list.filter((t) => t.status === 'todo').length,
      doing: list.filter((t) => t.status === 'doing').length,
      verifying: list.filter((t) => t.status === 'verifying').length,
      done: list.filter((t) => t.status === 'done').length,
    };
  });

  const filteredTasks = createMemo(() => {
    const filter = statusFilter();
    const q = searchQuery().trim().toLowerCase();
    return tasks().filter((t) => {
      if (filter !== 'all' && t.status !== filter) return false;
      if (q) {
        const hay = `${t.title} ${t.note}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  async function loadBoard() {
    setLoadingState(true);
    setErrorState(null);
    try {
      setBoardState(await fetchBoard());
    } catch (err) {
      setErrorState(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoadingState(false);
    }
  }

  function toggleCollapse(reqId: string) {
    setCollapsedReqIds((cur) =>
      cur.includes(reqId) ? cur.filter((id) => id !== reqId) : [...cur, reqId],
    );
  }

  async function patchTaskStatus(taskId: string, status: TaskStatus) {
    const res = await updateTask(taskId, { status });
    setBoardState(res.board);
  }

  async function patchTaskField(
    taskId: string,
    patch: Partial<Pick<TaskItem, 'title' | 'note' | 'status'>>,
  ) {
    const res = await updateTask(taskId, patch);
    setBoardState(res.board);
  }

  async function quickAddTask(reqId: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    const res = await createTask({
      reqId,
      title: trimmed,
      status: 'todo',
      note: '',
    });
    setBoardState(res.board);
  }

  async function toggleTaskDone(task: TaskItem) {
    await patchTaskStatus(task.id, task.status === 'done' ? 'todo' : 'done');
  }

  async function removeTask(taskId: string) {
    const res = await deleteTask(taskId);
    setBoardState(res.board);
  }

  function openCreateTask(reqId?: string) {
    setEditingTaskId(null);
    setTaskFormReqId(reqId ?? requirements()[0]?.id ?? '');
    setTaskFormTitle('');
    setTaskFormStatus('todo');
    setTaskFormNote('');
    setTaskDialogOpen(true);
  }

  function openEditTask(task: TaskItem) {
    setEditingTaskId(task.id);
    setTaskFormReqId(task.reqId);
    setTaskFormTitle(task.title);
    setTaskFormStatus(task.status);
    setTaskFormNote(task.note);
    setTaskDialogOpen(true);
  }

  async function submitTaskForm() {
    const title = taskFormTitle().trim();
    if (!title || !taskFormReqId()) return;
    setTaskSaving(true);
    try {
      const payload = {
        reqId: taskFormReqId(),
        title,
        status: taskFormStatus(),
        note: taskFormNote().trim(),
      };
      const editId = editingTaskId();
      const res = editId ? await updateTask(editId, payload) : await createTask(payload);
      setBoardState(res.board);
      setTaskDialogOpen(false);
      setEditingTaskId(null);
    } finally {
      setTaskSaving(false);
    }
  }

  function openCreateRequirement() {
    setEditingReqId(null);
    setReqFormTitle('');
    setReqFormStage('进行中');
    setReqFormNote('');
    setReqFormDocsText('');
    setReqDialogOpen(true);
  }

  function openEditRequirement(req: Requirement) {
    setEditingReqId(req.id);
    setReqFormTitle(req.title);
    setReqFormStage(req.stage);
    setReqFormNote(req.note);
    setReqFormDocsText((req.docs ?? []).map((d) => `${d.label} | ${d.url}`).join('\n'));
    setReqDialogOpen(true);
  }

  function parseDocsText(raw: string) {
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [left, right] = line.split('|').map((s) => s.trim());
        if (right) return { label: left, url: right };
        return { label: left, url: left };
      })
      .filter((d) => d.url.startsWith('http'));
  }

  async function submitRequirementForm() {
    const title = reqFormTitle().trim();
    if (!title) return;
    setReqSaving(true);
    try {
      const payload = {
        title,
        stage: reqFormStage().trim() || '进行中',
        note: reqFormNote().trim(),
        docs: parseDocsText(reqFormDocsText()),
      };
      const editId = editingReqId();
      const res = editId
        ? await updateRequirement(editId, payload)
        : await createRequirement(payload);
      setBoardState(res.board);
      setReqDialogOpen(false);
      setEditingReqId(null);
    } finally {
      setReqSaving(false);
    }
  }

  async function removeRequirement(reqId: string) {
    const res = await deleteRequirement(reqId);
    setBoardState(res.board);
    setReqDialogOpen(false);
    setEditingReqId(null);
  }

  async function copyMarkdownBrief() {
    const md = await fetchMarkdownExport();
    await copy(md);
    setCopiedState(true);
    window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      setCopiedState(false);
    }, 1800);
  }

  return {
    boardState,
    collapsedReqIds,
    copiedState,
    copyMarkdownBrief,
    editingReqId,
    editingTaskId,
    errorState,
    filteredTasks,
    loadBoard,
    loadingState,
    openCreateRequirement,
    openCreateTask,
    openEditRequirement,
    openEditTask,
    patchTaskField,
    patchTaskStatus,
    quickAddTask,
    removeRequirement,
    removeTask,
    reqDialogOpen,
    reqFormDocsText,
    reqFormNote,
    reqFormStage,
    reqFormTitle,
    reqSaving,
    requirements,
    searchQuery,
    setReqDialogOpen,
    setReqFormDocsText,
    setReqFormNote,
    setReqFormStage,
    setReqFormTitle,
    setSearchQuery,
    setStatusFilter,
    setTaskDialogOpen,
    setTaskFormNote,
    setTaskFormReqId,
    setTaskFormStatus,
    setTaskFormTitle,
    statusCounts,
    statusFilter,
    submitRequirementForm,
    submitTaskForm,
    taskDialogOpen,
    taskFormNote,
    taskFormReqId,
    taskFormStatus,
    taskFormTitle,
    taskSaving,
    tasks,
    toggleCollapse,
    toggleTaskDone,
  };
}

export const BoardStore = createContext<ReturnType<typeof createBoardStore>>();

export function useBoardStore() {
  const store = useContext(BoardStore);
  if (!store) throw new Error('TapTable 看板未初始化');
  return store;
}
