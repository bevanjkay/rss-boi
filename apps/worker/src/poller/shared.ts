import { createHash } from "node:crypto";

export function computeGuidHash(...parts: Array<string | null | undefined>): string {
  const value = parts.find(part => part && part.trim()) ?? crypto.randomUUID();
  return createHash("sha256").update(value).digest("hex");
}

export function sanitizeUrl(input: string): string {
  const url = new URL(input.trim());

  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Unsupported protocol");

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  if (url.pathname === "/")
    url.pathname = "";

  return url.toString();
}
