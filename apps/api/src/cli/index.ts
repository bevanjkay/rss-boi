import process from "node:process";
import { prisma } from "../db/client.js";
import { hashPassword } from "../lib/crypto.js";

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function createUser() {
  const email = getFlag("--email");
  const password = getFlag("--password");
  const defaultPollMinutes = Number(getFlag("--default-poll") ?? "30");
  const role = getFlag("--role") === "admin" ? "ADMIN" : "USER";

  if (!email || !password)
    throw new Error("Usage: users:create --email <email> --password <password> [--default-poll <minutes>] [--role admin]");

  const user = await prisma.user.create({
    data: {
      email: email.trim().toLowerCase(),
      passwordHash: await hashPassword(password),
      role,
      defaultPollMinutes,
    },
  });

  console.log(`Created user ${user.email} (${user.role}).`);
}

async function disableUser() {
  const email = getFlag("--email");

  if (!email)
    throw new Error("Usage: users:disable --email <email>");

  await prisma.user.update({
    where: {
      email: email.trim().toLowerCase(),
    },
    data: {
      status: "DISABLED",
    },
  });

  console.log(`Disabled user ${email}.`);
}

async function resetPassword() {
  const email = getFlag("--email");
  const password = getFlag("--password");

  if (!email || !password)
    throw new Error("Usage: users:reset-password --email <email> --password <password>");

  await prisma.user.update({
    where: {
      email: email.trim().toLowerCase(),
    },
    data: {
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
      status: "ACTIVE",
    },
  });

  console.log(`Reset password for ${email}.`);
}

const command = process.argv[2];

try {
  if (command === "users:create")
    await createUser();
  else if (command === "users:disable")
    await disableUser();
  else if (command === "users:reset-password")
    await resetPassword();
  else
    throw new Error("Unknown command.");
}
catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
finally {
  await prisma.$disconnect();
}
