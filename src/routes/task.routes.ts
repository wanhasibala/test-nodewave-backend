import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth';
import { TaskService } from '../services/task.service';
import { DataMaskingHelper } from '../middleware/masking';
import { parseEzFilterFromContext } from '../lib/ezfilter';
import { prisma } from '../lib/prisma';
import { Department, TaskStatus, UserRole } from '@prisma/client';

export const taskRoutes = new Hono();

taskRoutes.use('*', authMiddleware);

const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(2),
  description: z.string().optional(),
  department: z.nativeEnum(Department),
  assigneeId: z.string().uuid().optional(),
  isClientVisible: z.boolean().optional(),
  dueDate: z.string().optional(),
  prerequisiteTaskIds: z.array(z.string().uuid()).optional(),
});

const updateTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  department: z.nativeEnum(Department).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  isClientVisible: z.boolean().optional(),
  dueDate: z.string().nullable().optional(),
  prerequisiteTaskIds: z.array(z.string().uuid()).optional(),
  attachments: z.any().optional(),
  version: z.number().int(), // Required for optimistic locking
});

const updateStatusSchema = z.object({
  status: z.nativeEnum(TaskStatus),
  version: z.number().int(),
});

const addAttachmentSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  size: z.number().optional(),
  type: z.string().optional(),
});

const addCommentSchema = z.object({
  content: z.string().min(1),
  isInternal: z.boolean().optional().default(true),
});

/**
 * GET /api/tasks - List tasks across accessible projects using @nodewave/prisma-ezfilter
 */
taskRoutes.get('/', async (c) => {
  try {
    const user = c.get('user');
    const { prismaQuery, page, rows } = parseEzFilterFromContext(c);

    const baseWhere: any = { deletedAt: null };

    if (user.role === UserRole.CLIENT_GUEST) {
      baseWhere.isClientVisible = true;
      baseWhere.project = {
        members: {
          some: { userId: user.userId, deletedAt: null },
        },
      };
    } else if (user.role === UserRole.INTERNAL_TEAM) {
      baseWhere.project = {
        members: {
          some: { userId: user.userId, deletedAt: null },
        },
      };
    }

    const finalWhere = {
      ...baseWhere,
      ...(prismaQuery.where?.AND?.length ? { AND: prismaQuery.where.AND } : {}),
    };

    const [tasks, totalCount] = await Promise.all([
      prisma.task.findMany({
        where: finalWhere,
        include: {
          project: { select: { id: true, name: true, key: true } },
          assignee: { select: { id: true, name: true, avatar: true, department: true } },
          dependencies: {
            include: {
              prerequisiteTask: { select: { id: true, title: true, status: true, department: true } },
            },
          },
        },
        orderBy: prismaQuery.orderBy && Object.keys(prismaQuery.orderBy).length > 0 ? prismaQuery.orderBy : { createdAt: 'desc' },
        skip: prismaQuery.skip ?? (page - 1) * rows,
        take: prismaQuery.take ?? rows,
      }),
      prisma.task.count({ where: finalWhere }),
    ]);

    const enhanced = await Promise.all(
      tasks.map(async (t) => {
        const blockStatus = await TaskService.checkTaskBlockStatus(t.id);
        return {
          ...t,
          isBlocked: blockStatus.isBlocked,
          blockedBy: blockStatus.incompletePrerequisites,
        };
      })
    );

    const masked = DataMaskingHelper.maskTaskList(enhanced, user.role);

    return c.json({
      success: true,
      data: masked,
      meta: {
        page,
        rows,
        total: totalCount,
        totalPages: Math.ceil(totalCount / rows),
      },
    });
  } catch (error: any) {
    return c.json(
      { success: false, message: error.message || 'Failed to list tasks' },
      error.status || 500
    );
  }
});

/**
 * POST /api/tasks - Create Task (PM only)
 */
taskRoutes.post('/', requireRole(UserRole.PM), async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const validated = createTaskSchema.parse(body);

    const task = await TaskService.createTask(validated, user);

    return c.json(
      {
        success: true,
        message: 'Task created successfully',
        data: task,
      },
      201
    );
  } catch (error: any) {
    return c.json(
      { success: false, message: error.message || 'Failed to create task' },
      error.status || 400
    );
  }
});

