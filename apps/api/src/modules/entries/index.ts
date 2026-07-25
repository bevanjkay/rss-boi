import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { Prisma } from "../../db/client.js";
import { Buffer } from "node:buffer";
import { bulkMarkReadInputSchema, entryQuerySchema } from "@rss-boi/shared";
import { z } from "zod";
import { networkPolicy } from "../../config/env.js";
import { prisma } from "../../db/client.js";
import { createPdfBuffer, createZipBuffer, getImageExtension, getImageSourcesFromHtml, getPdfImage, getPlainTextFromHtml, getSafeDownloadName } from "../../lib/downloads.js";
import { serializeEntry } from "../../lib/serializers.js";
import { readBytesWithLimit, safeFetch } from "../../lib/ssrf.js";
import { requireAuth } from "../../middleware/require-auth.js";

const downloadImagesInputSchema = z.object({
  imageSources: z.array(z.string()).max(100).optional(),
});

const MAX_IMAGE_BYTES = 25_000_000;

interface EntryCursor {
  id: string;
  publishedAt: Date | null;
}

function encodeEntryCursor(entry: EntryCursor): string {
  const publishedPart = entry.publishedAt ? entry.publishedAt.getTime().toString() : "";
  return Buffer.from(`${publishedPart}:${entry.id}`, "utf8").toString("base64url");
}

function decodeEntryCursor(cursor: string): EntryCursor | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = decoded.indexOf(":");

    if (separator === -1)
      return null;

    const publishedPart = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);

    if (!id)
      return null;

    const publishedAt = publishedPart ? new Date(Number(publishedPart)) : null;

    if (publishedAt && Number.isNaN(publishedAt.getTime()))
      return null;

    return { id, publishedAt };
  }
  catch {
    return null;
  }
}

// Keyset filter for ORDER BY published_at DESC, id DESC. Postgres sorts NULL
// published_at first under DESC, so a null cursor is still inside that leading
// block; a non-null cursor has already passed it.
function buildCursorFilter(cursor: EntryCursor): Prisma.EntryWhereInput {
  if (cursor.publishedAt === null) {
    return {
      OR: [
        { publishedAt: null, id: { lt: cursor.id } },
        { publishedAt: { not: null } },
      ],
    };
  }

  return {
    OR: [
      { publishedAt: { lt: cursor.publishedAt } },
      { publishedAt: cursor.publishedAt, id: { lt: cursor.id } },
    ],
  };
}

