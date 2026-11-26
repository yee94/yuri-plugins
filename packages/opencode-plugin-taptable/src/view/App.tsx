import { createEffect, createMemo, createSignal, For, onSettled, Show } from 'solid-js';
import { createInputController } from '@ui-sdk/solid/input';
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './components/ui/alert-dialog';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Checkbox } from './components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { Separator } from './components/ui/separator';
import { Skeleton } from './components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './components/ui/table';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs';
import { Textarea } from './components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from './components/ui/tooltip';
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  FolderPlusIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from './components/icons';
import type { Requirement, TaskItem, TaskStatus } from '../board/types';
import { getStageTone, STATUS_META, STATUS_ORDER } from './constants';
import { useBoardStore } from './store';

// 单元格内联编辑：单击即改，回车/失焦保存，Esc 取消
function InlineCell(props: {
  value: string;
  placeholder: string;
  class?: string;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal(props.value);
  const inputController = createInputController();

  createEffect(
    () => [props.value, editing()] as const,
    ([value, isEditing]) => {
      if (!isEditing) setDraft(value);
    },
  );

  createEffect(
    () => editing(),
    (isEditing) => {
      if (isEditing) {
        queueMicrotask(() => inputController.focus());
      }
    },
  );

  const commit = async () => {
    const trimmed = draft().trim();
    setEditing(false);
    if (trimmed !== props.value) {
      await props.onSave(trimmed);
    }
  };

  return (
    <Show
      when={editing()}
      fallback={
        <div
          role="button"
          tabindex={0}
          onClick={() => setEditing(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'F2') {
              e.preventDefault();
              setEditing(true);
            }
          }}
          title={props.value || props.placeholder}
          class={`flex h-5 w-full cursor-text items-center truncate rounded-xs px-1 leading-none transition-colors hover:bg-muted/70 ${props.class ?? ''}`}
        >
          <span class="truncate">
            <Show
              when={props.value}
              fallback={<span class="text-muted-foreground/45">{props.placeholder}</span>}
            >
              {props.value}
            </Show>
          </span>
        </div>
      }
    >
      <Input
        controller={inputController}
        value={draft()}
        onValueChange={(v) => setDraft(v)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            setDraft(props.value);
            setEditing(false);
          }
        }}
        placeholder={props.placeholder}
        class="h-5 rounded-xs px-1 py-0 text-xs shadow-none"
      />
    </Show>
  );
}

// 分组末尾的快速新建一行
function QuickAddRow(props: { reqId: string }) {
  const { quickAddTask } = useBoardStore();
  const [active, setActive] = createSignal(false);
  const [title, setTitle] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const inputController = createInputController();

  createEffect(
    () => active(),
    (isActive) => {
      if (isActive) {
        queueMicrotask(() => inputController.focus());
      }
    },
  );

  const submit = async () => {
    const trimmed = title().trim();
    if (!trimmed) {
      setActive(false);
      return;
    }
    setSaving(true);
    try {
      await quickAddTask(props.reqId, trimmed);
      setTitle('');
      queueMicrotask(() => inputController.focus());
    } finally {
      setSaving(false);
    }
  };

  return (
    <Show
      when={active()}
      fallback={
        <TableRow class="h-6 border-b border-border/80 bg-background hover:bg-muted/30">
          <TableCell
            colspan={5}
            class="h-6 cursor-pointer px-2 py-0 text-[11px] text-muted-foreground/65 hover:text-foreground"
            onClick={() => setActive(true)}
          >
            <span class="inline-flex items-center gap-1 pl-5">
              <PlusIcon class="h-3 w-3" />
              <span>添加任务…</span>
            </span>
          </TableCell>
        </TableRow>
      }
    >
      <TableRow class="h-7 border-b border-border/80 bg-muted/20 hover:bg-muted/20">
        <TableCell class="w-8 border-r border-border/60 py-0 text-center text-[11px] text-muted-foreground">
          +
        </TableCell>
        <TableCell colspan={4} class="px-1.5 py-0">
          <div class="flex items-center gap-1.5">
            <Input
              controller={inputController}
              disabled={saving()}
              value={title()}
              onValueChange={(v) => setTitle(v)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                } else if (e.key === 'Escape') {
                  setTitle('');
                  setActive(false);
                }
              }}
              placeholder="输入任务标题，回车创建（Esc 取消）"
              class="h-5 max-w-md rounded-xs bg-background px-1.5 text-xs shadow-none"
            />
            <Button
              size="sm"
              class="h-5 rounded-xs px-2 text-[11px]"
              disabled={saving() || !title().trim()}
              onClick={() => void submit()}
            >
              添加
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="h-5 rounded-xs px-1.5 text-[11px] text-muted-foreground"
              onClick={() => {
                setTitle('');
                setActive(false);
              }}
            >
              取消
            </Button>
          </div>
        </TableCell>
      </TableRow>
    </Show>
  );
}

