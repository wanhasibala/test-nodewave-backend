import { Department, TaskStatus, UserRole } from '@prisma/client';
import { JwtPayload } from '../lib/jwt';

declare module 'hono' {
  interface ContextVariableMap {
    user: JwtPayload;
  }
}

export type { JwtPayload };

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  meta?: {
    total?: number;
    page?: number;
    rows?: number;
    totalPages?: number;
    [key: string]: any;
  };
  errors?: any;
}

export interface TaskDependencyDto {
  prerequisiteTaskId: string;
}

export interface CreateTaskDto {
  projectId: string;
  title: string;
  description?: string;
  department: Department;
  assigneeId?: string;
  isClientVisible?: boolean;
  dueDate?: string;
  prerequisiteTaskIds?: string[];
}

export interface UpdateTaskDto {
  title?: string;
  description?: string;
  status?: TaskStatus;
  department?: Department;
  assigneeId?: string | null;
  isClientVisible?: boolean;
  dueDate?: string | null;
  prerequisiteTaskIds?: string[];
  attachments?: any;
  version: number; // For optimistic locking
}

export interface TaskStatusUpdateDto {
  status: TaskStatus;
  version: number;
}

export interface StandupDepartmentSummary {
  department: Department;
  completedYesterday: Array<{
    id: string;
    title: string;
    assigneeName?: string;
    completedAt: string;
  }>;
  inProgressToday: Array<{
    id: string;
    title: string;
    assigneeName?: string;
  }>;
  blockedToday: Array<{
    id: string;
    title: string;
    assigneeName?: string;
    blockedBy: Array<{
      id: string;
      title: string;
      status: TaskStatus;
      department: Department;
    }>;
  }>;
}
