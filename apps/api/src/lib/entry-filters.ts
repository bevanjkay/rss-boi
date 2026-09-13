import type { Prisma } from "../db/client.js";

// An entry is unread for a user when they have no state row for it, or the
// state row is explicitly unread.
export function getUnreadStateFilter(userId: string): Prisma.EntryWhereInput {
  return {
    OR: [
      {
        entryStates: {
          none: {
            userId,
          },
        },
      },
      {
        entryStates: {
          some: {
            userId,
            isRead: false,
          },
        },
      },
    ],
  };
}
