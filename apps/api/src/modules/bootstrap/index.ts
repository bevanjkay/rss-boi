import type { FastifyPluginAsync } from "fastify";
import { bootstrapInputSchema, setupStatusSchema } from "@rss-boi/shared";
import { env } from "../../config/env.js";
import { prisma } from "../../db/client.js";
import { hashPassword } from "../../lib/crypto.js";
import { createUserSession } from "../../lib/session.js";

async function isSetupCompleted(): Promise<boolean> {
  const settings = await prisma.instanceSettings.findUnique({
    where: { id: "instance" },
  });

  if (settings?.setupCompleted)
    return true;

  const userCount = await prisma.user.count();
  return userCount > 0;
}

export const bootstrapModule: FastifyPluginAsync = async (fastify) => {
  fastify.get("/setup/status", async () => {
    return setupStatusSchema.parse({
      setupCompleted: await isSetupCompleted(),
    });
  });

  fastify.post("/setup/bootstrap", async (request, reply) => {
    if (await isSetupCompleted())
      return reply.code(409).send({ message: "Initial setup has already been completed." });

    const input = bootstrapInputSchema.parse(request.body);
    const passwordHash = await hashPassword(input.password);

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          role: "ADMIN",
          defaultPollMinutes: input.defaultPollMinutes,
        },
      });

      await tx.instanceSettings.upsert({
        where: { id: "instance" },
        create: {
          id: "instance",
          instanceName: input.instanceName,
          setupCompleted: true,
        },
        update: {
          instanceName: input.instanceName,
          setupCompleted: true,
        },
      });

      return createdUser;
    });

    await createUserSession(reply, user.id, env.NODE_ENV === "production");

    return reply.code(201).send({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        defaultPollMinutes: user.defaultPollMinutes,
        mustChangePassword: user.mustChangePassword,
      },
    });
  });
};
