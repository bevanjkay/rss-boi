import type {
  AuthSession,
  EntryDto,
  EntryListDto,
  FeedDebugDto,
  SettingsDto,
  SetupStatus,
  SubscriptionDto,
  SubscriptionImportResultDto,
  SubscriptionTransferDto,
} from "@rss-boi/shared";

declare global {
  interface Window {
    __RSS_BOI_CONFIG__?: { apiBaseUrl?: string };
  }
}

const API_BASE_URL = window.__RSS_BOI_CONFIG__?.apiBaseUrl
  ?? import.meta.env.VITE_API_BASE_URL
  ?? "http://localhost:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers,
    ...init,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: "Request failed." }));
    throw new Error(payload.message ?? "Request failed.");
  }

  if (response.status === 204)
    return undefined as T;

  return response.json() as Promise<T>;
}

export const api = {
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/api/auth/change-password", {
      body: JSON.stringify({ currentPassword, newPassword }),
      method: "POST",
    }),
  createSubscription: (payload: {
    displayName?: string | null;
    includeInAggregateViews?: boolean;
    overrideFetchTimeoutSeconds?: number | null;
    overridePollMinutes?: number | null;
    url: string;
  }) =>
    request<SubscriptionDto>("/api/subscriptions", {
      body: JSON.stringify(payload),
      method: "POST",
    }),
  deleteSubscription: (id: string) =>
    request<void>(`/api/subscriptions/${id}`, {
      method: "DELETE",
    }),
  getEntry: (id: string) => request<EntryDto>(`/api/entries/${id}`),
  exportSubscriptions: () => request<SubscriptionTransferDto>("/api/subscriptions/export"),
  getEntries: (params: {
    feedId?: string;
    publishedAfter?: string;
    publishedBefore?: string;
    status?: "all" | "unread";
  }) => {
    const search = new URLSearchParams();

    if (params.feedId)
      search.set("feedId", params.feedId);

    if (params.publishedAfter)
      search.set("publishedAfter", params.publishedAfter);

    if (params.publishedBefore)
      search.set("publishedBefore", params.publishedBefore);

    if (params.status)
      search.set("status", params.status);

    return request<EntryListDto>(`/api/entries?${search.toString()}`);
  },
  getMe: () => request<AuthSession>("/api/auth/me"),
  getSettings: () => request<SettingsDto>("/api/settings/me"),
  getSetupStatus: () => request<SetupStatus>("/api/setup/status"),
  getSubscriptionDebug: (id: string) => request<FeedDebugDto>(`/api/subscriptions/${id}/debug`),
  getSubscriptions: () => request<SubscriptionDto[]>("/api/subscriptions"),
  importSubscriptions: (payload: SubscriptionTransferDto) =>
    request<SubscriptionImportResultDto>("/api/subscriptions/import", {
      body: JSON.stringify(payload),
      method: "POST",
    }),
  login: (email: string, password: string) =>
    request<AuthSession>("/api/auth/login", {
      body: JSON.stringify({ email, password }),
      method: "POST",
    }),
  logout: () =>
    request<void>("/api/auth/logout", {
      method: "POST",
    }),
  markAllRead: (params: { feedId?: string } = {}) =>
    request<void>("/api/entries/read", {
      body: JSON.stringify(params),
      method: "POST",
    }),
  markRead: (id: string) =>
    request<void>(`/api/entries/${id}/read`, {
      method: "POST",
    }),
  markUnread: (id: string) =>
    request<void>(`/api/entries/${id}/unread`, {
      method: "POST",
    }),
  refreshSubscription: (id: string) =>
    request<{ message: string }>(`/api/subscriptions/${id}/refresh`, {
      method: "POST",
    }),
  setup: (payload: {
    defaultPollMinutes: number;
    email: string;
    instanceName: string;
    password: string;
  }) =>
    request<AuthSession>("/api/setup/bootstrap", {
      body: JSON.stringify(payload),
      method: "POST",
    }),
  updateSettings: (defaultPollMinutes: number) =>
    request<SettingsDto>("/api/settings/me", {
      body: JSON.stringify({ defaultPollMinutes }),
      method: "PATCH",
    }),
  updateSubscription: (
    id: string,
    payload: {
      displayName?: string | null;
      enabled?: boolean;
      includeInAggregateViews?: boolean;
      overrideFetchTimeoutSeconds?: number | null;
      overridePollMinutes?: number | null;
      url?: string;
    },
  ) =>
    request<SubscriptionDto>(`/api/subscriptions/${id}`, {
      body: JSON.stringify(payload),
      method: "PATCH",
    }),
};
