FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts tsconfig.base.json tsconfig.json eslint.config.mjs ./
COPY prisma ./prisma
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile
RUN pnpm db:generate
RUN pnpm --filter @rss-boi/worker... build

CMD ["sh", "apps/worker/scripts/start.sh"]
