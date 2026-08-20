# BuildHub production image.
#
# Two stages. The builder installs the full dependency tree (devDependencies
# included, because Vite, esbuild, TypeScript and Tailwind all live there) and
# produces dist/. The runtime stage starts clean and copies in only the built
# output plus production dependencies.
#
# `npm run build` uses esbuild with --packages=external, so the server bundle
# does NOT contain its dependencies - node_modules must ship. That is why the
# runtime stage installs rather than merely copying dist/.

# ── Builder ────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# pnpm, pinned to the version that produced the committed lockfile. An
# unpinned `corepack enable` would silently resolve a different major and can
# reject the lockfile format.
ENV PNPM_HOME=/usr/local/bin
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

# Dependency manifests first, so a source-only change reuses the install layer.
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# Drop devDependencies from the tree that will be copied forward. Doing it here
# rather than reinstalling in the runtime stage keeps the runtime image free of
# a package manager and a compiler toolchain.
RUN pnpm prune --prod

# ── Runtime ────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
# `server/_core/index.ts` binds exactly this port in production or exits, rather
# than scanning upward and leaving health checks pointed at nothing.
ENV PORT=3000

# Runs as the `node` user that the base image already provides. Nothing here
# needs root, and a container process that does not need root should not have it.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/drizzle.config.ts ./drizzle.config.ts

USER node

EXPOSE 3000

# Liveness only. /readyz additionally checks the database and is the readiness
# probe, but a failing database must not make Docker kill and restart the
# container - it would restart forever while the database is the thing that is
# down.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
