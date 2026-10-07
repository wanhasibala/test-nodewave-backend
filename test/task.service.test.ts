import { describe, it, expect, beforeAll } from 'bun:test';
import { TaskService } from '../src/services/task.service';
import { StandupService } from '../src/services/standup.service';
import { prisma } from '../src/lib/prisma';
import { Department, TaskStatus, UserRole } from '@prisma/client';

describe('TaskService & Business Logic Tests', () => {
  let pmUser: any;
  let frontendUser: any;
  let taskA: any;
  let taskB: any;
  let taskC: any;
  let project: any;

  beforeAll(async () => {
    pmUser = await prisma.user.findUnique({ where: { email: 'pm@nodewave.id' } });
    frontendUser = await prisma.user.findUnique({ where: { email: 'frontend@nodewave.id' } });
    project = await prisma.project.findFirst({ where: { key: 'EECR' } });

    taskA = await prisma.task.findFirst({ where: { title: { contains: 'Design System' } } });
    taskB = await prisma.task.findFirst({ where: { title: { contains: 'Payment Gateway' } } });
    taskC = await prisma.task.findFirst({ where: { title: { contains: 'Frontend Checkout' } } });
  });

  it('should detect Task C as BLOCKED because prerequisite Task B is IN_PROGRESS', async () => {
    const blockStatus = await TaskService.checkTaskBlockStatus(taskC.id);
    expect(blockStatus.isBlocked).toBe(true);
    expect(blockStatus.incompletePrerequisites.length).toBeGreaterThan(0);
    expect(blockStatus.incompletePrerequisites[0].id).toBe(taskB.id);
  });

  it('should REJECT Frontend Engineer moving Task C to IN_PROGRESS while blocked (422)', async () => {
    try {
      await TaskService.updateTask(
        taskC.id,
        { status: TaskStatus.IN_PROGRESS, version: taskC.version },
        {
          userId: frontendUser.id,
          email: frontendUser.email,
          name: frontendUser.name,
          role: frontendUser.role,
          department: frontendUser.department,
        }
      );
      expect(true).toBe(false); // Should not reach here
    } catch (err: any) {
      expect(err.status).toBe(422);
      expect(err.message).toContain('blocked');
    }
  });

  it('should REJECT PM completing task from IN_PROGRESS to DONE (Rule: only executor can complete)', async () => {
    try {
      await TaskService.updateTask(
        taskB.id,
        { status: TaskStatus.DONE, version: taskB.version },
        {
          userId: pmUser.id,
          email: pmUser.email,
          name: pmUser.name,
          role: UserRole.PM,
          department: Department.PRODUCT_MANAGEMENT,
        }
      );
      expect(true).toBe(false); // Should not reach here
    } catch (err: any) {
      expect(err.status).toBe(403);
      expect(err.message).toContain('cannot complete');
    }
  });

  it('should REJECT update if version mismatch (Optimistic Lock Concurrency 409)', async () => {
    try {
      await TaskService.updateTask(
        taskA.id,
        { title: 'New Title Race Test', version: 999 }, // Outdated version
        {
          userId: pmUser.id,
          email: pmUser.email,
          name: pmUser.name,
          role: UserRole.PM,
          department: Department.PRODUCT_MANAGEMENT,
        }
      );
      expect(true).toBe(false); // Should not reach here
    } catch (err: any) {
      expect(err.status).toBe(409);
      expect(err.message).toContain('Conflict');
    }
  });

  it('should generate Daily Standup Auto-Summary with structured JSON per department', async () => {
    const summary = await StandupService.generateProjectStandupSummary(project.id);
    expect(summary).toBeDefined();
    expect(summary.project.id).toBe(project.id);
    expect(summary.departments).toBeInstanceOf(Array);
    expect(summary.departments.length).toBe(4);
  });
});
