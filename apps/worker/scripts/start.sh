#!/bin/sh
set -eu

echo "Waiting for database migrations..."
if pnpm exec prisma migrate deploy 2>&1; then
  echo "Migrations applied."
else
  echo "Migration failed — baselining existing database..."
  pnpm exec prisma migrate resolve --applied 0001_init
  pnpm exec prisma migrate deploy
  echo "Migrations applied after baseline."
fi

exec pnpm --filter @rss-boi/worker start
