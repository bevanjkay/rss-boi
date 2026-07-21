import type { FastifyPluginAsync } from "fastify";
import { bootstrapInputSchema, setupStatusSchema } from "@rss-boi/shared";
import { env } from "../../config/env.js";
import { prisma } from "../../db/client.js";
import { hashPassword } from "../../lib/crypto.js";
import { HttpError } from "../../lib/errors.js";
import { createUserSession } from "../../lib/session.js";

type CreatedUser = Awaited<ReturnType<typeof prisma.user.create>>;

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

  fastify.post("/setup/bootstrap", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
      },
    },
  }, async (request, reply) => {
    if (await isSetupCompleted())
      return reply.code(409).send({ message: "Initial setup has already been completed." });

    const input = bootstrapInputSchema.parse(request.body);
    const passwordHash = await hashPassword(input.password);

    let user: CreatedUser;

    try {
      user = await prisma.$transaction(async (tx) => {
        if (await tx.user.count() > 0)
          throw new HttpError(409, "Initial setup has already been completed.");

        const createdUser = await tx.user.create({
          data: {
            email: input.email,
            passwordHash,
            role: "ADMIN",
            defaultPollMinutes: input.defaultPollMinutes,
          },
        });

        // Creating (not upserting) the singleton settings row makes two
        // concurrent bootstraps collide on the primary key, so only one
        // admin account can ever be created.
        await tx.instanceSettings.create({
          data: {
            id: "instance",
            instanceName: input.instanceName,
            setupCompleted: true,
          },
        });

        return createdUser;
      });
    }
    catch (error) {
      if ((error as { code?: string }).code === "P2002")
        throw new HttpError(409, "Initial setup has already been completed.");

      throw error;
    }

    await createUserSession(reply, user.id, env.APP_BASE_URL);

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