/**
 * GET /api/tasks/:id - Get single task
 */
taskRoutes.get('/:id', async (c) => {
  try {
    const user = c.get('user');
    const taskId = c.req.param('id');
    const task = await TaskService.getTaskById(taskId);

    if (!task) {
      return c.json({ success: false, message: 'Task not found' }, 404);
    }

    if (user.role === UserRole.CLIENT_GUEST && !task.isClientVisible) {
      return c.json({ success: false, message: 'Task not found or access restricted' }, 404);
    }

    const masked = DataMaskingHelper.maskTask(task, user.role);

    return c.json({
      success: true,
      data: masked,
    });
  } catch (error: any) {
    return c.json(
      { success: false, message: error.message || 'Failed to get task' },
      error.status || 500
    );
  }
});

/**
 * PUT /api/tasks/:id - Update task with optimistic locking & state rules
 */
taskRoutes.put('/:id', async (c) => {
  try {
    const user = c.get('user');
    const taskId = c.req.param('id');
    const body = await c.req.json();
    const validated = updateTaskSchema.parse(body);

    const task = await TaskService.updateTask(taskId, validated, user);

    return c.json({
      success: true,
      message: 'Task updated successfully',
      data: task,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        message: error.message || 'Failed to update task',
        currentVersion: error.currentVersion,
        latestData: error.latestData,
        blockers: error.blockers,
      },
      error.status || 400
    );
  }
});

/**
 * PATCH /api/tasks/:id/status - Update task status with optimistic lock
 */
taskRoutes.patch('/:id/status', async (c) => {
  try {
    const user = c.get('user');
    const taskId = c.req.param('id');
    const body = await c.req.json();
    const validated = updateStatusSchema.parse(body);

    const task = await TaskService.updateTaskStatus(
      taskId,
      validated.status,
      validated.version,
      user
    );

    return c.json({
      success: true,
      message: `Task moved to ${validated.status}`,
      data: task,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        message: error.message || 'Failed to update task status',
        currentVersion: error.currentVersion,
        blockers: error.blockers,
      },
      error.status || 400
    );
  }
});

/**
 * POST /api/tasks/:id/attachments - Add work attachment
 */
taskRoutes.post('/:id/attachments', async (c) => {
  try {
    const user = c.get('user');
    const taskId = c.req.param('id');
    const body = await c.req.json();
    const validated = addAttachmentSchema.parse(body);

    const task = await TaskService.addAttachment(taskId, validated, user);

    return c.json({
      success: true,
      message: 'Attachment uploaded successfully',
      data: task,
    });
  } catch (error: any) {
    return c.json(
      { success: false, message: error.message || 'Failed to add attachment' },
      error.status || 400
    );
  }
});

/**
 * POST /api/tasks/:id/comments - Add comment
 */
taskRoutes.post('/:id/comments', async (c) => {
  try {
    const user = c.get('user');
    const taskId = c.req.param('id');
    const body = await c.req.json();
    const validated = addCommentSchema.parse(body);

    const comment = await TaskService.addComment(
      taskId,
      validated.content,
      validated.isInternal ?? true,
      user
    );

    return c.json({
      success: true,
      message: 'Comment added successfully',
      data: comment,
    });
  } catch (error: any) {
    return c.json(
      { success: false, message: error.message || 'Failed to add comment' },
      error.status || 400
    );
  }
});

/**
 * DELETE /api/tasks/:id - Soft delete task (PM only)
 */
taskRoutes.delete('/:id', requireRole(UserRole.PM), async (c) => {
  try {
    const user = c.get('user');
    const taskId = c.req.param('id');
    if (!taskId) {
      return c.json({ success: false, message: 'Task ID is required' }, 400);
    }
    const result = await TaskService.deleteTask(taskId, user);

    return c.json(result);
  } catch (error: any) {
    return c.json(
      { success: false, message: error.message || 'Failed to delete task' },
      error.status || 400
    );
  }
});
