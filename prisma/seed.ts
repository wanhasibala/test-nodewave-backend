import { PrismaClient, UserRole, Department, TaskStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  await prisma.taskAuditLog.deleteMany();
  await prisma.taskComment.deleteMany();
  await prisma.taskDependency.deleteMany();
  await prisma.task.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  const salt = await bcrypt.genSalt(10);
  const defaultHashedPassword = await bcrypt.hash('Password123!', salt);

  const pmUser = await prisma.user.create({
    data: {
      email: 'pm@nodewave.id',
      password: defaultHashedPassword,
      name: 'Rigen PM Lead',
      role: UserRole.PM,
      department: Department.PRODUCT_MANAGEMENT,
    },
  });

  const uiuxUser = await prisma.user.create({
    data: {
      email: 'uiux@nodewave.id',
      password: defaultHashedPassword,
      name: 'Sarah UI/UX Designer',
      role: UserRole.INTERNAL_TEAM,
      department: Department.UI_UX,
    },
  });

  const frontendUser = await prisma.user.create({
    data: {
      email: 'frontend@nodewave.id',
      password: defaultHashedPassword,
      name: 'Alex Frontend Engineer',
      role: UserRole.INTERNAL_TEAM,
      department: Department.FRONTEND,
    },
  });

  const backendUser = await prisma.user.create({
    data: {
      email: 'backend@nodewave.id',
      password: defaultHashedPassword,
      name: 'David Backend Engineer',
      role: UserRole.INTERNAL_TEAM,
      department: Department.BACKEND,
    },
  });

  const clientUser = await prisma.user.create({
    data: {
      email: 'client@acmecorp.com',
      password: defaultHashedPassword,
      name: 'Jessica Client Director',
      role: UserRole.CLIENT_GUEST,
      department: Department.CLIENT,
    },
  });

  const enterpriseProject = await prisma.project.create({
    data: {
      name: 'Enterprise E-Commerce Redesign',
      key: 'EECR',
      description: 'Omnichannel commerce platform deliverables and integration roadmap.',
      clientName: 'Acme Global Holdings',
      members: {
        create: [
          { userId: pmUser.id, role: 'OWNER' },
          { userId: uiuxUser.id, role: 'MEMBER' },
          { userId: frontendUser.id, role: 'MEMBER' },
          { userId: backendUser.id, role: 'MEMBER' },
          { userId: clientUser.id, role: 'CLIENT' },
        ],
      },
    },
  });

  const aiProject = await prisma.project.create({
    data: {
      name: 'AI Financial Analytics Dashboard',
      key: 'AFAD',
      description: 'Real-time telemetry, anomaly prediction, and automated reporting pipeline.',
      clientName: 'Vertex Capital Partners',
      members: {
        create: [
          { userId: pmUser.id, role: 'OWNER' },
          { userId: frontendUser.id, role: 'MEMBER' },
          { userId: backendUser.id, role: 'MEMBER' },
        ],
      },
    },
  });

  // Task A: UI Design (Prerequisite 1, completed)
  const taskA = await prisma.task.create({
    data: {
      projectId: enterpriseProject.id,
      title: 'Design System & Checkout Flow Mockups',
      description: 'Create Figma components, checkout flows, and design tokens.',
      status: TaskStatus.DONE,
      department: Department.UI_UX,
      assigneeId: uiuxUser.id,
      createdById: pmUser.id,
      isClientVisible: true,
      order: 1,
      version: 2,
      attachments: [
        {
          id: 'att-1',
          name: 'Figma-Design-Tokens-v2.fig',
          url: 'https://figma.com/file/nodewave-design-system',
          uploadedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
          uploadedBy: { name: 'Sarah UI/UX Designer', department: 'UI_UX' },
        },
      ],
    },
  });

  // Task B: Backend API Integration (Prerequisite 2, in progress)
  const taskB = await prisma.task.create({
    data: {
      projectId: enterpriseProject.id,
      title: 'Payment Gateway & Order API Endpoints',
      description: 'Implement webhook listeners, idempotency keys, and transaction ledger tables.',
      status: TaskStatus.IN_PROGRESS,
      department: Department.BACKEND,
      assigneeId: backendUser.id,
      createdById: pmUser.id,
      isClientVisible: true,
      order: 2,
      version: 2,
    },
  });

  // Task C: Frontend Slicing (Blocked by Task A and Task B)
  const taskC = await prisma.task.create({
    data: {
      projectId: enterpriseProject.id,
      title: 'Frontend Checkout & Slicing Integration',
      description: 'Build checkout steps, query hooks, and cart state persistence.',
      status: TaskStatus.TODO,
      department: Department.FRONTEND,
      assigneeId: frontendUser.id,
      createdById: pmUser.id,
      isClientVisible: true,
      order: 3,
      version: 1,
    },
  });

  // Task D: Internal DB Optimization (Internal only, hidden from client guest)
  const taskD = await prisma.task.create({
    data: {
      projectId: enterpriseProject.id,
      title: 'Database Partitioning & Read-Replica Pool',
      description: 'Database indexing and connection pooling adjustments.',
      status: TaskStatus.DONE,
      department: Department.BACKEND,
      assigneeId: backendUser.id,
      createdById: pmUser.id,
      isClientVisible: false,
      order: 4,
      version: 2,
    },
  });

  // Task E: Mobile QA (Dependent on Task C)
  const taskE = await prisma.task.create({
    data: {
      projectId: enterpriseProject.id,
      title: 'Mobile Responsive QA & Cross-browser Testing',
      description: 'Automated end-to-end testing across Safari, Chromium, and mobile viewports.',
      status: TaskStatus.TODO,
      department: Department.FRONTEND,
      assigneeId: frontendUser.id,
      createdById: pmUser.id,
      isClientVisible: true,
      order: 5,
      version: 1,
    },
  });

  // Link dependencies
  await prisma.taskDependency.createMany({
    data: [
      { taskId: taskC.id, prerequisiteTaskId: taskA.id },
      { taskId: taskC.id, prerequisiteTaskId: taskB.id },
      { taskId: taskE.id, prerequisiteTaskId: taskC.id },
    ],
  });

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(14, 30, 0, 0);

  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  // Seed immutable audit trail entries
  await prisma.taskAuditLog.createMany({
    data: [
      {
        taskId: taskA.id,
        projectId: enterpriseProject.id,
        userId: pmUser.id,
        changedColumn: 'created',
        oldValue: null,
        newValue: JSON.stringify({ title: taskA.title, status: 'TODO' }),
        createdAt: twoDaysAgo,
      },
      {
        taskId: taskA.id,
        projectId: enterpriseProject.id,
        userId: uiuxUser.id,
        changedColumn: 'status',
        oldValue: JSON.stringify('TODO'),
        newValue: JSON.stringify('IN_PROGRESS'),
        createdAt: twoDaysAgo,
      },
      {
        taskId: taskA.id,
        projectId: enterpriseProject.id,
        userId: uiuxUser.id,
        changedColumn: 'status',
        oldValue: JSON.stringify('IN_PROGRESS'),
        newValue: JSON.stringify('DONE'),
        createdAt: yesterday,
      },
      {
        taskId: taskB.id,
        projectId: enterpriseProject.id,
        userId: backendUser.id,
        changedColumn: 'status',
        oldValue: JSON.stringify('TODO'),
        newValue: JSON.stringify('IN_PROGRESS'),
        createdAt: yesterday,
      },
      {
        taskId: taskD.id,
        projectId: enterpriseProject.id,
        userId: backendUser.id,
        changedColumn: 'status',
        oldValue: JSON.stringify('IN_PROGRESS'),
        newValue: JSON.stringify('DONE'),
        createdAt: yesterday,
      },
    ],
  });

  await prisma.taskComment.createMany({
    data: [
      {
        taskId: taskA.id,
        userId: uiuxUser.id,
        content: 'Figma specs exported to tokens repository.',
        isInternal: true,
      },
      {
        taskId: taskC.id,
        userId: frontendUser.id,
        content: 'Ready to slice once backend payment endpoints are complete.',
        isInternal: true,
      },
      {
        taskId: taskA.id,
        userId: clientUser.id,
        content: 'Checkout wireframes reviewed and approved.',
        isInternal: false,
      },
    ],
  });
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
