# Aevify listener (for Railway or any container host).
# Build from the repository root:
#   docker build -f apps/listener/Dockerfile -t aevify-listener .
#
# Railway: set the service's Dockerfile path to apps/listener/Dockerfile and keep the build
# context at the repository root (it needs packages/shared). See DEPLOY.md.

FROM node:22-alpine AS base
WORKDIR /app

# 1. Prune the monorepo down to what the listener needs.
FROM base AS pruner
COPY . .
RUN npx --yes turbo@2.11.13 prune @aevify/listener --docker

# 2. Install and build the single-file bundle.
FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN npm ci
COPY --from=pruner /app/out/full/ .
RUN npx turbo run build --filter=@aevify/listener

# 3. Tiny runtime image: the build is a single self-contained file, no node_modules needed.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/listener/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/main.js"]
