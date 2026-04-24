#!/bin/sh
set -eu

echo "Applying database migrations..."

if pnpm exec prisma migrate deploy; then
  echo "Prisma migrations applied."
else
  echo "prisma migrate deploy failed. Falling back to prisma db push for compatibility with existing local databases."
  pnpm exec prisma db push --skip-generate
fi

exec pnpm --filter @rss-boi/api start
