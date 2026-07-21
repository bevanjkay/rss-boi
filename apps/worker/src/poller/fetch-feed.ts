import type { Feed } from "../../../../prisma/generated/client/index.js";
import { readBytesWithLimit, safeFetch } from "./ssrf.js";

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 10_000_000;

export async function fetchFeed(feed: Feed, timeoutSeconds: number | undefined, allowPrivate = false): Promise<Response> {
  const headers = new Headers();

  if (feed.etag)
    headers.set("If-None-Match", feed.etag);

  if (feed.lastModified)
    headers.set("If-Modified-Since", feed.lastModified);

  const timeoutMs = timeoutSeconds
    ? timeoutSeconds * 1_000
    : DEFAULT_FETCH_TIMEOUT_MS;

  return safeFetch(feed.url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  }, { allowPrivate });
}

export async function readFeedBody(response: Response): Promise<string> {
  const bytes = await readBytesWithLimit(response, MAX_FEED_BYTES);
  return bytes.toString("utf8");
}
