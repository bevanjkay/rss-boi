# RSS Boi

## 1. Project Description

RSS Boi is a self-hosted RSS reader with a web UI, a Fastify API, a background worker, and PostgreSQL storage. It lets you bootstrap an instance, create an admin account, subscribe to feeds, poll feeds on a schedule, store entries, and manage read state per user.

The repository is organized as a small monorepo:

- `apps/web`: React + Vite frontend.
- `apps/api`: Fastify API for auth, setup, subscriptions, entries, and settings.
- `apps/worker`: background poller that fetches feeds and stores parsed entries.
- `packages/shared`: shared schemas and DTO types used across the apps.
- `prisma`: database schema and generated Prisma client.

## 2. Installation Instructions

These instructions use the root [docker-compose.yml](./docker-compose.yml), which runs PostgreSQL plus prebuilt container images for the API, worker, and web app. If you are deploying outside this repository, copy the contents of [docker-compose.yml](./docker-compose.yml) into your deployment directory first.

### Prerequisites

- Docker
- Docker Compose

### Setup

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Review and update any values in `.env` that you need, especially:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `SESSION_SECRET`
- `APP_BASE_URL`
- `API_BASE_URL`
- `VITE_API_BASE_URL`

3. Start the stack:

   ```bash
   docker compose up -d
   ```

4. Open the web app:

- Web UI: `http://localhost:3000`
- API: `http://localhost:3001`

5. Complete the bootstrap flow in the browser to create the initial admin account and instance name.

### Notes

- The root compose file expects the application images to exist as `ghcr.io/bevanjkay/rss-boi:web`, `ghcr.io/bevanjkay/rss-boi:api`, and `ghcr.io/bevanjkay/rss-boi:worker`.
- PostgreSQL data is persisted in the `postgres_data` Docker volume.

## 3. Development Instructions

For local development, use [docker/dev/docker-compose.yml](./docker/dev/docker-compose.yml). That file builds the app images from this repository instead of pulling prebuilt images. If you want a copy-first workflow here as well, copy the contents of [docker/dev/docker-compose.yml](./docker/dev/docker-compose.yml).

### Prerequisites

- Node.js 22+
- pnpm 10.33.2+
- Docker
- Docker Compose

### Environment Setup

1. Copy the example environment file if you have not already:

   ```bash
   cp .env.example .env
   ```

2. When running through `docker/dev/docker-compose.yml`, the database host inside containers is `postgres`, so the example `DATABASE_URL` works as-is.

### Start the Development Stack

Run the development compose file from the repository root:

```bash
docker compose -f docker/dev/docker-compose.yml up --build
```

This starts:

- PostgreSQL
- the API container built from `apps/api/Dockerfile`
- the worker container built from `apps/worker/Dockerfile`
- the web container built from `apps/web/Dockerfile`

### Useful Repository Commands

Install workspace dependencies:

```bash
pnpm install
```

Generate the Prisma client:

```bash
pnpm db:generate
```

Run database migrations in development:

```bash
pnpm db:migrate
```

Run linting:

```bash
pnpm lint
```

Run TypeScript checks:

```bash
pnpm typecheck
```

Build all packages:

```bash
pnpm build
```

### Development URLs

- Web UI: `http://localhost:3000`
- API: `http://localhost:3001`

### Workflow Summary

1. Start the dev stack with Docker Compose.
2. Apply Prisma migrations when the schema changes.
3. Re-run `pnpm db:generate` after Prisma schema updates.
4. Use `pnpm lint` and `pnpm typecheck` before pushing changes.