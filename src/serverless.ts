import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { handle } from 'hono/vercel';
import { authRoutes } from './routes/auth.routes';
import { projectRoutes } from './routes/project.routes';
import { taskRoutes } from './routes/task.routes';
import { userRoutes } from './routes/user.routes';
import { auditRoutes } from './routes/audit.routes';

const app = new Hono();

// Allowed Origins Whitelist for Development and Production
const ALLOWED_ORIGIN_PATTERNS = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /\.vercel\.app$/,
];

const EXPLICIT_ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

// Dynamically add origins from environment variables if defined
if (process.env.FRONTEND_URL) {
  process.env.FRONTEND_URL.split(',').forEach((url) => EXPLICIT_ALLOWED_ORIGINS.add(url.trim()));
}
if (process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS.split(',').forEach((url) => EXPLICIT_ALLOWED_ORIGINS.add(url.trim()));
}

// Global Middlewares
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return '*';
      if (EXPLICIT_ALLOWED_ORIGINS.has(origin)) return origin;
      if (ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))) return origin;
      return origin;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
    ],
    exposeHeaders: ['Content-Length', 'X-Total-Count'],
    credentials: true,
    maxAge: 86400,
  })
);

// Explicit OPTIONS preflight handler
app.options('*', (c) => {
  return c.body(null, 204);
});

// Root & Health Check
app.get('/', (c) => {
  return c.json({
    status: 'online',
    service: 'NodeWave Project Delivery API (Serverless)',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      projects: '/api/projects',
      tasks: '/api/tasks',
      users: '/api/users',
      auditLogs: '/api/audit-logs',
    },
  });
});

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

export const config = {
  maxDuration: 30,
};

export default handle(app);
