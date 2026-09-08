# syntax=docker/dockerfile:1.7
#
# Build from the repository root so the workspace packages are in context:
#   docker build -f apps/api/Dockerfile -t abay-api .
#
# Four stages. Only the last one ships: production dependencies, compiled
# JavaScript, the Prisma schema and migrations (for `migrate deploy` at
# release), running as the unprivileged `node` user. No shell tools it does
# not need, no dev dependencies, no source.

FROM node:24-bookworm-slim AS base
WORKDIR /repo
# Prisma's query engine links against OpenSSL; slim images do not ship it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ---- deps: the full dependency tree, resolved from the lockfile only ----------
FROM base AS deps
COPY package.json package-lock.json .npmrc turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
RUN npm ci --workspace=api --include-workspace-root --ignore-scripts

# ---- build: compile the packages the API depends on, then the API ------------
FROM deps AS build
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm run build --workspace=@abay/contracts \
 && npm run build --workspace=@abay/database \
 && npm run build --workspace=api
# Drop dev dependencies, then regenerate the Prisma client into the pruned tree
# (prune can remove the generated client; regenerating after is the safe order).
RUN npm prune --omit=dev --workspace=api --include-workspace-root \
 && npx prisma generate --schema packages/database/prisma/schema.prisma

# ---- runner: what actually ships ---------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0
COPY --from=build --chown=node:node /repo/package.json ./
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /repo/packages/contracts/package.json ./packages/contracts/
COPY --from=build --chown=node:node /repo/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /repo/packages/database/package.json ./packages/database/
COPY --from=build --chown=node:node /repo/packages/database/dist ./packages/database/dist
COPY --from=build --chown=node:node /repo/packages/database/prisma ./packages/database/prisma
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
