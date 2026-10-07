import { Hono } from 'hono';
import { z } from 'zod';
import { AuthService } from '../services/auth.service';
import { authMiddleware } from '../middleware/auth';
import { Department, UserRole } from '@prisma/client';

export const authRoutes = new Hono();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  role: z.nativeEnum(UserRole).optional(),
  department: z.nativeEnum(Department).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRoutes.post('/register', async (c) => {
  try {
    const body = await c.req.json();
    const validated = registerSchema.parse(body);
    const result = await AuthService.register(validated);

    return c.json(
      {
        success: true,
        message: 'Registration successful',
        data: result,
      },
      201
    );
  } catch (error: any) {
    return c.json(
      {
        success: false,
        message: error.message || 'Registration failed',
        errors: error.errors || undefined,
      },
      error.status || 400
    );
  }
});

authRoutes.post('/login', async (c) => {
  try {
    const body = await c.req.json();
    const validated = loginSchema.parse(body);
    const result = await AuthService.login(validated);

    return c.json({
      success: true,
      message: 'Login successful',
      data: result,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        message: error.message || 'Login failed',
      },
      error.status || 401
    );
  }
});

authRoutes.get('/me', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const profile = await AuthService.me(user.userId);

    return c.json({
      success: true,
      data: profile,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        message: error.message || 'Failed to fetch user profile',
      },
      error.status || 500
    );
  }
});
