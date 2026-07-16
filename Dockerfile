# syntax=docker/dockerfile:1

# ========================================
# Base Stage
# ========================================
FROM node:22-bookworm AS base

# Enable corepack for pnpm support
RUN corepack enable

WORKDIR /app

# ========================================
# Dependencies Stage (Production)
# ========================================
FROM base AS deps

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY .npmrc* ./
COPY packages/belldandy-protocol/package.json ./packages/belldandy-protocol/
COPY packages/star-sanctuary-distribution/package.json ./packages/star-sanctuary-distribution/
COPY packages/belldandy-agent/package.json ./packages/belldandy-agent/
COPY packages/belldandy-core/package.json ./packages/belldandy-core/
COPY packages/belldandy-skills/package.json ./packages/belldandy-skills/
COPY packages/belldandy-memory/package.json ./packages/belldandy-memory/
COPY packages/belldandy-channels/package.json ./packages/belldandy-channels/
COPY packages/belldandy-mcp/package.json ./packages/belldandy-mcp/
COPY packages/belldandy-plugins/package.json ./packages/belldandy-plugins/
COPY packages/belldandy-browser/package.json ./packages/belldandy-browser/
COPY apps/web/package.json ./apps/web/

# Install production dependencies with cache mount
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# Some workspace packages have no direct production dependencies, so pnpm
# does not materialize a local node_modules directory for them. The runtime
# stage copies these paths explicitly, so create them proactively.
RUN mkdir -p \
    packages/belldandy-protocol/node_modules \
    packages/star-sanctuary-distribution/node_modules \
    packages/belldandy-agent/node_modules \
    packages/belldandy-core/node_modules \
    packages/belldandy-skills/node_modules \
    packages/belldandy-memory/node_modules \
    packages/belldandy-channels/node_modules \
    packages/belldandy-mcp/node_modules \
    packages/belldandy-plugins/node_modules \
    packages/belldandy-browser/node_modules

# ========================================
# Builder Stage
# ========================================
FROM base AS builder

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY .npmrc* ./
COPY packages/belldandy-protocol/package.json ./packages/belldandy-protocol/
COPY packages/star-sanctuary-distribution/package.json ./packages/star-sanctuary-distribution/
COPY packages/belldandy-agent/package.json ./packages/belldandy-agent/
COPY packages/belldandy-core/package.json ./packages/belldandy-core/
COPY packages/belldandy-skills/package.json ./packages/belldandy-skills/
COPY packages/belldandy-memory/package.json ./packages/belldandy-memory/
COPY packages/belldandy-channels/package.json ./packages/belldandy-channels/
COPY packages/belldandy-mcp/package.json ./packages/belldandy-mcp/
COPY packages/belldandy-plugins/package.json ./packages/belldandy-plugins/
COPY packages/belldandy-browser/package.json ./packages/belldandy-browser/
COPY apps/web/package.json ./apps/web/

# Copy tsconfig
COPY tsconfig*.json ./
COPY scripts ./scripts

# Install all dependencies (including dev dependencies for build)
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy source code
COPY packages ./packages
COPY apps ./apps

# Build TypeScript (tsc -b)
RUN pnpm build

# ========================================
# Runtime Stage (Production)
# ========================================
FROM node:22-bookworm-slim AS runtime
ARG BELLDANDY_VERSION=0.0.0-dev

# Enable corepack
RUN corepack enable

WORKDIR /app

LABEL org.opencontainers.image.title="Star Sanctuary" \
      org.opencontainers.image.description="Local-first personal AI assistant" \
      org.opencontainers.image.source="https://github.com/vrboyzero/star-sanctuary" \
      org.opencontainers.image.url="https://github.com/vrboyzero/star-sanctuary" \
      org.opencontainers.image.version="${BELLDANDY_VERSION}" \
      org.opencontainers.image.licenses="MIT"

# Create non-root user for security
RUN groupadd -g 1001 belldandy && \
    useradd -u 1001 -g belldandy -m -s /bin/bash belldandy

