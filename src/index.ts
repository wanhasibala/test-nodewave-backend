import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authRoutes } from './routes/auth.routes';
import { projectRoutes } from './routes/project.routes';
import { taskRoutes } from './routes/task.routes';
import { userRoutes } from './routes/user.routes';
import { auditRoutes } from './routes/audit.routes';

const app = new Hono();

// Global Middlewares
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: (origin) => origin || '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposeHeaders: ['Content-Length', 'X-Total-Count'],
    credentials: true,
  })
);

// Health Check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'NodeWave Project Delivery API',
  });
});

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'NodeWave Project Delivery API',
  });
});

// Mount Routes
app.route('/api/auth', authRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/tasks', taskRoutes);
app.route('/api/users', userRoutes);
app.route('/api/audit-logs', auditRoutes);

// Global Error Handler
app.onError((err: any, c) => {
  console.error('Unhandled Application Error:', err);
  const status = typeof err.status === 'number' ? err.status : 500;
  return c.json(
    {
      success: false,
      message: err.message || 'Internal Server Error',
      errors: err.errors || undefined,
    },
    status
  );
});

// Not Found Handler
app.notFound((c) => {
  return c.json(
    {
      success: false,
      message: `Route not found: ${c.req.method} ${c.req.path}`,
    },
    404
  );
});

const PORT = parseInt(process.env.PORT || '4000', 10);

console.log(`🚀 NodeWave Delivery Engine API running on port ${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
