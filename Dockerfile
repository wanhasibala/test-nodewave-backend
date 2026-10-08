FROM oven/bun:1.1-slim AS base
WORKDIR /app

# Install OpenSSL and CA certificates for Prisma runtime on Linux
RUN apt-get update -y && apt-get install -y openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests and Prisma schema
COPY package.json bun.lockb* ./
COPY prisma ./prisma/

# Install dependencies and generate Prisma Client engine
RUN bun install --frozen-lockfile || bun install
RUN bun x prisma generate

# Copy application source code
COPY . .

# Production Environment Settings
ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

# Push database schema updates on boot and start server
CMD ["sh", "-c", "bun x prisma db push && bun run src/index.ts"]
