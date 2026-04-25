import type { FastifyPluginAsync } from "fastify";
import { changePasswordInputSchema, loginInputSchema } from "@rss-boi/shared";
import { env } from "../../config/env.js";
import { prisma } from "../../db/client.js";
import { hashPassword, verifyPassword } from "../../lib/crypto.js";
import { serializeUser } from "../../lib/serializers.js";
import { createUserSession, destroyUserSession } from "../../lib/session.js";
import { requireAuth } from "../../middleware/require-auth.js";

export const authModule: FastifyPluginAsync = async (fastify) => {
  fastify.post("/auth/login", async (request, reply) => {
    const input = loginInputSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (!user || user.status !== "ACTIVE")
      return reply.code(401).send({ message: "Invalid credentials." });

    const passwordMatches = await verifyPassword(user.passwordHash, input.password);

    if (!passwordMatches)
      return reply.code(401).send({ message: "Invalid credentials." });

    await createUserSession(reply, user.id, env.APP_BASE_URL);

    return {
      user: serializeUser(user),
    };
  });

  fastify.post("/auth/logout", async (request, reply) => {
    await destroyUserSession(request, reply, env.APP_BASE_URL);
    return reply.code(204).send();
  });

  fastify.get("/auth/me", async (request) => {
    return {
      user: request.user,
    };
  });

  fastify.post("/auth/change-password", { preHandler: requireAuth }, async (request, reply) => {
    const input = changePasswordInputSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { id: request.user!.id },
    });

    if (!user)
      return reply.code(404).send({ message: "User not found." });

    const passwordMatches = await verifyPassword(user.passwordHash, input.currentPassword);

    if (!passwordMatches)
      return reply.code(400).send({ message: "Current password is incorrect." });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(input.newPassword),
        mustChangePassword: false,
      },
    });

    return reply.code(204).send();
  });
};
