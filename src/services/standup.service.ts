import { Department, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { TaskService } from './task.service';

export class StandupService {
  /**
   * Generate Daily Standup structured summary for a project
   * @param projectId Project UUID
   * @param targetDate Optional YYYY-MM-DD string; defaults to yesterday
   */
  static async generateProjectStandupSummary(projectId: string, targetDate?: string) {
    let dateObj: Date;
    if (targetDate) {
      dateObj = new Date(targetDate);
    } else {
      // Default to yesterday
      dateObj = new Date();
      dateObj.setDate(dateObj.getDate() - 1);
    }

    const startOfDay = new Date(dateObj);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(dateObj);
    endOfDay.setHours(23, 59, 59, 999);

    const project = await prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true, name: true, key: true },
    });

    if (!project) {
      throw { status: 404, message: 'Project not found.' };
    }

    // 1. WHAT WAS COMPLETED YESTERDAY: Audit logs with status change to DONE within the day
    const completionLogs = await prisma.taskAuditLog.findMany({
      where: {
        projectId,
        changedColumn: 'status',
        newValue: { contains: 'DONE' },
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            department: true,
            status: true,
            assignee: { select: { id: true, name: true } },
          },
        },
        user: {
          select: { id: true, name: true, department: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 2. ALL ACTIVE TASKS IN PROJECT
    const activeTasks = await prisma.task.findMany({
      where: {
        projectId,
        deletedAt: null,
      },
      include: {
        assignee: { select: { id: true, name: true } },
      },
      orderBy: { order: 'asc' },
    });

    // Departments list
    const departments: Department[] = [
      Department.UI_UX,
      Department.FRONTEND,
      Department.BACKEND,
      Department.PRODUCT_MANAGEMENT,
    ];

    // Build department breakdown
    const departmentSummaries = await Promise.all(
      departments.map(async (dept) => {
        // A. Completed Yesterday for this department
        const completed = completionLogs
          .filter((log) => log.task && log.task.department === dept)
          .map((log) => ({
            id: log.task.id,
            title: log.task.title,
            assigneeName: log.task.assignee?.name || log.user.name,
            completedAt: log.createdAt.toISOString(),
          }));

        // B. In Progress Today
        const inProgress = activeTasks
          .filter((t) => t.department === dept && t.status === TaskStatus.IN_PROGRESS)
          .map((t) => ({
            id: t.id,
            title: t.title,
            assigneeName: t.assignee?.name || 'Unassigned',
            dueDate: t.dueDate ? t.dueDate.toISOString() : null,
          }));

        // C. Blocked Today (TODO status with incomplete dependencies)
        const todoTasks = activeTasks.filter(
          (t) => t.department === dept && t.status === TaskStatus.TODO
        );

        const blocked: Array<{
          id: string;
          title: string;
          assigneeName?: string;
          blockedBy: Array<{
            id: string;
            title: string;
            status: TaskStatus;
            department: Department;
          }>;
        }> = [];

        for (const t of todoTasks) {
          const blockInfo = await TaskService.checkTaskBlockStatus(t.id);
          if (blockInfo.isBlocked) {
            blocked.push({
              id: t.id,
              title: t.title,
              assigneeName: t.assignee?.name || 'Unassigned',
              blockedBy: blockInfo.incompletePrerequisites,
            });
          }
        }

        return {
          department: dept,
          completedYesterday: completed,
          inProgressToday: inProgress,
          blockedToday: blocked,
          metrics: {
            completedCount: completed.length,
            inProgressCount: inProgress.length,
            blockedCount: blocked.length,
          },
        };
      })
    );

    return {
      date: dateObj.toISOString().split('T')[0],
      project,
      summaryGeneratedAt: new Date().toISOString(),
      departments: departmentSummaries,
    };
  }
}
