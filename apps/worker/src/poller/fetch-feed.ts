import type { Feed } from "../../../../prisma/generated/client/index.js";

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export async function fetchFeed(feed: Feed, timeoutSeconds?: number): Promise<Response> {
  const headers = new Headers();

  if (feed.etag)
    headers.set("If-None-Match", feed.etag);

  if (feed.lastModified)
    headers.set("If-Modified-Since", feed.lastModified);

  const timeoutMs = timeoutSeconds
    ? timeoutSeconds * 1_000
    : DEFAULT_FETCH_TIMEOUT_MS;

  return fetch(feed.url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
}
