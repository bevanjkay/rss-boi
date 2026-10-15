import type { FastifyPluginAsync } from "fastify";
import { readingPreferencesSchema, settingsSchema, updateSettingsInputSchema } from "@rss-boi/shared";
import { prisma } from "../../db/client.js";
import { refreshFeedSchedule } from "../../lib/feeds.js";
import { requireAuth } from "../../middleware/require-auth.js";

// Stored preferences predate any later schema change, so anything that no
// longer parses falls back to the defaults rather than failing the request.
function parseReadingPreferences(value: unknown) {
  const result = readingPreferencesSchema.safeParse(value ?? {});
  return result.success ? result.data : readingPreferencesSchema.parse({});
}

export const settingsModule: FastifyPluginAsync = async (fastify) => {
  fastify.get("/settings/me", { preHandler: requireAuth }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.user!.id },
      select: { defaultPollMinutes: true, readingPreferences: true },
    });

    return settingsSchema.parse({
      defaultPollMinutes: user.defaultPollMinutes,
      readingPreferences: parseReadingPreferences(user.readingPreferences),
    });
  });

  fastify.patch("/settings/me", { preHandler: requireAuth }, async (request) => {
    const input = updateSettingsInputSchema.parse(request.body);

    const user = await prisma.user.update({
      where: { id: request.user!.id },
      data: {
        ...(input.defaultPollMinutes === undefined ? {} : { defaultPollMinutes: input.defaultPollMinutes }),
        ...(input.readingPreferences === undefined ? {} : { readingPreferences: input.readingPreferences }),
      },
      select: { defaultPollMinutes: true, readingPreferences: true },
    });

    if (input.defaultPollMinutes !== undefined) {
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
    }

    return settingsSchema.parse({
      defaultPollMinutes: user.defaultPollMinutes,
      readingPreferences: parseReadingPreferences(user.readingPreferences),
    });
  });
};
