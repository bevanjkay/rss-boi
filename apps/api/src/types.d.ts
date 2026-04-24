import type { UserDto } from "@rss-boi/shared";

declare module "fastify" {
  interface FastifyRequest {
    user: UserDto | null;
  }
}
