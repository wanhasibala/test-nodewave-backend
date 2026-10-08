import { Department, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { comparePassword, hashPassword } from '../lib/password';
import { generateToken, type JwtPayload } from '../lib/jwt';

export class AuthService {
  static async register(data: {
    email: string;
    password: string;
    name: string;
    role?: UserRole;
    department?: Department;
  }) {
    const existing = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });

    if (existing) {
      throw { status: 400, message: 'Email address is already registered.' };
    }

    const hashedPassword = await hashPassword(data.password);

    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        password: hashedPassword,
        name: data.name,
        role: data.role || UserRole.INTERNAL_TEAM,
        department: data.department || Department.FRONTEND,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        department: true,
        avatar: true,
        createdAt: true,
      },
    });

    const tokenPayload: JwtPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
    };

    const token = generateToken(tokenPayload);

    return { user, token };
  }

  static async login(data: { email: string; password: string }) {
    const user = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });

    if (!user || user.deletedAt) {
      throw { status: 401, message: 'Invalid email or password.' };
    }

    const isMatch = await comparePassword(data.password, user.password);
    if (!isMatch) {
      throw { status: 401, message: 'Invalid email or password.' };
    }

    const tokenPayload: JwtPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
    };

    const token = generateToken(tokenPayload);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        department: user.department,
        avatar: user.avatar,
      },
      token,
    };
  }

  static async me(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        department: true,
        avatar: true,
        memberships: {
          where: { deletedAt: null },
          include: {
            project: {
              select: { id: true, name: true, key: true },
            },
          },
        },
      },
    });

    if (!user) {
      throw { status: 404, message: 'User not found.' };
    }

    return user;
  }
}