function TaskRow(props: { task: TaskItem; rowIndex: number }) {
  const { openEditTask, patchTaskField, patchTaskStatus, removeTask, toggleTaskDone } =
    useBoardStore();
  const meta = () => STATUS_META[props.task.status];
  const isDone = () => props.task.status === 'done';

  return (
    <TableRow class="group h-7 border-b border-border/70 bg-background transition-colors hover:bg-muted/35">
      {/* 行号 / 完成勾选 */}
      <TableCell class="w-8 border-r border-border/60 px-1 py-0 text-center align-middle">
        <div class="flex items-center justify-center">
          <Show
            when={isDone()}
            fallback={
              <>
                <span class="text-[11px] text-muted-foreground/70 tabular-nums group-hover:hidden">
                  {props.rowIndex}
                </span>
                <span class="hidden group-hover:inline-flex">
                  <Checkbox
                    checked={false}
                    onCheckedChange={() => void toggleTaskDone(props.task)}
                    aria-label="标为已完成"
                    class="h-3.5 w-3.5 rounded-[3px]"
                  />
                </span>
              </>
            }
          >
            <Checkbox
              checked={true}
              onCheckedChange={() => void toggleTaskDone(props.task)}
              aria-label="标为未完成"
              class="h-3.5 w-3.5 rounded-[3px] data-checked:border-emerald-600 data-checked:bg-emerald-600"
            />
          </Show>
        </div>
      </TableCell>

      {/* 任务 */}
      <TableCell class="max-w-0 border-r border-border/60 px-1.5 py-0 align-middle">
        <InlineCell
          value={props.task.title}
          placeholder="输入任务名称"
          class={`text-xs font-medium ${
            isDone() ? 'text-muted-foreground line-through' : 'text-foreground'
          }`}
          onSave={async (next) => {
            if (next) await patchTaskField(props.task.id, { title: next });
          }}
        />
      </TableCell>

      {/* 状态 */}
      <TableCell class="border-r border-border/60 px-2 py-0 align-middle">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`切换状态，当前：${meta().label}`}
            class="inline-flex cursor-pointer items-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Badge
              variant="outline"
              class={`h-5 gap-1 rounded-sm px-1.5 text-[11px] font-medium transition-all hover:brightness-95 ${meta().badgeBg} ${meta().badgeText} ${meta().badgeBorder}`}
            >
              <span class={`h-1.5 w-1.5 shrink-0 rounded-full ${meta().dot}`} />
              <span>{meta().label}</span>
            </Badge>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="min-w-[112px] p-1">
            <For each={STATUS_ORDER}>
              {(key) => {
                const selected = () => key === props.task.status;
                return (
                  <DropdownMenuItem
                    onSelect={() => {
                      if (!selected()) void patchTaskStatus(props.task.id, key);
                    }}
                    class="flex cursor-pointer items-center justify-between gap-2 px-2 py-1 text-xs"
                  >
                    <span class="inline-flex items-center gap-1.5">
                      <span class={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_META[key].dot}`} />
                      <span>{STATUS_META[key].label}</span>
                    </span>
                    <Show when={selected()}>
                      <CheckIcon class="h-3 w-3 text-muted-foreground" />
                    </Show>
                  </DropdownMenuItem>
                );
              }}
            </For>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>

      {/* 备注 */}
      <TableCell class="max-w-0 border-r border-border/60 px-1.5 py-0 align-middle">
        <InlineCell
          value={props.task.note}
          placeholder="添加备注…"
          class={`text-xs ${isDone() ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}
          onSave={async (next) => {
            await patchTaskField(props.task.id, { note: next });
          }}
        />
      </TableCell>

      {/* 操作 */}
      <TableCell class="px-1 py-0 text-right align-middle">
        <div class="inline-flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Tooltip delay={250}>
            <TooltipTrigger
              render={(triggerProps) => (
                <Button
                  {...triggerProps}
                  variant="ghost"
                  size="icon"
                  class="h-5 w-5 rounded-xs text-muted-foreground hover:text-foreground"
                  onClick={() => openEditTask(props.task)}
                  aria-label="编辑任务"
                >
                  <PencilIcon class="h-3 w-3" />
                </Button>
              )}
            />
            <TooltipContent>编辑</TooltipContent>
          </Tooltip>

          <Tooltip delay={250}>
            <TooltipTrigger
              render={(triggerProps) => (
                <Button
                  {...triggerProps}
                  variant="ghost"
                  size="icon"
                  class="h-5 w-5 rounded-xs text-muted-foreground hover:text-destructive"
                  onClick={() => void removeTask(props.task.id)}
                  aria-label="删除任务"
                >
                  <Trash2Icon class="h-3 w-3" />
                </Button>
              )}
            />
            <TooltipContent>删除</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </TableRow>
  );
}

function RequirementGroupRows(props: { req: Requirement; startIndex: number }) {
  const {
    collapsedReqIds,
    filteredTasks,
    openCreateTask,
    openEditRequirement,
    searchQuery,
    statusFilter,
    tasks,
    toggleCollapse,
  } = useBoardStore();
  const allReqTasks = createMemo(() => tasks().filter((t) => t.reqId === props.req.id));
  const visibleTasks = createMemo(() => filteredTasks().filter((t) => t.reqId === props.req.id));
  const isFiltered = () => statusFilter() !== 'all' || searchQuery().trim().length > 0;
  const shouldRender = () => !(isFiltered() && visibleTasks().length === 0);
  const doneCount = createMemo(() => allReqTasks().filter((t) => t.status === 'done').length);
  const isCollapsed = () => collapsedReqIds().includes(props.req.id);

  return (
    <Show when={shouldRender()}>
      {/* 分组头行 */}
      <TableRow class="border-b border-border bg-muted/55 hover:bg-muted/70">
        <TableCell colspan={5} class="px-2 py-1">
          <div class="flex items-center justify-between gap-2">
            <div class="flex min-w-0 flex-1 items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                class="h-5 w-5 shrink-0 rounded-xs text-muted-foreground hover:bg-background/80 hover:text-foreground"
                onClick={() => toggleCollapse(props.req.id)}
                aria-label={isCollapsed() ? '展开分组' : '折叠分组'}
              >
                <Show when={isCollapsed()} fallback={<ChevronDownIcon class="h-3.5 w-3.5" />}>
                  <ChevronRightIcon class="h-3.5 w-3.5" />
                </Show>
              </Button>

              <span
                class="shrink-0 cursor-pointer text-xs font-semibold text-foreground"
                onClick={() => toggleCollapse(props.req.id)}
              >
                {props.req.title}
              </span>

              <Badge
                variant="outline"
                class={`h-[18px] shrink-0 rounded-sm px-1.5 text-[10.5px] font-medium ${getStageTone(props.req.stage)}`}
              >
                {props.req.stage}
              </Badge>

              <span class="shrink-0 text-[11px] font-medium text-muted-foreground tabular-nums">
                {doneCount()}/{allReqTasks().length}
              </span>

              <Show when={props.req.note}>
                <Separator orientation="vertical" class="h-3 shrink-0" />
                <Tooltip delay={250}>
                  <TooltipTrigger
                    render={(triggerProps) => (
                      <span
                        {...triggerProps}
                        class="min-w-0 truncate text-[11.5px] text-muted-foreground"
                      >
                        {props.req.note}
                      </span>
                    )}
                  />
                  <TooltipContent class="max-w-md text-xs leading-relaxed whitespace-normal">
                    {props.req.note}
                  </TooltipContent>
                </Tooltip>
              </Show>

              <Show when={(props.req.docs?.length ?? 0) > 0}>
                <div class="hidden shrink-0 items-center gap-1 lg:flex">
                  <For each={props.req.docs}>
                    {(doc) => (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        class="inline-flex h-[18px] items-center gap-1 rounded-sm border border-border bg-background px-1.5 text-[10.5px] font-normal text-muted-foreground transition-colors hover:border-blue-200 hover:bg-blue-50/70 hover:text-blue-700"
                      >
                        <span>{doc.label}</span>
                        <ExternalLinkIcon class="h-2.5 w-2.5 opacity-70" />
                      </a>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <div class="flex shrink-0 items-center gap-0.5">
              <Tooltip delay={250}>
                <TooltipTrigger
                  render={(triggerProps) => (
                    <Button
                      {...triggerProps}
                      variant="ghost"
                      size="icon"
                      class="h-5 w-5 rounded-xs text-muted-foreground hover:bg-background hover:text-foreground"
                      onClick={() => openEditRequirement(props.req)}
                      aria-label="编辑需求"
                    >
                      <PencilIcon class="h-3 w-3" />
                    </Button>
                  )}
                />
                <TooltipContent>编辑主线需求</TooltipContent>
              </Tooltip>

              <Tooltip delay={250}>
                <TooltipTrigger
                  render={(triggerProps) => (
                    <Button
                      {...triggerProps}
                      variant="ghost"
                      size="icon"
                      class="h-5 w-5 rounded-xs text-muted-foreground hover:bg-background hover:text-foreground"
                      onClick={() => openCreateTask(props.req.id)}
                      aria-label="在该需求下新建任务"
                    >
                      <PlusIcon class="h-3 w-3" />
                    </Button>
                  )}
                />
                <TooltipContent>新建任务</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <Show when={(props.req.docs?.length ?? 0) > 0}>
            <div class="mt-1 flex flex-wrap items-center gap-1 pl-6 lg:hidden">
              <For each={props.req.docs}>
                {(doc) => (
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    class="inline-flex h-[18px] items-center gap-1 rounded-sm border border-border bg-background px-1.5 text-[10.5px] font-normal text-muted-foreground transition-colors hover:border-blue-200 hover:bg-blue-50/70 hover:text-blue-700"
                  >
                    <span>{doc.label}</span>
                    <ExternalLinkIcon class="h-2.5 w-2.5 opacity-70" />
                  </a>
                )}
              </For>
            </div>
          </Show>
        </TableCell>
      </TableRow>

      <Show when={!isCollapsed()}>
        <For each={visibleTasks()}>
          {(task, idx) => <TaskRow task={task} rowIndex={props.startIndex + idx() + 1} />}
        </For>
        <Show when={!isFiltered()}>
          <QuickAddRow reqId={props.req.id} />
        </Show>
      </Show>
    </Show>
  );
}

function TaskDialog() {
  const {
    editingTaskId,
    requirements,
    setTaskDialogOpen,
    setTaskFormNote,
    setTaskFormReqId,
    setTaskFormStatus,
    setTaskFormTitle,
    submitTaskForm,
    taskDialogOpen,
    taskFormNote,
    taskFormReqId,
    taskFormStatus,
    taskFormTitle,
    taskSaving,
  } = useBoardStore();
  const isEdit = () => Boolean(editingTaskId());
  const selectedReqTitle = () => requirements().find((r) => r.id === taskFormReqId())?.title ?? '';
  const selectedStatusMeta = () => STATUS_META[taskFormStatus()];

  return (
    <Dialog open={taskDialogOpen()} onOpenChange={(open) => setTaskDialogOpen(open)}>
      <DialogContent class="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{isEdit() ? '编辑任务' : '新建任务'}</DialogTitle>
          <DialogDescription>填写任务名称、状态与备注。</DialogDescription>
        </DialogHeader>

        <div class="grid gap-4 py-1">
          <div class="grid grid-cols-2 gap-3">
            <div class="grid gap-1.5">
              <Label>所属需求</Label>
              <Select
                value={taskFormReqId()}
                onValueChange={(v) => {
                  if (v) setTaskFormReqId(v);
                }}
              >
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="选择需求">{selectedReqTitle()}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <For each={requirements()}>
                    {(r) => (
                      <SelectItem value={r.id} label={r.title}>
                        {r.title}
                      </SelectItem>
                    )}
                  </For>
                </SelectContent>
              </Select>
            </div>

            <div class="grid gap-1.5">
              <Label>状态</Label>
              <Select
                value={taskFormStatus()}
                onValueChange={(v) => {
                  if (v) setTaskFormStatus(v as TaskStatus);
                }}
              >
                <SelectTrigger class="w-full">
                  <SelectValue>
                    <span class="inline-flex items-center gap-2">
                      <span
                        class={`h-1.5 w-1.5 shrink-0 rounded-full ${selectedStatusMeta().dot}`}
                      />
                      <span>{selectedStatusMeta().label}</span>
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <For each={STATUS_ORDER}>
                    {(key) => (
                      <SelectItem value={key} label={STATUS_META[key].label}>
                        <span class="inline-flex items-center gap-2">
                          <span
                            class={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_META[key].dot}`}
                          />
                          <span>{STATUS_META[key].label}</span>
                        </span>
                      </SelectItem>
                    )}
                  </For>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div class="grid gap-1.5">
            <Label for="task-title">任务</Label>
            <Input
              id="task-title"
              value={taskFormTitle()}
              onValueChange={(v) => setTaskFormTitle(v)}
              placeholder="输入任务名称"
            />
          </div>

          <div class="grid gap-1.5">
            <Label for="task-note">备注</Label>
            <Textarea
              id="task-note"
              rows={3}
              value={taskFormNote()}
              onValueChange={(v) => setTaskFormNote(v)}
              placeholder="进展、卡点、依赖或补充说明"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setTaskDialogOpen(false)}>
            取消
          </Button>
          <Button
            onClick={() => void submitTaskForm()}
            disabled={!taskFormTitle().trim() || taskSaving()}
          >
            {taskSaving() ? '保存中…' : isEdit() ? '保存修改' : '添加任务'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequirementDialog() {
  const {
    editingReqId,
    removeRequirement,
    reqDialogOpen,
    reqFormDocsText,
    reqFormNote,
    reqFormStage,
    reqFormTitle,
    reqSaving,
    setReqDialogOpen,
    setReqFormDocsText,
    setReqFormNote,
    setReqFormStage,
    setReqFormTitle,
    submitRequirementForm,
  } = useBoardStore();
  const isEdit = () => Boolean(editingReqId());
  return (
    <Dialog open={reqDialogOpen()} onOpenChange={(open) => setReqDialogOpen(open)}>
      <DialogContent class="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isEdit() ? '编辑主线需求' : '新建主线需求'}</DialogTitle>
          <DialogDescription>维护需求名称、当前阶段、备注和关联文档。</DialogDescription>
        </DialogHeader>

        <div class="grid gap-4 py-1">
          <div class="grid grid-cols-3 gap-3">
            <div class="col-span-2 grid gap-1.5">
              <Label for="req-title">需求名称</Label>
              <Input
                id="req-title"
                value={reqFormTitle()}
                onValueChange={(v) => setReqFormTitle(v)}
                placeholder="如：云端小程序（云 MCP + 云 GUI）"
              />
            </div>

            <div class="grid gap-1.5">
              <Label for="req-stage">当前阶段</Label>
              <Input
                id="req-stage"
                value={reqFormStage()}
                onValueChange={(v) => setReqFormStage(v)}
                placeholder="如：验收中"
              />
            </div>
          </div>

          <div class="grid gap-1.5">
            <Label for="req-note">备注</Label>
            <Textarea
              id="req-note"
              rows={2}
              value={reqFormNote()}
              onValueChange={(v) => setReqFormNote(v)}
              placeholder="当前进度与关键说明"
            />
          </div>

          <div class="grid gap-1.5">
            <Label for="req-docs">关联文档（每行一条：标题 | URL）</Label>
            <Textarea
              id="req-docs"
              rows={3}
              value={reqFormDocsText()}
              onValueChange={(v) => setReqFormDocsText(v)}
              placeholder="技术方案 | https://example.com/doc"
            />
          </div>
        </div>

        <DialogFooter class="sm:justify-between">
          <Show when={isEdit() && editingReqId()} fallback={<div />}>
            {(reqId) => (
              <AlertDialog>
                <AlertDialogTrigger
                  render={(triggerProps) => (
                    <Button
                      {...triggerProps}
                      variant="ghost"
                      class="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      删除需求
                    </Button>
                  )}
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认删除该需求？</AlertDialogTitle>
                    <AlertDialogDescription>
                      删除「{reqFormTitle()}」会同时移除该需求下的所有任务，此操作无法撤销。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      class="bg-destructive text-white hover:bg-destructive/90"
                      action={() => removeRequirement(reqId())}
                    >
                      确认删除
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </Show>

          <div class="flex items-center gap-2">
            <Button variant="outline" onClick={() => setReqDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => void submitRequirementForm()}
              disabled={!reqFormTitle().trim() || reqSaving()}
            >
              {reqSaving() ? '保存中…' : isEdit() ? '保存修改' : '创建需求'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function App() {
  const {
    boardState,
    copiedState,
    copyMarkdownBrief,
    errorState,
    filteredTasks,
    loadBoard,
    loadingState,
    openCreateRequirement,
    openCreateTask,
    requirements,
    searchQuery,
    setSearchQuery,
    setStatusFilter,
    statusCounts,
    statusFilter,
  } = useBoardStore();
  onSettled(() => {
    void loadBoard();
  });

  const groupOffsets = createMemo(() => {
    const visible = filteredTasks();
    let runningOffset = 0;
    return requirements().map((req) => {
      const start = runningOffset;
      runningOffset += visible.filter((t) => t.reqId === req.id).length;
      return { req, start };
    });
  });

  return (
    <div class="flex min-h-full flex-col bg-background text-foreground">
      {/* 顶部工具栏 */}
      <div>
        <div class="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-[11px] text-muted-foreground tabular-nums">
              {requirements().length} 需求 ·{' '}
              <strong class="font-medium text-foreground">
                {statusCounts().all - statusCounts().done}
              </strong>
              /{statusCounts().all} 未完成
            </span>
            <Separator orientation="vertical" class="hidden h-3.5 sm:block" />

            <Tabs
              value={statusFilter()}
              onValueChange={(v) => {
                if (v) setStatusFilter(v as 'all' | TaskStatus);
              }}
            >
              <TabsList class="h-6 rounded-sm p-0.5">
                <TabsTrigger value="all" class="h-5 rounded-xs px-2 text-[11px]">
                  全部
                  <span class="ml-1 text-[10.5px] text-muted-foreground tabular-nums">
                    {statusCounts().all}
                  </span>
                </TabsTrigger>
                <For each={STATUS_ORDER}>
                  {(key) => {
                    const meta = STATUS_META[key];
                    return (
                      <TabsTrigger value={key} class="h-5 rounded-xs px-2 text-[11px]">
                        <span class={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                        <span class="ml-1 text-[10.5px] text-muted-foreground tabular-nums">
                          {statusCounts()[key]}
                        </span>
                      </TabsTrigger>
                    );
                  }}
                </For>
              </TabsList>
            </Tabs>
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <div class="relative w-40">
              <SearchIcon class="pointer-events-none absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                class="h-6 rounded-sm bg-background pl-6 text-xs shadow-none"
                placeholder="筛选任务或备注…"
                value={searchQuery()}
                onValueChange={(v) => setSearchQuery(v)}
                aria-label="筛选任务"
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              class="h-6 gap-1 rounded-sm px-2 text-[11px] shadow-none"
              onClick={() => void copyMarkdownBrief()}
            >
              <Show
                when={copiedState()}
                fallback={
                  <>
                    <CopyIcon class="h-3 w-3" />
                    简报
                  </>
                }
              >
                <CheckIcon class="h-3 w-3 text-emerald-600" />
                已复制
              </Show>
            </Button>

            <Button
              variant="outline"
              size="sm"
              class="h-6 w-[65px] gap-1 rounded-sm px-2 text-[11px] shadow-none"
              onClick={() => openCreateRequirement()}
            >
              <FolderPlusIcon class="h-3 w-3" />
              新需求
            </Button>

            <Button
              size="sm"
              class="h-6 w-[65px] gap-1 rounded-sm px-2 text-[11px]"
              onClick={() => openCreateTask()}
              disabled={requirements().length === 0}
            >
              <PlusIcon class="h-3 w-3" />
              新任务
            </Button>
          </div>
        </div>
      </div>

      {/* 多维表主体 */}
      <main class="flex-1 bg-background">
        <Show
          when={!loadingState()}
          fallback={
            <div class="space-y-1 p-3">
              <Skeleton class="h-6 w-full" />
              <Skeleton class="h-6 w-full" />
              <Skeleton class="h-6 w-full" />
              <Skeleton class="h-6 w-full" />
            </div>
          }
        >
          <Show
            when={!errorState()}
            fallback={
              <div class="p-3">
                <Alert variant="destructive">
                  <AlertCircleIcon class="h-4 w-4" />
                  <AlertTitle>加载失败</AlertTitle>
                  <AlertDescription>{errorState()}</AlertDescription>
                  <Button variant="outline" size="sm" onClick={() => void loadBoard()}>
                    重试
                  </Button>
                </Alert>
              </div>
            }
          >
            <Table class="w-full table-fixed border-collapse text-xs">
              <TableHeader class="sticky top-0 z-10 bg-zinc-50">
                <TableRow class="h-7 border-b border-border bg-zinc-50 hover:bg-zinc-50">
                  <TableHead class="h-7 w-8 border-r border-border/60 px-1 text-center text-[11px] font-medium text-muted-foreground">
                    #
                  </TableHead>
                  <TableHead class="h-7 w-[270px] border-r border-border/60 px-2.5 text-[11px] font-medium text-muted-foreground">
                    任务
                  </TableHead>
                  <TableHead class="h-7 w-[76px] border-r border-border/60 px-2 text-[11px] font-medium text-muted-foreground">
                    状态
                  </TableHead>
                  <TableHead class="h-7 border-r border-border/60 px-2.5 text-[11px] font-medium text-muted-foreground">
                    备注
                  </TableHead>
                  <TableHead class="h-7 w-[52px] px-1.5 text-right text-[11px] font-medium text-muted-foreground">
                    操作
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                <For each={groupOffsets()}>
                  {(entry) => <RequirementGroupRows req={entry.req} startIndex={entry.start} />}
                </For>

                <Show when={filteredTasks().length === 0}>
                  <TableRow class="hover:bg-transparent">
                    <TableCell colspan={5} class="py-8 text-center text-xs text-muted-foreground">
                      当前筛选条件下没有匹配记录
                    </TableCell>
                  </TableRow>
                </Show>
              </TableBody>
            </Table>
          </Show>
        </Show>
      </main>

      {/* 底部汇总条 */}
      <footer class="sticky bottom-0 z-20 flex items-center justify-between border-t border-border bg-zinc-50 px-3 py-1 text-[11px] text-muted-foreground tabular-nums">
        <div class="flex items-center gap-2.5">
          <span>共 {filteredTasks().length} 条</span>
          <Separator orientation="vertical" class="h-3" />
          <span>待开始 {statusCounts().todo}</span>
          <span>进行中 {statusCounts().doing}</span>
          <span>验收中 {statusCounts().verifying}</span>
          <span>已完成 {statusCounts().done}</span>
          <Show when={boardState()?.updatedAt}>
            {(updatedAt) => (
              <>
                <Separator orientation="vertical" class="hidden h-3 sm:block" />
                <span class="hidden sm:inline">更新于 {updatedAt()}</span>
              </>
            )}
          </Show>
        </div>
        <span class="hidden sm:inline">单击「任务 / 备注 / 状态」可直接修改</span>
      </footer>

      <TaskDialog />
      <RequirementDialog />
    </div>
  );
}
