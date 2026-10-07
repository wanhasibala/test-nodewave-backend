import { UserRole } from '@prisma/client';

export class DataMaskingHelper {
  /**
   * Masks single task data if requester is a Client Guest
   */
  static maskTask(task: any, role: UserRole) {
    if (!task) return task;
    if (role !== UserRole.CLIENT_GUEST) {
      return task;
    }

    const {
      assignee,
      createdBy,
      comments,
      auditLogs,
      assigneeId,
      createdById,
      dependencies,
      dependents,
      blockedBy,
      ...safeTask
    } = task;

    return {
      ...safeTask,
      // Mask assignee details
      assignee: assignee
        ? {
            id: null,
            name: 'NodeWave Engineering Team',
            avatar: null,
            department: null,
          }
        : null,
      assigneeId: null,
      createdBy: null,
      createdById: null,
      // Mask dependencies/dependents assignee information
      dependencies: dependencies
        ? dependencies.map((d: any) => ({
            ...d,
            prerequisiteTask: d.prerequisiteTask
              ? {
                  ...d.prerequisiteTask,
                  assignee: null,
                }
              : null,
          }))
        : [],
      dependents: dependents
        ? dependents.map((d: any) => ({
            ...d,
            task: d.task
              ? {
                  ...d.task,
                  assignee: null,
                }
              : null,
          }))
        : [],
      blockedBy: blockedBy
        ? blockedBy.map((b: any) => ({
            id: b.id,
            title: b.title,
            status: b.status,
            department: b.department,
            assigneeName: undefined,
          }))
        : [],
      // Filter out internal comments completely
      comments: comments ? comments.filter((c: any) => !c.isInternal) : [],
      // Exclude internal audit logs
      auditLogs: [],
    };
  }

  /**
   * Masks array of tasks if requester is a Client Guest
   */
  static maskTaskList(tasks: any[], role: UserRole) {
    if (role !== UserRole.CLIENT_GUEST) {
      return tasks;
    }
    return tasks
      .filter((task) => task.isClientVisible === true)
      .map((task) => this.maskTask(task, role));
  }

  /**
   * Mask project member list if requester is Client Guest
   */
  static maskProject(project: any, role: UserRole) {
    if (!project) return project;
    if (role !== UserRole.CLIENT_GUEST) {
      return project;
    }

    const { members, auditLogs, ...safeProject } = project;
    return {
      ...safeProject,
      members: members
        ? members
            .filter((m: any) => m.role === 'CLIENT' || m.user?.role === UserRole.CLIENT_GUEST)
            .map((m: any) => ({
              id: m.id,
              role: m.role,
              user: {
                id: m.user.id,
                name: m.user.name,
                email: m.user.email,
              },
            }))
        : [],
      auditLogs: [],
    };
  }
}
