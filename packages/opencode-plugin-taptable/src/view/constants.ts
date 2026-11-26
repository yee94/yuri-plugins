import type { TaskStatus } from '../board/types';

export const STATUS_ORDER: TaskStatus[] = ['todo', 'doing', 'verifying', 'done'];

export const STATUS_META: Record<
  TaskStatus,
  {
    label: string;
    dot: string;
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
  }
> = {
  todo: {
    label: '待开始',
    dot: 'bg-slate-400',
    badgeBg: 'bg-slate-50',
    badgeText: 'text-slate-700',
    badgeBorder: 'border-slate-200',
  },
  doing: {
    label: '进行中',
    dot: 'bg-blue-500',
    badgeBg: 'bg-blue-50',
    badgeText: 'text-blue-700',
    badgeBorder: 'border-blue-200',
  },
  verifying: {
    label: '验收中',
    dot: 'bg-amber-500',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-700',
    badgeBorder: 'border-amber-200',
  },
  done: {
    label: '已完成',
    dot: 'bg-emerald-500',
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-700',
    badgeBorder: 'border-emerald-200',
  },
};

export function getStageTone(stage: string): string {
  if (stage.includes('验收')) {
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }
  if (stage.includes('完成') || stage.includes('上线')) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (stage.includes('Patch') || stage.includes('客户端') || stage.includes('依赖')) {
    return 'bg-violet-50 text-violet-700 border-violet-200';
  }
  return 'bg-blue-50 text-blue-700 border-blue-200';
}
