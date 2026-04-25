FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json eslint.config.mjs ./
COPY prisma ./prisma
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rss-boi/web... build

EXPOSE 3000

CMD ["sh", "apps/web/scripts/start.sh"]
