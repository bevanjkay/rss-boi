import type { FastifyPluginAsync } from "fastify";
import { fontCatalogSchema } from "@rss-boi/shared";
import { z } from "zod";
import { getFamiliesOnServer, getFamilyCss, getFontCatalog, getFontFile } from "../../lib/google-fonts.js";
import { requireAuth } from "../../middleware/require-auth.js";

const familyQuerySchema = z.object({
  family: z.string().trim().min(1).max(80),
});

export const fontsModule: FastifyPluginAsync = async (fastify) => {
  fastify.get("/fonts", { preHandler: requireAuth }, async () => {
    const [catalog, onServer] = await Promise.all([getFontCatalog(), getFamiliesOnServer()]);

    return fontCatalogSchema.parse({
      available: catalog !== null,
      families: (catalog ?? []).map(({ category, family }) => ({ category, family })),
      onServer,
    });
  });

  fastify.get("/fonts/css", { preHandler: requireAuth }, async (request, reply) => {
    const { family } = familyQuerySchema.parse(request.query);
    const css = await getFamilyCss(family).catch(() => undefined);

    if (css === undefined)
      return reply.code(502).send({ message: "Google Fonts can't be reached right now." });

    if (css === null)
      return reply.code(404).send({ message: `"${family}" isn't on Google Fonts.` });

    return reply.type("text/css; charset=utf-8").send(css);
  });

  // Public, because browsers fetch font files without credentials. Only files
  // listed in a stylesheet a signed-in user already requested can be served.
  fastify.get("/fonts/files/*", async (request, reply) => {
    const path = `/${(request.params as { "*": string })["*"]}`;
    const file = await getFontFile(path).catch(() => null);

    if (!file)
      return reply.code(404).send({ message: "Font file not found." });

    return reply
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .type(file.contentType)
      .send(file.data);
  });
};
