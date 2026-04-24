FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json tsconfig.json eslint.config.mjs ./
COPY prisma ./prisma
COPY packages ./packages
COPY apps ./apps

RUN pnpm install
RUN pnpm db:generate
RUN pnpm build

CMD ["sh", "apps/worker/scripts/start.sh"]
