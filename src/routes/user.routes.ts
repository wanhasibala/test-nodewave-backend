import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { UserRole } from '@prisma/client';

export const userRoutes = new Hono();

userRoutes.use('*', authMiddleware);

/**
 * GET /api/users - List active users for assignees / members
 */
userRoutes.get('/', async (c) => {
  try {
    const currentUser = c.get('user');

    if (currentUser.role === UserRole.CLIENT_GUEST) {
      return c.json({
        success: true,
        data: [],
      });
    }

    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        avatar: true,
      },
      orderBy: { name: 'asc' },
    });

    return c.json({
      success: true,
      data: users,
    });
  } catch (error: any) {
    return c.json(
      { success: false, message: error.message || 'Failed to list users' },
      error.status || 500
    );
  }
});
