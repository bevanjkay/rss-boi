import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { createSessionToken, hashSessionToken } from "./crypto.js";
import { serializeUser } from "./serializers.js";

const SESSION_COOKIE = "rss_boi_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
const SESSION_REFRESH_THRESHOLD_MS = SESSION_TTL_MS / 2;

function sessionCookieOptions(baseUrl: string) {
  return {
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: baseUrl.startsWith("https:"),
  };
}

export async function attachUserFromSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];

  if (!token) {
    request.user = null;
    return;
  }

  const session = await prisma.session.findUnique({
    where: {
      tokenHash: hashSessionToken(token),
    },
    include: {
      user: true,
    },
  });

  if (!session || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
    request.user = null;
    return;
  }

  request.user = serializeUser(session.user);

  const remainingMs = session.expiresAt.getTime() - Date.now();
  if (remainingMs < SESSION_REFRESH_THRESHOLD_MS) {
    const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: newExpiresAt },
    });
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(env.APP_BASE_URL));
  }
}

export async function createUserSession(reply: FastifyReply, userId: string, baseUrl: string): Promise<void> {
  const token = createSessionToken();

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(baseUrl));
}

export async function destroyUserSession(request: FastifyRequest, reply: FastifyReply, baseUrl: string): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];

  if (token) {
    await prisma.session.deleteMany({
      where: {
        tokenHash: hashSessionToken(token),
      },
    });
  }

  reply.clearCookie(SESSION_COOKIE, sessionCookieOptions(baseUrl));
}
