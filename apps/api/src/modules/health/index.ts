import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../db/client.js";

export const healthModule: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health/live", async () => ({ ok: true }));

  fastify.get("/health/ready", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    }
    catch {
      return reply.code(503).send({ ok: false });
    }
  });
};
