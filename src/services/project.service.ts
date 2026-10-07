import { Prisma, TaskStatus, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { JwtPayload } from '../types';
import { TaskService } from './task.service';

export class ProjectService {
  /**
   * Get all projects accessible by the user
   */
  static async getProjects(user: JwtPayload) {
    let whereClause: Prisma.ProjectWhereInput = { deletedAt: null };

    if (user.role === UserRole.CLIENT_GUEST) {
      whereClause = {
        deletedAt: null,
        members: {
          some: {
            userId: user.userId,
            deletedAt: null,
          },
        },
      };
    } else if (user.role === UserRole.INTERNAL_TEAM) {
      whereClause = {
        deletedAt: null,
        members: {
          some: {
            userId: user.userId,
            deletedAt: null,
          },
        },
      };
    }

    const projects = await prisma.project.findMany({
      where: whereClause,
      include: {
        members: {
          where: { deletedAt: null },
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true, department: true, avatar: true },
            },
          },
        },
        _count: {
          select: {
            tasks: { where: { deletedAt: null } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate metrics for each project
    const enhancedProjects = await Promise.all(
      projects.map(async (project) => {
        const metrics = await this.getProjectMetrics(project.id, user.role);
        return {
          ...project,
          metrics,
        };
      })
    );

    return enhancedProjects;
  }

  /**
   * Get single project by ID with full details & metrics
   */
  static async getProjectById(projectId: string, user: JwtPayload) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      include: {
        members: {
          where: { deletedAt: null },
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true, department: true, avatar: true },
            },
          },
        },
      },
    });

    if (!project) return null;

    // Check permissions
    if (user.role !== UserRole.PM) {
      const isMember = project.members.some((m) => m.userId === user.userId);
      if (!isMember) {
        throw { status: 403, message: 'Forbidden: You do not have access to this project.' };
      }
    }

    const metrics = await this.getProjectMetrics(projectId, user.role);

    return {
      ...project,
      metrics,
    };
  }

  /**
   * Compute aggregate metrics for a project
   */
  static async getProjectMetrics(projectId: string, role: UserRole) {
    const taskWhere: Prisma.TaskWhereInput = {
      projectId,
      deletedAt: null,
    };

    if (role === UserRole.CLIENT_GUEST) {
      taskWhere.isClientVisible = true;
    }

    const tasks = await prisma.task.findMany({
      where: taskWhere,
      select: {
        id: true,
        status: true,
        department: true,
        isClientVisible: true,
      },
    });

    const total = tasks.length;
    const todo = tasks.filter((t) => t.status === TaskStatus.TODO).length;
    const inProgress = tasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length;
    const done = tasks.filter((t) => t.status === TaskStatus.DONE).length;

    // Count blocked tasks
    const todoTasks = tasks.filter((t) => t.status === TaskStatus.TODO);
    let blockedCount = 0;
    for (const t of todoTasks) {
      const blockStatus = await TaskService.checkTaskBlockStatus(t.id);
      if (blockStatus.isBlocked) {
        blockedCount++;
      }
    }

    const completionPercentage = total > 0 ? Math.round((done / total) * 100) : 0;

    return {
      total,
      todo,
      inProgress,
      done,
      blocked: blockedCount,
      completionPercentage,
      progressLabel: `${completionPercentage}% Complete`,
    };
  }

  /**
   * Create a new project (PM only)
   */
  static async createProject(
    data: { name: string; key: string; description?: string; clientName?: string; memberIds?: string[] },
    user: JwtPayload
  ) {
    if (user.role !== UserRole.PM) {
      throw { status: 403, message: 'Forbidden: Only Product Managers can create projects.' };
    }

    const project = await prisma.project.create({
      data: {
        name: data.name,
        key: data.key.toUpperCase(),
        description: data.description,
        clientName: data.clientName,
        members: {
          create: [
            // Add creator PM as OWNER
            { userId: user.userId, role: 'OWNER' },
            ...(data.memberIds || [])
              .filter((id) => id !== user.userId)
              .map((id) => ({
                userId: id,
                role: 'MEMBER',
              })),
          ],
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true, department: true },
            },
          },
        },
      },
    });

    return project;
  }

  /**
   * Update Project (PM only)
   */
  static async updateProject(
    projectId: string,
    data: { name?: string; description?: string; clientName?: string; memberIds?: string[] },
    user: JwtPayload
  ) {
    if (user.role !== UserRole.PM) {
      throw { status: 403, message: 'Forbidden: Only Product Managers can update projects.' };
    }

    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        name: data.name,
        description: data.description,
        clientName: data.clientName,
      },
    });

    if (data.memberIds) {
      // Refresh members
      await prisma.projectMember.deleteMany({ where: { projectId } });
      await prisma.projectMember.createMany({
        data: data.memberIds.map((userId) => ({
          projectId,
          userId,
          role: 'MEMBER',
        })),
        skipDuplicates: true,
      });
    }

    return this.getProjectById(project.id, user);
  }
}
