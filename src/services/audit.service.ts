import { prisma } from '../lib/prisma';

export interface AuditEntry {
  taskId: string;
  projectId: string;
  userId: string;
  changedColumn: string;
  oldValue?: any;
  newValue?: any;
}

export class AuditService {
  /**
   * Record a single audit log entry
   */
  static async recordLog(entry: AuditEntry) {
    return prisma.taskAuditLog.create({
      data: {
        taskId: entry.taskId,
        projectId: entry.projectId,
        userId: entry.userId,
        changedColumn: entry.changedColumn,
        oldValue: entry.oldValue !== undefined ? JSON.stringify(entry.oldValue) : null,
        newValue: entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null,
      },
    });
  }

  /**
   * Record multiple field changes between old task and new task state
   */
  static async recordFieldChanges(
    taskId: string,
    projectId: string,
    userId: string,
    oldData: Record<string, any>,
    newData: Record<string, any>
  ) {
    const logs: Array<{
      taskId: string;
      projectId: string;
      userId: string;
      changedColumn: string;
      oldValue: string | null;
      newValue: string | null;
    }> = [];

    const fieldsToTrack = [
      'title',
      'description',
      'status',
      'department',
      'assigneeId',
      'isClientVisible',
      'dueDate',
      'attachments',
    ];

    for (const field of fieldsToTrack) {
      if (field in newData) {
        const oldVal = oldData[field];
        const newVal = newData[field];

        // Format dates or JSON if needed
        const oldStr = oldVal instanceof Date ? oldVal.toISOString() : oldVal !== undefined ? JSON.stringify(oldVal) : null;
        const newStr = newVal instanceof Date ? newVal.toISOString() : newVal !== undefined ? JSON.stringify(newVal) : null;

        if (oldStr !== newStr) {
          logs.push({
            taskId,
            projectId,
            userId,
            changedColumn: field,
            oldValue: oldStr,
            newValue: newStr,
          });
        }
      }
    }

    if (logs.length > 0) {
      await prisma.taskAuditLog.createMany({
        data: logs,
      });
    }

    return logs;
  }
}
