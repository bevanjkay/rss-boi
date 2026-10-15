import { Buffer } from "node:buffer";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";

const CSS_ORIGIN = "https://fonts.googleapis.com";
const FILE_ORIGIN = "https://fonts.gstatic.com";
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_FONT_FILE_BYTES = 5 * 1024 * 1024;
// Google serves woff2 only to browsers it recognises.
const BROWSER_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const FONT_FILE_PATH = /^\/[a-z]\/[\w./-]+$/;

export interface CatalogFamily {
  category: string;
  family: string;
  /** Weights with an optional "i" suffix for italics, e.g. "400", "700i". */
  variants: string[];
}

let catalogCache: { families: CatalogFamily[]; fetchedAt: number } | null = null;
let catalogRequest: Promise<CatalogFamily[]> | null = null;

function normaliseCategory(category: string) {
  return category.toLowerCase().replace(/[\s_]+/g, "-");
}

// The Developer API names variants "regular", "italic" and "700italic".
function normaliseApiVariant(variant: string) {
  if (variant === "regular")
    return "400";

  if (variant === "italic")
    return "400i";

  return variant.replace("italic", "i");
}

class GoogleFontsError extends Error {
  constructor(readonly status: number) {
    super(`Google Fonts responded with ${status}.`);
  }
}

async function fetchFromGoogle(url: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": BROWSER_USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok)
    throw new GoogleFontsError(response.status);

  return response;
}

async function fetchCatalog(): Promise<CatalogFamily[]> {
  if (env.GOOGLE_FONTS_API_KEY) {
    const response = await fetchFromGoogle(
      `https://www.googleapis.com/webfonts/v1/webfonts?sort=popularity&key=${encodeURIComponent(env.GOOGLE_FONTS_API_KEY)}`,
    );
    const payload = await response.json() as { items: { category: string; family: string; variants: string[] }[] };

    return payload.items.map(item => ({
      category: normaliseCategory(item.category),
      family: item.family,
      variants: item.variants.map(normaliseApiVariant),
    }));
  }

  // Without a key, use the list fonts.google.com itself loads. It is not a
  // documented API, so the official one is preferred whenever a key is set.
  const response = await fetchFromGoogle("https://fonts.google.com/metadata/fonts");
  const text = (await response.text()).replace(/^\)\]\}'\s*/, "");
  const payload = JSON.parse(text) as {
    familyMetadataList: { category: string; family: string; fonts?: Record<string, unknown>; popularity?: number }[];
  };

  return [...payload.familyMetadataList]
    .sort((a, b) => (a.popularity ?? Number.MAX_SAFE_INTEGER) - (b.popularity ?? Number.MAX_SAFE_INTEGER))
    .map(item => ({
      category: normaliseCategory(item.category),
      family: item.family,
      variants: Object.keys(item.fonts ?? {}),
    }));
}

/** The cached catalogue, refreshed daily. Falls back to the last good copy, or null if none. */
export async function getFontCatalog(): Promise<CatalogFamily[] | null> {
  if (catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS)
    return catalogCache.families;

  catalogRequest ??= fetchCatalog().finally(() => {
    catalogRequest = null;
  });

  try {
    const families = await catalogRequest;
    catalogCache = { families, fetchedAt: Date.now() };
    return families;
  }
  catch {
    return catalogCache?.families ?? null;
  }
}

// Ask only for weights the family has: css2 rejects the whole request otherwise.
// The regular face is the available weight closest to 400, plus 600 and 700 for bold text.
function getCssUrl(family: CatalogFamily) {
  const name = encodeURIComponent(family.family).replace(/%20/g, "+");
  const variants = new Set(family.variants);
  const upright = family.variants.filter(variant => /^\d+$/.test(variant)).map(Number);

  if (!upright.length)
    return `${CSS_ORIGIN}/css2?family=${name}&display=swap`;

  const regular = upright.reduce((closest, weight) => Math.abs(weight - 400) < Math.abs(closest - 400) ? weight : closest);
  const weights = [regular, ...[600, 700].filter(weight => weight > regular && upright.includes(weight))];
  const italics = weights.filter(weight => variants.has(`${weight}i`));

  if (!italics.length)
    return `${CSS_ORIGIN}/css2?family=${name}:wght@${weights.join(";")}&display=swap`;

  const tuples = [...weights.map(weight => `0,${weight}`), ...italics.map(weight => `1,${weight}`)];
  return `${CSS_ORIGIN}/css2?family=${name}:ital,wght@${tuples.join(";")}&display=swap`;
}

/**
 * The family's @font-face rules with file URLs pointing at this API, as
 * `/api/fonts/files/...`. Fetched from Google once, then served from the database.
 */
export async function getFamilyCss(familyName: string): Promise<string | null> {
  let stored = await prisma.fontFamily.findUnique({ where: { family: familyName } });

  if (!stored) {
    const catalog = await getFontCatalog();
    const family = catalog?.find(item => item.family === familyName);

    if (!family)
      return null;

    let css: string;

    try {
      css = await (await fetchFromGoogle(getCssUrl(family))).text();
    }
    catch (error) {
      // Google rejects families listed in the catalogue but not served as web fonts.
      if (error instanceof GoogleFontsError && error.status === 400)
        return null;

      throw error;
    }

    const paths = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com(\/[^)\s]+))\)/g)]
      .map(match => match[2]!)
      .filter(path => FONT_FILE_PATH.test(path));

    [stored] = await prisma.$transaction([
      prisma.fontFamily.upsert({
        where: { family: family.family },
        create: { css, family: family.family },
        update: { css },
      }),
      prisma.fontFile.createMany({
        data: paths.map(path => ({ family: family.family, path })),
        skipDuplicates: true,
      }),
    ]);
  }

  return stored.css.replaceAll(FILE_ORIGIN, "/api/fonts/files");
}

// Stop reading as soon as the body passes `limit`, rather than buffering it all first.
async function readCapped(response: Response, limit: number): Promise<Buffer<ArrayBuffer> | null> {
  if (Number(response.headers.get("content-length") ?? 0) > limit) {
    await response.body?.cancel();
    return null;
  }

  const chunks: Uint8Array[] = [];
  let size = 0;

  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;

    if (size > limit) {
      await response.body?.cancel();
      return null;
    }

    chunks.push(chunk);
  }

  const data = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return Buffer.from(data.buffer);
}

/** A font file named in a stored stylesheet, downloaded from Google on first request. */
export async function getFontFile(path: string): Promise<{ contentType: string; data: Buffer } | null> {
  if (!FONT_FILE_PATH.test(path))
    return null;

  const file = await prisma.fontFile.findUnique({ where: { path } });

  if (!file)
    return null;

  if (file.data)
    return { contentType: file.contentType ?? "font/woff2", data: Buffer.from(file.data) };

  const response = await fetchFromGoogle(`${FILE_ORIGIN}${path}`);
  const data = await readCapped(response, MAX_FONT_FILE_BYTES);

  if (!data)
    return null;

  const contentType = response.headers.get("content-type") ?? "font/woff2";
  await prisma.fontFile.update({
    where: { path },
    data: { contentType, data, fetchedAt: new Date() },
  });

  return { contentType, data };
}

export async function getFamiliesOnServer() {
  const families = await prisma.fontFamily.findMany({ select: { family: true }, orderBy: { family: "asc" } });
  return families.map(item => item.family);
}
