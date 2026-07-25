FROM node:24-alpine AS base
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json eslint.config.mjs ./

# Corepack is being removed from the Node distribution (already gone in Node
# 25+), so install pnpm directly. The version comes from the packageManager
# field so package.json stays the single source of truth.
RUN PNPM_VERSION="$(node -p "require('./package.json').packageManager.split('@')[1]")" \
  && npm install -g "pnpm@$PNPM_VERSION"

COPY prisma ./prisma
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rss-boi/web... build

EXPOSE 3000

CMD ["sh", "apps/web/scripts/start.sh"]
