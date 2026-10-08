import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth';
import { ProjectService } from '../services/project.service';
import { StandupService } from '../services/standup.service';
import { DataMaskingHelper } from '../middleware/masking';
import { parseEzFilterFromContext } from '../lib/ezfilter';
import { prisma } from '../lib/prisma';
import { TaskService } from '../services/task.service';
import { UserRole } from '@prisma/client';

export const projectRoutes = new Hono();

projectRoutes.use('*', authMiddleware);

const createProjectSchema = z.object({
  name: z.string().min(2),
  key: z.string().min(2).max(10),
  description: z.string().optional(),
  clientName: z.string().optional(),
  memberIds: z.array(z.string()).optional(),
});

/**
 * GET /api/projects - List projects with filtering & role access
 */
projectRoutes.get('/', async (c) => {
  try {
    const user = c.get('user');
    const projects = await ProjectService.getProjects(user);

    // Apply Client Guest data masking if applicable
    const maskedProjects = projects.map((p) => DataMaskingHelper.maskProject(p, user.role));

    return c.json({
      success: true,
      data: maskedProjects,
      meta: {
        total: maskedProjects.length,
      },
    });
  } catch (error: any) {
    return c.json(
      { success: false, message: error.message || 'Failed to fetch projects' },
      error.status || 500
    );
  }
});

/**
 * POST /api/projects - Create project (PM only)
 */
projectRoutes.post('/', requireRole(UserRole.PM), async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const validated = createProjectSchema.parse(body);

    const project = await ProjectService.createProject(validated, user);

    return c.json(
      {
        success: true,
        message: 'Project created successfully',
        data: project,
      },
      201
    );
  } catch (error: any) {
    return c.json(
      { success: false, message: error.message || 'Failed to create project' },
      error.status || 400
    );
  }
});

/**
 * GET /api/projects/:id - Get single project
 */
projectRoutes.get('/:id', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    const project = await ProjectService.getProjectById(projectId, user);

    if (!project) {
      return c.json({ success: false, message: 'Project not found' }, 404);
    }

    const masked = DataMaskingHelper.maskProject(project, user.role);

    return c.json({
      success: true,
      data: masked,
    });
  } catch (error: any) {
    return c.json(
      { success: false, message: error.message || 'Failed to get project' },
      error.status || 500
    );
  }
});

/**
 * PUT /api/projects/:id - Update project (PM only)
 */
projectRoutes.put('/:id', requireRole(UserRole.PM), async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ success: false, message: 'Project ID is required' }, 400);
    }
    const body = await c.req.json();
    const validated = createProjectSchema.partial().parse(body);

    const project = await ProjectService.updateProject(projectId, validated, user);

    return c.json({
      success: true,
      message: 'Project updated successfully',
      data: project,
    });
  } catch (error: any) {
    return c.json(
      { success: false, message: error.message || 'Failed to update project' },
      error.status || 400
    );
  }
});

/**
 * GET /api/projects/:id/tasks - List project tasks with @nodewave/prisma-ezfilter & dependency resolution
 */
projectRoutes.get('/:id/tasks', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');

    // Check project access first
    const project = await ProjectService.getProjectById(projectId, user);
    if (!project) {
      return c.json({ success: false, message: 'Project not found' }, 404);
    }

    // Parse filters using @nodewave/prisma-ezfilter
    const { prismaQuery, page, rows } = parseEzFilterFromContext(c);

    // Merge project constraint & soft delete filter
    const baseWhere: any = {
      projectId,
      deletedAt: null,
    };

    if (user.role === UserRole.CLIENT_GUEST) {
      baseWhere.isClientVisible = true;
    }

    const finalWhere = {
      ...baseWhere,
      ...(prismaQuery.where?.AND?.length ? { AND: prismaQuery.where.AND } : {}),
    };

    const [rawTasks, totalCount] = await Promise.all([
      prisma.task.findMany({
        where: finalWhere,
        include: {
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
          _count: {
            select: {
              comments: { where: { deletedAt: null } },
              auditLogs: true,
            },
          },
        },
        orderBy: prismaQuery.orderBy && Object.keys(prismaQuery.orderBy).length > 0 ? prismaQuery.orderBy : { order: 'asc' },
        skip: prismaQuery.skip ?? (page - 1) * rows,
        take: prismaQuery.take ?? rows,
      }),
      prisma.task.count({ where: finalWhere }),
    ]);

    // Enhance tasks with computed block status
    const enhancedTasks = await Promise.all(
      rawTasks.map(async (task) => {
        const blockStatus = await TaskService.checkTaskBlockStatus(task.id);
        return {
          ...task,
          isBlocked: blockStatus.isBlocked,
          blockedBy: blockStatus.incompletePrerequisites,
        };
      })
    );

    // Apply Client Guest Data Masking
    const maskedTasks = DataMaskingHelper.maskTaskList(enhancedTasks, user.role);

    return c.json({
      success: true,
      data: maskedTasks,
      meta: {
        page,
        rows,
        total: totalCount,
        totalPages: Math.ceil(totalCount / rows),
      },
    });
  } catch (error: any) {
    return c.json(
      { success: false, message: error.message || 'Failed to fetch tasks' },
      error.status || 500
    );
  }
});

/**
 * GET /api/projects/:id/metrics - Aggregate metrics for project
 */
projectRoutes.get('/:id/metrics', async (c) => {
  try {
    const user = c.get('user');
    const projectId = c.req.param('id');
    const metrics = await ProjectService.getProjectMetrics(projectId, user.role);

    return c.json({
      success: true,
      data: metrics,
    });
  } catch (error: any) {
    return c.json(
      { success: false, message: error.message || 'Failed to fetch metrics' },
      error.status || 500
    );
  }
});

/**
 * GET /api/projects/:id/standup-summary - Daily Standup Auto-Summary
 */
projectRoutes.get('/:id/standup-summary', async (c) => {
  try {
    const projectId = c.req.param('id');
    const dateQuery = c.req.query('date');

    const summary = await StandupService.generateProjectStandupSummary(projectId, dateQuery);

    return c.json({
      success: true,
      data: summary,
    });
  } catch (error: any) {
    return c.json(
      { success: false, message: error.message || 'Failed to generate standup summary' },
      error.status || 500
    );
  }
});
