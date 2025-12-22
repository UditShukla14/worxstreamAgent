# Multi-stage build for Worxstream AI Agent
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Build stage for frontend
FROM base AS frontend-builder
WORKDIR /app/client

# Copy client package files
COPY client/package*.json ./
RUN npm ci

# Copy client source and build
COPY client/ ./
RUN npm run build

# Production stage
FROM base AS runner
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Copy backend dependencies
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy backend source
COPY --chown=nodejs:nodejs src ./src
COPY --chown=nodejs:nodejs package*.json ./

# Copy built frontend
COPY --from=frontend-builder --chown=nodejs:nodejs /app/client/dist ./public

# Create uploads directory
RUN mkdir -p uploads && chown nodejs:nodejs uploads

USER nodejs

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "src/index.js"]

