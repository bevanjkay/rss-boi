import { z } from "zod";

export const pollingIntervalSchema = z.number().int().min(5).max(1440);
export const fetchTimeoutSecondsSchema = z.number().int().min(5).max(60);
export const emailSchema = z.email().trim().toLowerCase();
export const passwordSchema = z.string().min(8).max(128);
export const nullableStringSchema = z.string().trim().min(1).nullable().optional();

export const bootstrapInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  instanceName: z.string().trim().min(1).max(80),
  defaultPollMinutes: pollingIntervalSchema,
});

export const loginInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const changePasswordInputSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
});

export const createSubscriptionInputSchema = z.object({
  url: z.url(),
  displayName: nullableStringSchema,
  overridePollMinutes: pollingIntervalSchema.nullish(),
  overrideFetchTimeoutSeconds: fetchTimeoutSecondsSchema.nullish(),
});

export const updateSubscriptionInputSchema = z.object({
  displayName: nullableStringSchema,
  enabled: z.boolean().optional(),
  overridePollMinutes: pollingIntervalSchema.nullish(),
  overrideFetchTimeoutSeconds: fetchTimeoutSecondsSchema.nullish(),
  url: z.url().optional(),
});

export const subscriptionTransferItemSchema = z.object({
  displayName: z.string().nullable(),
  enabled: z.boolean(),
  overridePollMinutes: z.number().int().nullable(),
  overrideFetchTimeoutSeconds: z.number().int().nullable(),
  url: z.url(),
});

export const subscriptionTransferSchema = z.object({
  exportedAt: z.iso.datetime(),
  subscriptions: z.array(subscriptionTransferItemSchema),
  type: z.literal("rss-boi/subscriptions"),
  version: z.literal(1),
});

export const subscriptionImportResultSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
});

export const entryQuerySchema = z.object({
  feedId: z.string().cuid().optional(),
  status: z.enum(["all", "unread"]).default("all"),
  publishedAfter: z.iso.datetime().optional(),
  publishedBefore: z.iso.datetime().optional(),
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const bulkMarkReadInputSchema = z.object({
  feedId: z.string().cuid().optional(),
});

export const updateSettingsInputSchema = z.object({
  defaultPollMinutes: pollingIntervalSchema,
});

export const setupStatusSchema = z.object({
  setupCompleted: z.boolean(),
});

export const userSchema = z.object({
  id: z.string().cuid(),
  email: z.string(),
  role: z.enum(["ADMIN", "USER"]),
  status: z.enum(["ACTIVE", "DISABLED"]),
  defaultPollMinutes: z.number().int(),
  mustChangePassword: z.boolean(),
});

export const authSessionSchema = z.object({
  user: userSchema.nullable(),
});

export const feedSummarySchema = z.object({
  id: z.string().cuid(),
  url: z.string(),
  title: z.string().nullable(),
  siteUrl: z.string().nullable(),
  description: z.string().nullable(),
  lastFetchedAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  nextFetchAt: z.string().nullable(),
  lastError: z.string().nullable(),
  failureCount: z.number().int(),
});

export const subscriptionSchema = z.object({
  id: z.string().cuid(),
  displayName: z.string().nullable(),
  enabled: z.boolean(),
  overridePollMinutes: z.number().int().nullable(),
  overrideFetchTimeoutSeconds: z.number().int().nullable(),
  effectivePollMinutes: z.number().int(),
  unreadCount: z.number().int(),
  feed: feedSummarySchema,
});

export const feedDebugSchema = z.object({
  subscriptionId: z.string().cuid(),
  feed: feedSummarySchema.extend({
    lastResponseBody: z.string().nullable(),
    lastResponseContentType: z.string().nullable(),
    lastResponseStatus: z.number().int().nullable(),
  }),
});

export const entrySchema = z.object({
  id: z.string().cuid(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  author: z.string().nullable(),
  summary: z.string().nullable(),
  contentHtml: z.string().nullable(),
  publishedAt: z.string().nullable(),
  isRead: z.boolean(),
  feed: z.object({
    id: z.string().cuid(),
    title: z.string().nullable(),
    siteUrl: z.string().nullable(),
  }),
});

export const entryListSchema = z.object({
  entries: z.array(entrySchema),
  nextCursor: z.string().cuid().nullable(),
});

export const settingsSchema = z.object({
  defaultPollMinutes: z.number().int(),
});

export type BootstrapInput = z.infer<typeof bootstrapInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionInputSchema>;
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionInputSchema>;
export type SubscriptionTransferDto = z.infer<typeof subscriptionTransferSchema>;
export type SubscriptionImportResultDto = z.infer<typeof subscriptionImportResultSchema>;
export type EntryQuery = z.infer<typeof entryQuerySchema>;
export type BulkMarkReadInput = z.infer<typeof bulkMarkReadInputSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsInputSchema>;
export type SetupStatus = z.infer<typeof setupStatusSchema>;
export type UserDto = z.infer<typeof userSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type FeedSummary = z.infer<typeof feedSummarySchema>;
export type SubscriptionDto = z.infer<typeof subscriptionSchema>;
export type FeedDebugDto = z.infer<typeof feedDebugSchema>;
export type EntryDto = z.infer<typeof entrySchema>;
export type EntryListDto = z.infer<typeof entryListSchema>;
export type SettingsDto = z.infer<typeof settingsSchema>;
