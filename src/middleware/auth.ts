import { Context, Next } from 'hono';
import { verifyToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { UserRole } from '@prisma/client';

export const authMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(
      {
        success: false,
        message: 'Authentication required. Please provide a valid Bearer token.',
      },
      401
    );
  }

  const token = authHeader.substring(7);
  try {
    const payload = verifyToken(token);
    
    // Verify user exists and is not soft-deleted
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true, role: true, department: true, deletedAt: true },
    });

    if (!user || user.deletedAt) {
      return c.json(
        {
          success: false,
          message: 'User account not found or has been deactivated.',
        },
        401
      );
    }

    c.set('user', {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
    });

    await next();
  } catch (error) {
    return c.json(
      {
        success: false,
        message: 'Invalid or expired token.',
      },
      401
    );
  }
};

export const requireRole = (...allowedRoles: UserRole[]) => {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, message: 'Unauthorized' }, 401);
    }

    if (!allowedRoles.includes(user.role)) {
      return c.json(
        {
          success: false,
          message: `Forbidden: Action requires one of the following roles: [${allowedRoles.join(', ')}]`,
        },
        403
      );
    }

    await next();
  };
};

export const checkProjectAccess = async (projectId: string, user: { userId: string; role: UserRole }) => {
  if (user.role === UserRole.PM) {
    return true; // PM has global project access
  }

  // Check if member of project
  const membership = await prisma.projectMember.findFirst({
    where: {
      projectId,
      userId: user.userId,
      deletedAt: null,
    },
  });

  return !!membership;
};