# Copy production dependencies from deps stage
COPY --from=deps --chown=belldandy:belldandy /app/node_modules ./node_modules
COPY --from=deps --chown=belldandy:belldandy /app/packages/belldandy-protocol/node_modules ./packages/belldandy-protocol/node_modules
COPY --from=deps --chown=belldandy:belldandy /app/packages/star-sanctuary-distribution/node_modules ./packages/star-sanctuary-distribution/node_modules
COPY --from=deps --chown=belldandy:belldandy /app/packages/belldandy-agent/node_modules ./packages/belldandy-agent/node_modules
COPY --from=deps --chown=belldandy:belldandy /app/packages/belldandy-core/node_modules ./packages/belldandy-core/node_modules
COPY --from=deps --chown=belldandy:belldandy /app/packages/belldandy-skills/node_modules ./packages/belldandy-skills/node_modules
COPY --from=deps --chown=belldandy:belldandy /app/packages/belldandy-memory/node_modules ./packages/belldandy-memory/node_modules
COPY --from=deps --chown=belldandy:belldandy /app/packages/belldandy-channels/node_modules ./packages/belldandy-channels/node_modules
COPY --from=deps --chown=belldandy:belldandy /app/packages/belldandy-mcp/node_modules ./packages/belldandy-mcp/node_modules
COPY --from=deps --chown=belldandy:belldandy /app/packages/belldandy-plugins/node_modules ./packages/belldandy-plugins/node_modules
COPY --from=deps --chown=belldandy:belldandy /app/packages/belldandy-browser/node_modules ./packages/belldandy-browser/node_modules

# Copy built artifacts from builder stage
COPY --from=builder --chown=belldandy:belldandy /app/packages/belldandy-protocol/dist ./packages/belldandy-protocol/dist
COPY --from=builder --chown=belldandy:belldandy /app/packages/star-sanctuary-distribution/dist ./packages/star-sanctuary-distribution/dist
COPY --from=builder --chown=belldandy:belldandy /app/packages/belldandy-agent/dist ./packages/belldandy-agent/dist
COPY --from=builder --chown=belldandy:belldandy /app/packages/belldandy-core/dist ./packages/belldandy-core/dist
COPY --from=builder --chown=belldandy:belldandy /app/packages/belldandy-skills/dist ./packages/belldandy-skills/dist
COPY --from=builder --chown=belldandy:belldandy /app/packages/belldandy-memory/dist ./packages/belldandy-memory/dist
COPY --from=builder --chown=belldandy:belldandy /app/packages/belldandy-channels/dist ./packages/belldandy-channels/dist
COPY --from=builder --chown=belldandy:belldandy /app/packages/belldandy-mcp/dist ./packages/belldandy-mcp/dist
COPY --from=builder --chown=belldandy:belldandy /app/packages/belldandy-plugins/dist ./packages/belldandy-plugins/dist
COPY --from=builder --chown=belldandy:belldandy /app/packages/belldandy-browser/dist ./packages/belldandy-browser/dist

# Copy runtime assets (templates, etc.)
COPY --from=builder --chown=belldandy:belldandy /app/packages/belldandy-agent/src/templates ./packages/belldandy-agent/dist/templates
COPY --from=builder --chown=belldandy:belldandy /app/packages/belldandy-skills/src/bundled-skills ./packages/belldandy-skills/dist/bundled-skills

# Copy WebChat frontend
COPY --from=builder --chown=belldandy:belldandy /app/apps/web/public ./apps/web/public

# Copy package.json files (needed for module resolution)
COPY --chown=belldandy:belldandy package.json pnpm-workspace.yaml ./
COPY --chown=belldandy:belldandy packages/belldandy-protocol/package.json ./packages/belldandy-protocol/
COPY --chown=belldandy:belldandy packages/star-sanctuary-distribution/package.json ./packages/star-sanctuary-distribution/
COPY --chown=belldandy:belldandy packages/belldandy-agent/package.json ./packages/belldandy-agent/
COPY --chown=belldandy:belldandy packages/belldandy-core/package.json ./packages/belldandy-core/
COPY --chown=belldandy:belldandy packages/belldandy-skills/package.json ./packages/belldandy-skills/
COPY --chown=belldandy:belldandy packages/belldandy-memory/package.json ./packages/belldandy-memory/
COPY --chown=belldandy:belldandy packages/belldandy-channels/package.json ./packages/belldandy-channels/
COPY --chown=belldandy:belldandy packages/belldandy-mcp/package.json ./packages/belldandy-mcp/
COPY --chown=belldandy:belldandy packages/belldandy-plugins/package.json ./packages/belldandy-plugins/
COPY --chown=belldandy:belldandy packages/belldandy-browser/package.json ./packages/belldandy-browser/
COPY --chown=belldandy:belldandy apps/web/package.json ./apps/web/

# Environment variables
ENV NODE_ENV=production \
    BELLDANDY_HOST=127.0.0.1 \
    BELLDANDY_PORT=28889 \
    BELLDANDY_STATE_DIR=/home/belldandy/.star_sanctuary \
    BELLDANDY_WEB_ROOT=/app/apps/web/public \
    BELLDANDY_VERSION=${BELLDANDY_VERSION}

# Switch to non-root user
USER belldandy

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:28889/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Expose port (documentation only, actual mapping requires -p)
EXPOSE 28889

# The builder already emits the hashed WebChat assets. Invoke the built CLI
# directly so the production image never needs dev-only asset-builder packages.
CMD ["node", "packages/belldandy-core/dist/bin/bdd.js", "start"]
