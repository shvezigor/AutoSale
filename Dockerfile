FROM node:24-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/integrations/package.json packages/integrations/package.json
COPY packages/observability/package.json packages/observability/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM build AS api-deploy
RUN pnpm --filter @autosale/api deploy --prod /prod/api

FROM build AS worker-deploy
RUN pnpm --filter @autosale/worker deploy --prod /prod/worker

FROM build AS migrate
CMD ["pnpm", "--filter", "@autosale/database", "exec", "prisma", "migrate", "deploy"]

FROM node:24-alpine AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-deploy --chown=node:node /prod/api /app
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM node:24-alpine AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=worker-deploy --chown=node:node /prod/worker /app
USER node
EXPOSE 3002
CMD ["node", "dist/main.js"]

FROM node:24-alpine AS web
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
