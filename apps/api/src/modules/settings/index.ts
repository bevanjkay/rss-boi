import type { FastifyPluginAsync } from "fastify";
import { settingsSchema, updateSettingsInputSchema } from "@rss-boi/shared";
import { prisma } from "../../db/client.js";
import { refreshFeedSchedule } from "../../lib/feeds.js";
import { requireAuth } from "../../middleware/require-auth.js";

export const settingsModule: FastifyPluginAsync = async (fastify) => {
  fastify.get("/settings/me", { preHandler: requireAuth }, async (request) => {
    return settingsSchema.parse({
      defaultPollMinutes: request.user!.defaultPollMinutes,
    });
  });

  fastify.patch("/settings/me", { preHandler: requireAuth }, async (request) => {
    const input = updateSettingsInputSchema.parse(request.body);

    await prisma.user.update({
      where: { id: request.user!.id },
      data: { defaultPollMinutes: input.defaultPollMinutes },
    });

    const subscriptions = await prisma.subscription.findMany({
      where: {
        userId: request.user!.id,
        enabled: true,
      },
      select: {
        feedId: true,
        overridePollMinutes: true,
      },
    });

    const feedIds = subscriptions
      .filter(subscription => subscription.overridePollMinutes === null)
      .map(subscription => subscription.feedId);

    for (const feedId of new Set(feedIds))
      await refreshFeedSchedule(feedId);

    return settingsSchema.parse({
      defaultPollMinutes: input.defaultPollMinutes,
    });
  });
};
