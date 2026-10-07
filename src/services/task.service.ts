import { Department, Prisma, TaskStatus, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AuditService } from './audit.service';
import { CreateTaskDto, JwtPayload, UpdateTaskDto } from '../types';

export class TaskService {
  /**
   * Helper to check if a task is blocked by incomplete prerequisites
   */
  static async checkTaskBlockStatus(taskId: string) {
    const dependencies = await prisma.taskDependency.findMany({
      where: { taskId },
      include: {
        prerequisiteTask: {
          select: {
            id: true,
            title: true,
            status: true,
            department: true,
            assignee: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    const incompletePrerequisites = dependencies.filter(
      (dep) => dep.prerequisiteTask.status !== TaskStatus.DONE
    );

    const isBlocked = incompletePrerequisites.length > 0;

    return {
      isBlocked,
      totalDependencies: dependencies.length,
      incompletePrerequisites: incompletePrerequisites.map((dep) => ({
        id: dep.prerequisiteTask.id,
        title: dep.prerequisiteTask.title,
        status: dep.prerequisiteTask.status,
        department: dep.prerequisiteTask.department,
        assigneeName: dep.prerequisiteTask.assignee?.name,
      })),
    };
  }

  /**
   * Get single task by ID with full relations & computed block status
   */
  static async getTaskById(taskId: string) {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null,
      },
      include: {
        project: {
          select: { id: true, name: true, key: true },
        },
        assignee: {
          select: { id: true, name: true, email: true, avatar: true, department: true, role: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true, department: true },
        },
        dependencies: {
          include: {
            prerequisiteTask: {
              select: {
                id: true,
                title: true,
                status: true,
                department: true,
                assignee: { select: { id: true, name: true } },
              },
            },
          },
        },
        dependents: {
          include: {
            task: {
              select: {
                id: true,
                title: true,
                status: true,
                department: true,
                assignee: { select: { id: true, name: true } },
              },
            },
          },
        },
        comments: {
          where: { deletedAt: null },
          include: {
            user: {
              select: { id: true, name: true, avatar: true, role: true, department: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        auditLogs: {
          include: {
            user: {
              select: { id: true, name: true, role: true, department: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!task) return null;

    const blockStatus = await this.checkTaskBlockStatus(task.id);

    return {
      ...task,
      isBlocked: blockStatus.isBlocked,
      blockedBy: blockStatus.incompletePrerequisites,
    };
  }

  /**
   * Create Task (Only PM or allowed creator)
   */
  static async createTask(data: CreateTaskDto, user: JwtPayload) {
    // 1. Check user permission (PM only)
    if (user.role !== UserRole.PM) {
      throw { status: 403, message: 'Forbidden: Only Product Managers can create new tasks.' };
    }

    // 2. Count current tasks in project for order
    const count = await prisma.task.count({
      where: { projectId: data.projectId, deletedAt: null },
    });

    // 3. Create task in transaction
    const newTask = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          projectId: data.projectId,
          title: data.title,
          description: data.description || '',
          status: TaskStatus.TODO,
          department: data.department,
          assigneeId: data.assigneeId || null,
          createdById: user.userId,
          isClientVisible: data.isClientVisible ?? false,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          order: count + 1,
          version: 1,
        },
      });

      // Add dependencies if provided
      if (data.prerequisiteTaskIds && data.prerequisiteTaskIds.length > 0) {
        await tx.taskDependency.createMany({
          data: data.prerequisiteTaskIds.map((prereqId) => ({
            taskId: task.id,
            prerequisiteTaskId: prereqId,
          })),
          skipDuplicates: true,
        });
      }

      // Record audit log
      await tx.taskAuditLog.create({
        data: {
          taskId: task.id,
          projectId: task.projectId,
          userId: user.userId,
          changedColumn: 'created',
          oldValue: null,
          newValue: JSON.stringify({
            title: task.title,
            department: task.department,
            status: task.status,
          }),
        },
      });

      return task;
    });

    return this.getTaskById(newTask.id);
  }

  /**
   * Update Task (PM or Internal Team according to State-Based & Concurrency rules)
   */
  static async updateTask(taskId: string, data: UpdateTaskDto, user: JwtPayload) {
    const existingTask = await prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
      include: {
        dependencies: {
          include: {
            prerequisiteTask: true,
          },
        },
      },
    });

    if (!existingTask) {
      throw { status: 404, message: 'Task not found or has been deleted.' };
    }

    // 1. OPTIMISTIC LOCKING / CONCURRENCY CHECK
    if (data.version !== undefined && data.version !== existingTask.version) {
      throw {
        status: 409,
        message: 'Conflict: The task was updated by another user. Please refresh to load the latest changes.',
        currentVersion: existingTask.version,
        latestData: await this.getTaskById(taskId),
      };
    }

    // 2. STATE-BASED & ROLE-BASED ACCESS CONTROL (ABAC + RBAC)
    const isPM = user.role === UserRole.PM;
    const isInternal = user.role === UserRole.INTERNAL_TEAM;

    if (user.role === UserRole.CLIENT_GUEST) {
      throw { status: 403, message: 'Forbidden: Client Guests have read-only access.' };
    }

    // Internal Team CANNOT change core title or description
    if (isInternal) {
      if (data.title && data.title !== existingTask.title) {
        throw { status: 403, message: 'Forbidden: Internal engineers cannot modify the task title.' };
      }
      if (data.description !== undefined && data.description !== existingTask.description) {
        throw { status: 403, message: 'Forbidden: Internal engineers cannot modify the task description.' };
      }
      if (data.department && data.department !== existingTask.department) {
        throw { status: 403, message: 'Forbidden: Only PM can change assigned department.' };
      }
      if (data.isClientVisible !== undefined && data.isClientVisible !== existingTask.isClientVisible) {
        throw { status: 403, message: 'Forbidden: Only PM can toggle client visibility.' };
      }
      if (data.prerequisiteTaskIds !== undefined) {
        throw { status: 403, message: 'Forbidden: Only PM can define or modify task dependencies.' };
      }
    }

    // 3. STATUS TRANSITION RULES
    if (data.status && data.status !== existingTask.status) {
      const targetStatus = data.status;

      // RULE A: PM cannot move a task from IN_PROGRESS to DONE (only executor can complete it)
      if (isPM && existingTask.status === TaskStatus.IN_PROGRESS && targetStatus === TaskStatus.DONE) {
        throw {
          status: 403,
          message: 'Forbidden: Product Managers cannot complete tasks (move IN_PROGRESS to DONE). Only the assigned engineer/executor can complete it.',
        };
      }

      // RULE B: Moving to IN_PROGRESS requires all prerequisite tasks to be DONE!
      if (targetStatus === TaskStatus.IN_PROGRESS) {
        const blockStatus = await this.checkTaskBlockStatus(taskId);
        if (blockStatus.isBlocked) {
          const blockerNames = blockStatus.incompletePrerequisites
            .map((b) => `"${b.title}" (${b.department} - ${b.status})`)
            .join(', ');
          throw {
            status: 422,
            message: `Task is blocked! Cannot move to IN_PROGRESS until all prerequisite tasks are completed. Incomplete dependencies: ${blockerNames}`,
            blockers: blockStatus.incompletePrerequisites,
          };
        }
      }
    }

    // 4. PERFORM TRANSACTIONAL UPDATE WITH VERSION INCREMENT & AUDIT LOGGING
    const updated = await prisma.$transaction(async (tx) => {
      // Optimistic concurrency update
      const updateResult = await tx.task.updateMany({
        where: {
          id: taskId,
          version: existingTask.version,
          deletedAt: null,
        },
        data: {
          title: isPM && data.title ? data.title : undefined,
          description: isPM && data.description !== undefined ? data.description : undefined,
          department: isPM && data.department ? data.department : undefined,
          assigneeId: isPM && data.assigneeId !== undefined ? data.assigneeId : undefined,
          isClientVisible: isPM && data.isClientVisible !== undefined ? data.isClientVisible : undefined,
          dueDate: isPM && data.dueDate !== undefined ? (data.dueDate ? new Date(data.dueDate) : null) : undefined,
          status: data.status ?? undefined,
          attachments: data.attachments ?? undefined,
          version: { increment: 1 },
        },
      });

      if (updateResult.count === 0) {
        throw {
          status: 409,
          message: 'Conflict: The task was updated concurrently. Please refresh.',
        };
      }

      // If PM updated dependencies
      if (isPM && data.prerequisiteTaskIds !== undefined) {
        await tx.taskDependency.deleteMany({ where: { taskId } });
        if (data.prerequisiteTaskIds.length > 0) {
          await tx.taskDependency.createMany({
            data: data.prerequisiteTaskIds.map((prereqId) => ({
              taskId,
              prerequisiteTaskId: prereqId,
            })),
            skipDuplicates: true,
          });
        }
      }

      // Record audit logs
      const updatedTask = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
      await AuditService.recordFieldChanges(
        taskId,
        updatedTask.projectId,
        user.userId,
        existingTask,
        updatedTask
      );

      return updatedTask;
    });

    return this.getTaskById(updated.id);
  }

  /**
   * Update task status only (Dedicated endpoint for fast card drag/status change)
   */
  static async updateTaskStatus(taskId: string, status: TaskStatus, version: number, user: JwtPayload) {
    return this.updateTask(taskId, { status, version }, user);
  }

  /**
   * Add attachment to task
   */
  static async addAttachment(
    taskId: string,
    attachment: { name: string; url: string; size?: number; type?: string },
    user: JwtPayload
  ) {
    const task = await prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
    });
    if (!task) throw { status: 404, message: 'Task not found' };

    const currentAttachments = Array.isArray(task.attachments) ? task.attachments : [];
    const newAttachment = {
      ...attachment,
      id: crypto.randomUUID(),
      uploadedBy: { id: user.userId, name: user.name, department: user.department },
      uploadedAt: new Date().toISOString(),
    };

    const updatedList = [...currentAttachments, newAttachment];

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        attachments: updatedList,
        version: { increment: 1 },
      },
    });

    await AuditService.recordLog({
      taskId,
      projectId: task.projectId,
      userId: user.userId,
      changedColumn: 'attachments',
      oldValue: `Attachment count: ${currentAttachments.length}`,
      newValue: `Added attachment: ${attachment.name}`,
    });

    return this.getTaskById(updated.id);
  }

