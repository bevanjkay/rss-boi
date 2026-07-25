import { Buffer } from "node:buffer";
import { lookup } from "node:dns/promises";
import net from "node:net";

// Guards outbound fetches against SSRF. User-supplied feed/image URLs are
// resolved and refused if they point at private, loopback, link-local, or
// otherwise reserved ranges (e.g. the cloud metadata endpoint at
// 169.254.169.254). Redirects are followed manually so every hop is
// re-validated.
//
// Self-hosters often run a feed generator (RSSHub, Miniflux, FreshRSS) on the
// same LAN or compose network, so a NetworkPolicy can carry an explicit
// allowlist of hosts that are exempt from the private-range check. That is
// preferred over allowPrivate, which disables the guard entirely.
//
// Note: DNS is re-resolved by fetch() after this check, leaving a small TOCTOU
// window. That is an accepted trade-off for a self-hosted reader; pinning the
// resolved address would require a custom undici dispatcher.

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

interface HostRule {
  bits?: number | undefined;
  kind: "cidr" | "hostname" | "ip";
  port?: number | undefined;
  value: string;
}

export interface NetworkPolicy {
  allowPrivate: boolean;
  allowedHosts: HostRule[];
}

function parsePort(value: string): number {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`Invalid port in allowed host entry: ${value}`);

  return port;
}

// Accepts: 192.168.86.199 | 192.168.86.199:1200 | 192.168.0.0/16 | rsshub |
// rsshub:1200 | [fd00::1] | [fd00::1]:1200. An entry without a port matches
// any port on that host.
function parseHostRule(raw: string): HostRule {
  const entry = raw.trim();

  if (!entry)
    throw new Error("Empty allowed host entry");

  let host = entry;
  let port: number | undefined;

  if (host.startsWith("[")) {
    const close = host.indexOf("]");

    if (close === -1)
      throw new Error(`Unclosed IPv6 bracket in allowed host entry: ${entry}`);

    const rest = host.slice(close + 1);
    host = host.slice(1, close);

    if (rest.startsWith(":"))
      port = parsePort(rest.slice(1));
    else if (rest)
      throw new Error(`Unexpected text after IPv6 address in allowed host entry: ${entry}`);
  }
  else if ((host.match(/:/g) ?? []).length === 1) {
    const [hostPart, portPart] = host.split(":");
    host = hostPart!;
    port = parsePort(portPart!);
  }

  if (host.includes("/")) {
    const [base, bitsPart] = host.split("/");
    const bits = Number(bitsPart);

    if (net.isIP(base!) !== 4 || !Number.isInteger(bits) || bits < 0 || bits > 32)
      throw new Error(`Only IPv4 CIDR ranges are supported in allowed host entries: ${entry}`);

    return { bits, kind: "cidr", port, value: base! };
  }

  if (net.isIP(host))
    return { kind: "ip", port, value: host.toLowerCase() };

  return { kind: "hostname", port, value: host.toLowerCase() };
}

export function createNetworkPolicy(options: {
  allowPrivate?: boolean;
  allowedHosts?: string | undefined;
}): NetworkPolicy {
  const entries = (options.allowedHosts ?? "")
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);

  return {
    allowPrivate: options.allowPrivate ?? false,
    allowedHosts: entries.map(parseHostRule),
  };
}

function matchesPort(rule: HostRule, port: number): boolean {
  return rule.port === undefined || rule.port === port;
}

function isAllowedHostname(policy: NetworkPolicy, hostname: string, port: number): boolean {
  return policy.allowedHosts.some(rule =>
    rule.kind === "hostname" && rule.value === hostname && matchesPort(rule, port));
}

function isAllowedAddress(policy: NetworkPolicy, address: string, port: number): boolean {
  return policy.allowedHosts.some((rule) => {
    if (!matchesPort(rule, port))
      return false;

    if (rule.kind === "ip")
      return rule.value === address.toLowerCase();

    if (rule.kind === "cidr")
      return net.isIP(address) === 4 && inCidr4(address, rule.value, rule.bits!);

    return false;
  });
}

function getPort(url: URL): number {
  if (url.port)
    return Number(url.port);

  return url.protocol === "https:" ? 443 : 80;
}

export async function assertPublicUrl(rawUrl: string, policy: NetworkPolicy): Promise<void> {
  const url = new URL(rawUrl);

  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`Unsupported protocol: ${url.protocol}`);

  if (policy.allowPrivate)
    return;

  const port = getPort(url);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  // An explicitly allowlisted hostname (e.g. a compose service name) skips the
  // address check: the operator has vouched for that name.
  if (isAllowedHostname(policy, hostname, port))
    return;

  const addresses = net.isIP(hostname)
    ? [hostname]
    : (await lookup(hostname, { all: true })).map(entry => entry.address);

  if (!addresses.length)
    throw new Error(`Could not resolve host: ${hostname}`);

  for (const address of addresses) {
    if (!isBlockedAddress(address))
      continue;

    if (isAllowedAddress(policy, address, port))
      continue;

    throw new Error(`Refusing to fetch private or reserved address: ${address}`);
  }
}

export interface SafeFetchOptions {
  maxRedirects?: number;
  policy: NetworkPolicy;
}

export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: SafeFetchOptions,
): Promise<Response> {
  const { maxRedirects = 5, policy } = options;
  let currentUrl = rawUrl;

  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    await assertPublicUrl(currentUrl, policy);

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
