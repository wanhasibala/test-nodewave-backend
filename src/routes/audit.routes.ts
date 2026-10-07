import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { parseEzFilterFromContext } from '../lib/ezfilter';
import { prisma } from '../lib/prisma';
import { UserRole } from '@prisma/client';

export const auditRoutes = new Hono();

auditRoutes.use('*', authMiddleware);

/**
 * GET /api/audit-logs - Query immutable audit logs with @nodewave/prisma-ezfilter
 */
auditRoutes.get('/', async (c) => {
  try {
    const user = c.get('user');

    if (user.role === UserRole.CLIENT_GUEST) {
      return c.json({
        success: true,
        data: [],
        meta: { page: 1, rows: 10, total: 0, totalPages: 0 },
      });
    }

    const { prismaQuery, page, rows } = parseEzFilterFromContext(c);

    const baseWhere: any = {};
    const projectId = c.req.query('projectId');
    const taskId = c.req.query('taskId');

    if (projectId) baseWhere.projectId = projectId;
    if (taskId) baseWhere.taskId = taskId;

    const finalWhere = {
      ...baseWhere,
      ...(prismaQuery.where?.AND?.length ? { AND: prismaQuery.where.AND } : {}),
    };

    const [logs, totalCount] = await Promise.all([
      prisma.taskAuditLog.findMany({
        where: finalWhere,
        include: {
          user: {
            select: { id: true, name: true, role: true, department: true },
          },
          task: {
            select: { id: true, title: true, department: true },
          },
        },
        orderBy: prismaQuery.orderBy && Object.keys(prismaQuery.orderBy).length > 0 ? prismaQuery.orderBy : { createdAt: 'desc' },
        skip: prismaQuery.skip ?? (page - 1) * rows,
        take: prismaQuery.take ?? rows,
      }),
      prisma.taskAuditLog.count({ where: finalWhere }),
    ]);

    return c.json({
      success: true,
      data: logs,
      meta: {
        page,
        rows,
        total: totalCount,
        totalPages: Math.ceil(totalCount / rows),
      },
    });
  } catch (error: any) {
    return c.json(
      { success: false, message: error.message || 'Failed to list audit logs' },
      error.status || 500
    );
  }
});