  /**
   * Add comment to task
   */
  static async addComment(
    taskId: string,
    content: string,
    isInternal: boolean,
    user: JwtPayload
  ) {
    const task = await prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
    });
    if (!task) throw { status: 404, message: 'Task not found' };

    // Client guest can only post non-internal comments
    const actualIsInternal = user.role === UserRole.CLIENT_GUEST ? false : isInternal;

    const comment = await prisma.taskComment.create({
      data: {
        taskId,
        userId: user.userId,
        content,
        isInternal: actualIsInternal,
      },
      include: {
        user: {
          select: { id: true, name: true, avatar: true, role: true, department: true },
        },
      },
    });

    await AuditService.recordLog({
      taskId,
      projectId: task.projectId,
      userId: user.userId,
      changedColumn: 'comment',
      newValue: `New comment (${actualIsInternal ? 'Internal' : 'Client-Visible'}): ${content.substring(0, 50)}...`,
    });

    return comment;
  }

  /**
   * Soft Delete Task (PM Only)
   */
  static async deleteTask(taskId: string, user: JwtPayload) {
    if (user.role !== UserRole.PM) {
      throw { status: 403, message: 'Forbidden: Only Product Managers can delete tasks.' };
    }

    const task = await prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
    });
    if (!task) throw { status: 404, message: 'Task not found' };

    await prisma.task.update({
      where: { id: taskId },
      data: { deletedAt: new Date() },
    });

    await AuditService.recordLog({
      taskId,
      projectId: task.projectId,
      userId: user.userId,
      changedColumn: 'deleted',
      oldValue: 'Active',
      newValue: 'Soft-deleted',
    });

    return { success: true, message: 'Task soft-deleted successfully.' };
  }
}
