#!/bin/sh
set -eu

echo "Running database migrations..."
pnpm exec prisma migrate deploy
echo "Migrations applied."

exec pnpm --filter @rss-boi/api start
