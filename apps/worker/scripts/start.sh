#!/bin/sh
set -eu

echo "Waiting for database migrations..."
pnpm exec prisma migrate deploy
echo "Migrations applied."

exec pnpm --filter @rss-boi/worker start
