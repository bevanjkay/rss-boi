import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db/client.js";
import { createSessionToken, hashSessionToken } from "./crypto.js";
import { serializeUser } from "./serializers.js";

const SESSION_COOKIE = "rss_boi_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function sessionCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: isProduction,
  };
}

export async function attachUserFromSession(request: FastifyRequest): Promise<void> {
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
}

export async function createUserSession(reply: FastifyReply, userId: string, isProduction: boolean): Promise<void> {
  const token = createSessionToken();

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(isProduction));
}

export async function destroyUserSession(request: FastifyRequest, reply: FastifyReply, isProduction: boolean): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];

  if (token) {
    await prisma.session.deleteMany({
      where: {
        tokenHash: hashSessionToken(token),
      },
    });
  }

  reply.clearCookie(SESSION_COOKIE, sessionCookieOptions(isProduction));
}
