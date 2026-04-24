import type { Feed } from "../../../../prisma/generated/client/index.js";

export async function fetchFeed(feed: Feed): Promise<Response> {
  const headers = new Headers();

  if (feed.etag)
    headers.set("If-None-Match", feed.etag);

  if (feed.lastModified)
    headers.set("If-Modified-Since", feed.lastModified);

  return fetch(feed.url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
}
