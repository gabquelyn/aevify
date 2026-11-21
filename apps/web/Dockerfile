# Aevify web app (landing, dashboard, hosted checkout, API).
# Build from the repository root:
#   docker build -f apps/web/Dockerfile -t aevify-web .

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# 1. Prune the monorepo down to what @aevify/web needs.
FROM base AS pruner
COPY . .
RUN npx --yes turbo@2.11.13 prune @aevify/web --docker

# 2. Install dependencies (cached unless package files change), then build.
FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN npm ci
COPY --from=pruner /app/out/full/ .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx turbo run build --filter=@aevify/web

# 3. Minimal runtime image using Next.js standalone output.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
