import { Buffer } from "node:buffer";
import { lookup } from "node:dns/promises";
import net from "node:net";

// Guards outbound fetches against SSRF. User-supplied URLs are resolved and
// refused if they point at private, loopback, link-local, or otherwise
// reserved ranges (e.g. the cloud metadata endpoint at 169.254.169.254).
// Redirects are followed manually so every hop is re-validated. Set
// allowPrivate to opt out when self-hosting against internal hosts.
//
// Note: DNS is re-resolved by fetch() after this check, leaving a small TOCTOU
// window. That is an accepted trade-off for a self-hosted reader; pinning the
// resolved address would require a custom undici dispatcher.
//
// Kept in sync with apps/worker/src/poller/ssrf.ts (node:dns cannot live in the
// browser-consumed shared package).

const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function ipv4ToLong(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inCidr4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  return (ipv4ToLong(ip) & mask) === (ipv4ToLong(base) & mask);
}

function isBlockedIpv4(ip: string): boolean {
  return BLOCKED_V4.some(([base, bits]) => inCidr4(ip, base, bits));
}

function isBlockedIpv6(ip: string): boolean {
  const address = ip.toLowerCase();

  if (address === "::1" || address === "::")
    return true;

  const mappedV4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address)?.[1];
  if (mappedV4)
    return isBlockedIpv4(mappedV4);

  const firstGroup = address.startsWith("::")
    ? 0
    : Number.parseInt(address.split(":")[0] || "0", 16);

  // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast
  return (firstGroup & 0xFE00) === 0xFC00
    || (firstGroup & 0xFFC0) === 0xFE80
    || (firstGroup & 0xFF00) === 0xFF00;
}

function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);

  if (family === 4)
    return isBlockedIpv4(ip);

  if (family === 6)
    return isBlockedIpv6(ip);

  return true;
}

export async function assertPublicUrl(rawUrl: string, allowPrivate = false): Promise<void> {
  const url = new URL(rawUrl);

  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`Unsupported protocol: ${url.protocol}`);

  if (allowPrivate)
    return;

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(hostname)
    ? [hostname]
    : (await lookup(hostname, { all: true })).map(entry => entry.address);

  if (!addresses.length)
    throw new Error(`Could not resolve host: ${hostname}`);

  for (const address of addresses) {
    if (isBlockedAddress(address))
      throw new Error(`Refusing to fetch private or reserved address: ${address}`);
  }
}

export interface SafeFetchOptions {
  allowPrivate?: boolean;
  maxRedirects?: number;
}

export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const { allowPrivate = false, maxRedirects = 5 } = options;
  let currentUrl = rawUrl;

  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    await assertPublicUrl(currentUrl, allowPrivate);

    const response = await fetch(currentUrl, { ...init, redirect: "manual" });

    if (!REDIRECT_STATUSES.has(response.status))
      return response;

    const location = response.headers.get("location");
    if (!location)
      return response;

    await response.body?.cancel();
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error("Too many redirects");
}

export async function readBytesWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new Error(`Response too large: ${declared} bytes`);

  const reader = response.body?.getReader();
  if (!reader)
    return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done)
      break;

    if (value) {
      total += value.byteLength;

      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeded ${maxBytes} bytes`);
      }

      chunks.push(Buffer.from(value));
    }
  }

  return Buffer.concat(chunks);
}
