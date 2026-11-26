export type TaskStatus = 'todo' | 'doing' | 'verifying' | 'done';

export interface DocLink {
  label: string;
  url: string;
}

export interface Requirement {
  id: string;
  title: string;
  stage: string;
  note: string;
  docs?: DocLink[];
  order: number;
}

export interface TaskItem {
  id: string;
  reqId: string;
  title: string;
  status: TaskStatus;
  note: string;
  updatedAt: string;
  order: number;
}

export interface BoardData {
  title: string;
  updatedAt: string;
  requirements: Requirement[];
  tasks: TaskItem[];
}