export const entriesModule: FastifyPluginAsync = async (fastify) => {
  const getEntryArticleHtml = (entry: { contentHtml: string | null; summary: string | null }) =>
    entry.contentHtml ?? `<p>${entry.summary ?? "No article content was captured for this entry."}</p>`;

  const getEntryImageHtml = (entry: { contentHtml: string | null; summary: string | null }) =>
    [entry.contentHtml, entry.summary].filter((value): value is string => !!value).join("\n");

  const getEntrySourceUrl = (entry: { feed: { siteUrl: string | null }; url: string | null }) =>
    entry.url ?? entry.feed.siteUrl;

  const getEntryDownloadName = (entry: { feed: { siteUrl: string | null; title: string | null }; title: string | null; url: string | null }) =>
    getSafeDownloadName(entry.title ?? entry.url ?? entry.feed.title ?? entry.feed.siteUrl ?? "rss-boi-post");

  const getContentDisposition = (filename: string) =>
    `attachment; filename="${filename.replace(/"/g, "")}"`;

  const normalizeImageSources = (imageSources: string[] | undefined) => {
    const sources = new Set<string>();

    for (const source of imageSources ?? []) {
      try {
        const resolved = new URL(source);

        if (resolved.protocol === "http:" || resolved.protocol === "https:")
          sources.add(resolved.toString());
      }
      catch {
      }
    }

    return Array.from(sources);
  };

  const getRequestedImageSources = (body: unknown) => {
    const input = downloadImagesInputSchema.parse(body ?? {});
    return normalizeImageSources(input.imageSources);
  };

  const getEntryImageSources = (
    entry: { contentHtml: string | null; feed: { siteUrl: string | null }; summary: string | null; url: string | null },
    requestedImageSources: string[],
  ) => {
    if (requestedImageSources.length)
      return requestedImageSources;

    return getImageSourcesFromHtml(getEntryImageHtml(entry), getEntrySourceUrl(entry));
  };

  const downloadImages = async (imageSources: string[], baseName: string) => {
    const downloads = await Promise.allSettled(
      imageSources.map(async (source, index) => {
        const response = await safeFetch(source, {
          headers: {
            "User-Agent": "rss-boi/0.2",
          },
          signal: AbortSignal.timeout(30000),
        }, { policy: networkPolicy });

        if (!response.ok)
          throw new Error(`Unable to fetch ${source}`);

        const contentType = response.headers.get("content-type") ?? "";
        const data = await readBytesWithLimit(response, MAX_IMAGE_BYTES);

        return {
          contentType,
          data,
          name: `${baseName}-image-${index + 1}${getImageExtension(source, contentType)}`,
        };
      }),
    );

    return downloads.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  };

  const getSubscriptionScopeFilter = (userId: string, options?: { aggregateOnly?: boolean }) => ({
    some: {
      userId,
      enabled: true,
      ...(options?.aggregateOnly
        ? {
            includeInAggregateViews: true,
          }
        : {}),
    },
  });

  const getUnreadStateFilter = (userId: string) => ({
    OR: [
      {
        entryStates: {
          none: {
            userId,
          },
        },
      },
      {
        entryStates: {
          some: {
            userId,
            isRead: false,
          },
        },
      },
    ],
  });

  const getEntryWhereForUser = (userId: string, id: string) => ({
    id,
    feed: {
      subscriptions: {
        ...getSubscriptionScopeFilter(userId),
      },
    },
  });

  const sendImagesZip = async (userId: string, entryId: string, requestedImageSources: string[], reply: FastifyReply) => {
    const entry = await prisma.entry.findFirst({
      where: getEntryWhereForUser(userId, entryId),
      include: {
        feed: true,
      },
    });

    if (!entry)
      return reply.code(404).send({ message: "Entry not found." });

    const baseName = getEntryDownloadName(entry);
    const imageSources = getEntryImageSources(entry, requestedImageSources);

    if (!imageSources.length)
      return reply.code(404).send({ message: "Entry has no downloadable images." });

    const files = await downloadImages(imageSources, baseName);

    if (!files.length)
      return reply.code(502).send({ message: "No images could be downloaded from the source." });

    return reply
      .header("Content-Disposition", getContentDisposition(`${baseName}-images.zip`))
      .type("application/zip")
      .send(createZipBuffer(files));
  };

  const sendArticlePdf = async (userId: string, entryId: string, requestedImageSources: string[], reply: FastifyReply) => {
    const entry = await prisma.entry.findFirst({
      where: getEntryWhereForUser(userId, entryId),
      include: {
        feed: true,
      },
    });

    if (!entry)
      return reply.code(404).send({ message: "Entry not found." });

    const sourceUrl = getEntrySourceUrl(entry);
    const title = entry.title ?? sourceUrl ?? "Untitled entry";
    const baseName = getEntryDownloadName(entry);
    const imageSources = getEntryImageSources(entry, requestedImageSources);
    const downloadedImages = await downloadImages(imageSources, baseName);
    const pdfImages = downloadedImages.flatMap((image) => {
      const pdfImage = getPdfImage(image.data, image.contentType);
      return pdfImage ? [pdfImage] : [];
    });
    const articleText = getPlainTextFromHtml(getEntryArticleHtml(entry)) || "No article content was captured for this entry.";
    const meta = [
      `Feed: ${entry.feed.title ?? "Untitled feed"}`,
      `Published: ${entry.publishedAt ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(entry.publishedAt) : "Not published"}`,
      entry.author ? `Author: ${entry.author}` : null,
      sourceUrl ? `Source: ${sourceUrl}` : null,
    ].filter((line): line is string => !!line);
    const body = `${meta.join("\n")}\n\n${articleText}`;
    const filename = `${baseName}.pdf`;

    return reply
      .header("Content-Disposition", getContentDisposition(filename))
      .type("application/pdf")
      .send(createPdfBuffer(title, body, pdfImages));
  };

  fastify.get("/entries", { preHandler: requireAuth }, async (request, reply) => {
    const query = entryQuerySchema.parse(request.query);

    if (query.feedId) {
      const hasSubscription = await prisma.subscription.findFirst({
        where: {
          feedId: query.feedId,
          userId: request.user!.id,
        },
      });

      if (!hasSubscription)
        return reply.code(404).send({ message: "Feed not found." });
    }

    const filters: Prisma.EntryWhereInput[] = [
      {
        feed: {
          subscriptions: getSubscriptionScopeFilter(request.user!.id, { aggregateOnly: !query.feedId }),
        },
      },
    ];

    if (query.feedId)
      filters.push({ feedId: query.feedId });

    if (query.cursor) {
      const decodedCursor = decodeEntryCursor(query.cursor);

      if (decodedCursor)
        filters.push(buildCursorFilter(decodedCursor));
    }

    if (query.publishedAfter)
      filters.push({ publishedAt: { gte: new Date(query.publishedAfter) } });

    if (query.publishedBefore)
      filters.push({ publishedAt: { lt: new Date(query.publishedBefore) } });

    if (query.status === "unread")
      filters.push(getUnreadStateFilter(request.user!.id));

    const entries = await prisma.entry.findMany({
      where: { AND: filters },
      take: query.limit + 1,
      orderBy: [
        { publishedAt: "desc" },
        { id: "desc" },
      ],
      include: {
        feed: true,
        entryStates: {
          where: {
            userId: request.user!.id,
          },
          select: {
            isRead: true,
          },
        },
      },
    });

    const hasMore = entries.length > query.limit;
    const page = hasMore ? entries.slice(0, query.limit) : entries;
    const lastEntry = page.at(-1);

    return {
      entries: page.map(entry => serializeEntry(entry)),
      nextCursor: hasMore && lastEntry ? encodeEntryCursor(lastEntry) : null,
    };
  });

  fastify.post("/entries/read", { preHandler: requireAuth }, async (request, reply) => {
    const input = bulkMarkReadInputSchema.parse(request.body ?? {});

    if (input.feedId) {
      const hasSubscription = await prisma.subscription.findFirst({
        where: {
          feedId: input.feedId,
          userId: request.user!.id,
        },
      });

      if (!hasSubscription)
        return reply.code(404).send({ message: "Feed not found." });
    }

    const unreadEntries = await prisma.entry.findMany({
      where: {
        feed: {
          subscriptions: {
            ...getSubscriptionScopeFilter(request.user!.id, { aggregateOnly: !input.feedId }),
          },
        },
        ...(input.feedId
          ? {
              feedId: input.feedId,
            }
          : {}),
        ...getUnreadStateFilter(request.user!.id),
      },
      select: {
        id: true,
      },
    });

    if (!unreadEntries.length)
      return reply.code(204).send();

    const entryIds = unreadEntries.map(entry => entry.id);
    const now = new Date();

    await prisma.$transaction([
      prisma.userEntryState.createMany({
        data: entryIds.map(entryId => ({
          userId: request.user!.id,
          entryId,
          isRead: true,
          readAt: now,
        })),
        skipDuplicates: true,
      }),
      prisma.userEntryState.updateMany({
        where: {
          userId: request.user!.id,
          entryId: {
            in: entryIds,
          },
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: now,
        },
      }),
    ]);

    return reply.code(204).send();
  });

  fastify.get("/entries/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const entry = await prisma.entry.findFirst({
      where: getEntryWhereForUser(request.user!.id, id),
      include: {
        feed: true,
        entryStates: {
          where: {
            userId: request.user!.id,
          },
          select: {
            isRead: true,
          },
        },
      },
    });

    if (!entry)
      return reply.code(404).send({ message: "Entry not found." });

    return serializeEntry(entry);
  });

  fastify.get("/entries/:id/images.zip", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    return sendImagesZip(request.user!.id, id, [], reply);
  });

  fastify.post("/entries/:id/images.zip", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    return sendImagesZip(request.user!.id, id, getRequestedImageSources(request.body), reply);
  });

  fastify.get("/entries/:id/article.pdf", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    return sendArticlePdf(request.user!.id, id, [], reply);
  });

  fastify.post("/entries/:id/article.pdf", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    return sendArticlePdf(request.user!.id, id, getRequestedImageSources(request.body), reply);
  });

  fastify.post("/entries/:id/read", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const entry = await prisma.entry.findFirst({
      where: getEntryWhereForUser(request.user!.id, id),
    });

    if (!entry)
      return reply.code(404).send({ message: "Entry not found." });

    await prisma.userEntryState.upsert({
      where: {
        userId_entryId: {
          userId: request.user!.id,
          entryId: id,
        },
      },
      create: {
        userId: request.user!.id,
        entryId: id,
        isRead: true,
        readAt: new Date(),
      },
      update: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return reply.code(204).send();
  });

  fastify.post("/entries/:id/unread", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const entry = await prisma.entry.findFirst({
      where: getEntryWhereForUser(request.user!.id, id),
    });

    if (!entry)
      return reply.code(404).send({ message: "Entry not found." });

    await prisma.userEntryState.upsert({
      where: {
        userId_entryId: {
          userId: request.user!.id,
          entryId: id,
        },
      },
      create: {
        userId: request.user!.id,
        entryId: id,
        isRead: false,
        readAt: null,
      },
      update: {
        isRead: false,
        readAt: null,
      },
    });

    return reply.code(204).send();
  });
};
