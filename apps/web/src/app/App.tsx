import type { EntryDto, FeedDebugDto, SubscriptionDto } from "@rss-boi/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";

function formatDate(value: string | null) {
  if (!value)
    return "Not published";

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatLastFetched(value: string | null) {
  if (!value)
    return "Never fetched";

  return `Last fetched ${formatDate(value)}`;
}

function formatNextFetch(value: string | null) {
  if (!value)
    return "Not scheduled";

  return `Next fetch ${formatDate(value)}`;
}

function getEntryLabel(entry: EntryDto) {
  return entry.title ?? entry.url ?? "Untitled entry";
}

function getFeedHealth(subscription: SubscriptionDto) {
  if (subscription.feed.lastError && subscription.feed.failureCount > 0) {
    return {
      detail: subscription.feed.lastError,
      label: "Failing",
      tone: "is-error",
    };
  }

  if (subscription.feed.nextFetchAt && new Date(subscription.feed.nextFetchAt).getTime() <= Date.now() + 5000) {
    return {
      detail: "Queued for the worker",
      label: "Queued",
      tone: "is-queued",
    };
  }

  if (subscription.feed.lastSuccessAt) {
    return {
      detail: formatLastFetched(subscription.feed.lastSuccessAt),
      label: "Healthy",
      tone: "is-healthy",
    };
  }

  return {
    detail: "Waiting for first successful fetch",
    label: "Pending",
    tone: "is-pending",
  };
}

function getFeedLabel(subscription: SubscriptionDto) {
  return subscription.displayName ?? subscription.feed.title ?? subscription.feed.url;
}

function EmptyState({
  body,
  title,
}: {
  body: string;
  title: string;
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function DebugPanel({
  debug,
  error,
  isLoading,
}: {
  debug: FeedDebugDto | undefined;
  error: string | null;
  isLoading: boolean;
}) {
  return (
    <section className="panel debug-panel">
      <div className="panel-toolbar">
        <strong>Debug</strong>
      </div>
      {isLoading
        ? <p>Loading feed debug information...</p>
        : error
          ? <p className="form-error">{error}</p>
          : debug
            ? (
                <div className="debug-grid">
                  <div className="debug-meta">
                    <span>
                      Status code:
                      {" "}
                      {debug.feed.lastResponseStatus ?? "No response stored"}
                    </span>
                    <span>
                      Content-Type:
                      {" "}
                      {debug.feed.lastResponseContentType ?? "Unknown"}
                    </span>
                    <span>{formatLastFetched(debug.feed.lastFetchedAt)}</span>
                    <span>{formatNextFetch(debug.feed.nextFetchAt)}</span>
                    <span>
                      Failure count:
                      {" "}
                      {debug.feed.failureCount}
                    </span>
                    {debug.feed.lastError
                      ? (
                          <span>
                            Last error:
                            {" "}
                            {debug.feed.lastError}
                          </span>
                        )
                      : null}
                  </div>
                  <pre className="debug-body">{debug.feed.lastResponseBody ?? "No stored response body yet."}</pre>
                </div>
              )
            : <p>No debug data available.</p>}
    </section>
  );
}

function AppShell({
  children,
  onLogout,
  subscriptions,
}: {
  children: React.ReactNode;
  onLogout: () => void;
  subscriptions: SubscriptionDto[];
}) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand-block">
          <h1>RSS Boi</h1>
          <p>Private feed reading with shared fetches and separate accounts.</p>
        </div>

        <nav className="sidebar-nav">
          <NavLink className="sidebar-link" to="/">All entries</NavLink>
          <NavLink className="sidebar-link" to="/unread">Unread</NavLink>
        </nav>

        <section className="sidebar-section">
          <h2>Subscriptions</h2>
          <div className="sidebar-feed-list">
            {subscriptions.length
              ? subscriptions.map(subscription => (
                  <NavLink
                    key={subscription.id}
                    className="sidebar-feed-link"
                    to={`/feeds/${subscription.feed.id}`}
                  >
                    <span>{getFeedLabel(subscription)}</span>
                    <span className="sidebar-feed-meta">{subscription.unreadCount}</span>
                  </NavLink>
                ))
              : (
                  <p className="sidebar-note">No feeds yet.</p>
                )}
          </div>
        </section>

        <nav className="sidebar-nav sidebar-nav--secondary">
          <NavLink className="sidebar-link" to="/feeds">Feeds</NavLink>
          <NavLink className="sidebar-link" to="/settings">Settings</NavLink>
        </nav>

        <button className="button button-secondary sidebar-logout" onClick={onLogout} type="button">
          Log out
        </button>
      </aside>

      <main className="app-content">{children}</main>
    </div>
  );
}

function PageHeader({
  description,
  title,
}: {
  description?: string;
  title: string;
}) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </header>
  );
}

function ReaderView({
  debugPanel,
  entries,
  feedHealth,
  feedLastFetchedAt,
  feedName,
  mode,
  onToggleDebug,
  onRefresh,
  refreshLabel,
  onSelect,
  onToggleRead,
  selectedId,
  showDebug,
}: {
  debugPanel?: React.ReactNode;
  entries: EntryDto[];
  feedHealth: ReturnType<typeof getFeedHealth> | undefined;
  feedLastFetchedAt: string | null | undefined;
  feedName: string | undefined;
  mode: "all" | "unread";
  onToggleDebug?: (() => void) | undefined;
  onRefresh?: (() => void) | undefined;
  refreshLabel?: string | undefined;
  onSelect: (entryId: string) => void;
  onToggleRead: (entry: EntryDto) => void;
  selectedId: string | null;
  showDebug?: boolean;
}) {
  const selectedEntry = entries.find(entry => entry.id === selectedId) ?? entries[0] ?? null;
  const title = feedName ?? (mode === "unread" ? "Unread" : "All entries");
  const description = feedName
    ? `${formatLastFetched(feedLastFetchedAt ?? null)}. ${feedHealth?.detail ?? formatNextFetch(null)}.`
    : mode === "unread"
      ? "Only unread items from your active subscriptions."
      : "Recent items across your active subscriptions.";

  return (
    <section className="page-layout">
      <div className="page-header page-header--with-actions">
        <PageHeader description={description} title={title} />
        {onRefresh
          ? (
              <div className="page-header__actions">
                {feedHealth
                  ? (
                      <span className={`status-chip ${feedHealth.tone}`}>
                        {feedHealth.label}
                      </span>
                    )
                  : null}
                <button className="button button-secondary" onClick={onRefresh} type="button">
                  {refreshLabel ?? "Refresh now"}
                </button>
                {onToggleDebug
                  ? (
                      <button className="button button-secondary" onClick={onToggleDebug} type="button">
                        {showDebug ? "Hide debug" : "Show debug"}
                      </button>
                    )
                  : null}
              </div>
            )
          : null}
      </div>

      <div className="reader-layout">
        <section className="panel list-panel">
          <div className="panel-toolbar">
            <strong>
              {entries.length}
              {" "}
              items
            </strong>
          </div>

          {entries.length
            ? (
                <div className="entry-list">
                  {entries.map(entry => (
                    <button
                      key={entry.id}
                      className={`entry-row ${selectedEntry?.id === entry.id ? "is-selected" : ""}`}
                      onClick={() => onSelect(entry.id)}
                      type="button"
                    >
                      <div className="entry-row__top">
                        <span>{entry.feed.title ?? "Untitled feed"}</span>
                        <time>{formatDate(entry.publishedAt)}</time>
                      </div>
                      <h3>{getEntryLabel(entry)}</h3>
                      <p>{entry.summary ?? "No summary available."}</p>
                      <span className={`entry-status ${entry.isRead ? "is-read" : "is-unread"}`}>
                        {entry.isRead ? "Read" : "Unread"}
                      </span>
                    </button>
                  ))}
                </div>
              )
            : (
                <EmptyState
                  body="Add a feed or wait for the worker to pull in entries."
                  title="No entries yet"
                />
              )}
        </section>

        <article className="panel detail-panel">
          {selectedEntry
            ? (
                <>
                  <div className="detail-header">
                    <div>
                      <div className="detail-meta">
                        <span>{selectedEntry.feed.title ?? "Untitled feed"}</span>
                        <span>{formatDate(selectedEntry.publishedAt)}</span>
                      </div>
                      <h2>{getEntryLabel(selectedEntry)}</h2>
                    </div>

                    <div className="detail-actions">
                      <button className="button button-secondary" onClick={() => onToggleRead(selectedEntry)} type="button">
                        Mark
                        {" "}
                        {selectedEntry.isRead ? "unread" : "read"}
                      </button>
                      {selectedEntry.url
                        ? (
                            <a className="button button-primary" href={selectedEntry.url} rel="noreferrer" target="_blank">
                              Open source
                            </a>
                          )
                        : null}
                    </div>
                  </div>

                  <div
                    className="detail-content"
                    dangerouslySetInnerHTML={{ __html: selectedEntry.contentHtml ?? `<p>${selectedEntry.summary ?? "No article content was captured for this entry."}</p>` }}
                  />
                </>
              )
            : (
                <EmptyState
                  body="Pick an item from the list to read it."
                  title="Nothing selected"
                />
              )}
        </article>
      </div>

      {debugPanel}
    </section>
  );
}

function AuthCard({
  action,
  children,
  description,
  title,
}: {
  action: string;
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="auth-layout">
      <div className="auth-card">
        <div className="auth-card__header">
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {children}
        <div className="auth-card__footer">{action}</div>
      </div>
    </section>
  );
}

function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const loginMutation = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session"] }),
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
      ]);
      navigate("/");
    },
  });

  return (
    <AuthCard
      action="Sign in to continue."
      description="Use the account created during setup or provisioned through the admin CLI."
      title="Sign in"
    >
      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          loginMutation.mutate();
        }}
      >
        <label>
          <span>Email</span>
          <input onChange={event => setEmail(event.target.value)} type="email" value={email} />
        </label>
        <label>
          <span>Password</span>
          <input onChange={event => setPassword(event.target.value)} type="password" value={password} />
        </label>
        {loginMutation.error ? <p className="form-error">{loginMutation.error.message}</p> : null}
        <button className="button button-primary" disabled={loginMutation.isPending} type="submit">
          {loginMutation.isPending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </AuthCard>
  );
}

function SetupPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [instanceName, setInstanceName] = useState("RSS Boi");
  const [defaultPollMinutes, setDefaultPollMinutes] = useState(30);
  const setupMutation = useMutation({
    mutationFn: () => api.setup({ defaultPollMinutes, email, instanceName, password }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["setup-status"] });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/");
    },
  });

  return (
    <AuthCard
      action="This page is only available before the first account is created."
      description="Create the initial admin account and set the default polling interval."
      title="Set up the instance"
    >
      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          setupMutation.mutate();
        }}
      >
        <label>
          <span>Instance name</span>
          <input onChange={event => setInstanceName(event.target.value)} value={instanceName} />
        </label>
        <label>
          <span>Admin email</span>
          <input onChange={event => setEmail(event.target.value)} type="email" value={email} />
        </label>
        <label>
          <span>Password</span>
          <input onChange={event => setPassword(event.target.value)} type="password" value={password} />
        </label>
        <label>
          <span>Default polling interval (minutes)</span>
          <input
            min={5}
            onChange={event => setDefaultPollMinutes(Number(event.target.value))}
            type="number"
            value={defaultPollMinutes}
          />
        </label>
        {setupMutation.error ? <p className="form-error">{setupMutation.error.message}</p> : null}
        <button className="button button-primary" disabled={setupMutation.isPending} type="submit">
          {setupMutation.isPending ? "Creating..." : "Create admin account"}
        </button>
      </form>
    </AuthCard>
  );
}

function FeedsPage() {
  const queryClient = useQueryClient();
  const { data: subscriptions = [] } = useQuery({
    queryFn: api.getSubscriptions,
    queryKey: ["subscriptions"],
  });
  const [url, setUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [overridePollMinutes, setOverridePollMinutes] = useState<number | "">("");

  const createMutation = useMutation({
    mutationFn: () => api.createSubscription({
      displayName: displayName || null,
      overridePollMinutes: overridePollMinutes === "" ? null : overridePollMinutes,
      url,
    }),
    onSuccess: async () => {
      setUrl("");
      setDisplayName("");
      setOverridePollMinutes("");
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      await queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteSubscription(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      await queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: (id: string) => api.refreshSubscription(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      await queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });
  const updateMutation = useMutation({
    mutationFn: (id: string) => api.updateSubscription(id, {
      displayName: displayName || null,
      overridePollMinutes: overridePollMinutes === "" ? null : overridePollMinutes,
      url,
    }),
    onSuccess: async () => {
      setEditingId(null);
      setUrl("");
      setDisplayName("");
      setOverridePollMinutes("");
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      await queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });
  const activeMutation = editingId ? updateMutation : createMutation;

  return (
    <section className="page-layout">
      <PageHeader
        description="Subscriptions are shared at the fetch layer, but each account keeps its own list and read state."
        title="Feeds"
      />

      <section className="panel section-panel">
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (editingId)
              updateMutation.mutate(editingId);
            else
              createMutation.mutate();
          }}
        >
          <div className="form-grid form-grid--feeds">
            <label>
              <span>Feed URL</span>
              <input onChange={event => setUrl(event.target.value)} placeholder="https://example.com/feed.xml" value={url} />
            </label>
            <label>
              <span>Display name</span>
              <input onChange={event => setDisplayName(event.target.value)} placeholder="Optional" value={displayName} />
            </label>
            <label>
              <span>Override interval (minutes)</span>
              <input
                min={5}
                onChange={event => setOverridePollMinutes(event.target.value ? Number(event.target.value) : "")}
                placeholder="Use account default"
                type="number"
                value={overridePollMinutes}
              />
            </label>
          </div>
          {activeMutation.error ? <p className="form-error">{activeMutation.error.message}</p> : null}
          <div className="section-actions">
            <button className="button button-primary" disabled={activeMutation.isPending} type="submit">
              {editingId ? "Save changes" : "Add feed"}
            </button>
            {editingId
              ? (
                  <button
                    className="button button-secondary"
                    onClick={() => {
                      setEditingId(null);
                      setUrl("");
                      setDisplayName("");
                      setOverridePollMinutes("");
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                )
              : null}
          </div>
        </form>
      </section>

      <section className="panel section-panel">
        <div className="table-shell">
          <div className="table-header">
            <span>Feed</span>
            <span>Interval</span>
            <span>Actions</span>
          </div>

          {subscriptions.length
            ? subscriptions.map(subscription => (
                <div className="table-row" key={subscription.id}>
                  <div className="table-cell table-cell--feed">
                    <strong>{getFeedLabel(subscription)}</strong>
                    <span>{subscription.feed.url}</span>
                    <span>{formatLastFetched(subscription.feed.lastFetchedAt)}</span>
                    <div className="feed-status-line">
                      <span className={`status-chip ${getFeedHealth(subscription).tone}`}>
                        {getFeedHealth(subscription).label}
                      </span>
                      <span>{getFeedHealth(subscription).detail}</span>
                      <span>{formatNextFetch(subscription.feed.nextFetchAt)}</span>
                    </div>
                  </div>
                  <div className="table-cell">
                    <span>
                      {subscription.effectivePollMinutes}
                      {" "}
                      minutes
                    </span>
                  </div>
                  <div className="table-cell table-cell--actions">
                    <button
                      className="button button-secondary"
                      onClick={() => {
                        setEditingId(subscription.id);
                        setUrl(subscription.feed.url);
                        setDisplayName(subscription.displayName ?? "");
                        setOverridePollMinutes(subscription.overridePollMinutes ?? "");
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={refreshMutation.isPending}
                      onClick={() => refreshMutation.mutate(subscription.id)}
                      type="button"
                    >
                      {refreshMutation.isPending && refreshMutation.variables === subscription.id ? "Queued..." : "Refresh now"}
                    </button>
                    <button
                      className="button button-ghost"
                      onClick={() => {
                        // eslint-disable-next-line no-alert
                        if (window.confirm(`Remove ${getFeedLabel(subscription)} from your subscriptions?`))
                          deleteMutation.mutate(subscription.id);
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            : (
                <EmptyState
                  body="Add a feed URL to start collecting entries."
                  title="No subscriptions"
                />
              )}
        </div>
      </section>
    </section>
  );
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryFn: api.getSettings,
    queryKey: ["settings"],
  });
  const [defaultPollMinutes, setDefaultPollMinutes] = useState(data?.defaultPollMinutes ?? 30);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const settingsMutation = useMutation({
    mutationFn: () => api.updateSettings(defaultPollMinutes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: () => api.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
    },
  });

  return (
    <section className="page-layout">
      <PageHeader title="Settings" />

      <div className="settings-grid">
        <section className="panel section-panel">
          <h2>Polling</h2>
          <form
            className="stack-form"
            onSubmit={(event) => {
              event.preventDefault();
              settingsMutation.mutate();
            }}
          >
            <label>
              <span>Default polling interval (minutes)</span>
              <input
                min={5}
                onChange={event => setDefaultPollMinutes(Number(event.target.value))}
                type="number"
                value={defaultPollMinutes}
              />
            </label>
            <div className="section-actions">
              <button className="button button-primary" disabled={settingsMutation.isPending} type="submit">
                Save
              </button>
            </div>
          </form>
        </section>

        <section className="panel section-panel">
          <h2>Password</h2>
          <form
            className="stack-form"
            onSubmit={(event) => {
              event.preventDefault();
              passwordMutation.mutate();
            }}
          >
            <label>
              <span>Current password</span>
              <input onChange={event => setCurrentPassword(event.target.value)} type="password" value={currentPassword} />
            </label>
            <label>
              <span>New password</span>
              <input onChange={event => setNewPassword(event.target.value)} type="password" value={newPassword} />
            </label>
            <div className="section-actions">
              <button className="button button-primary" disabled={passwordMutation.isPending} type="submit">
                Change password
              </button>
            </div>
          </form>
        </section>
      </div>
    </section>
  );
}

function FeedRoute({ subscriptions }: { subscriptions: SubscriptionDto[] }) {
  const { feedId } = useParams();
  const subscription = subscriptions.find(item => item.feed.id === feedId);

  return (
    <ReaderRoute
      feedId={feedId}
      feedHealth={subscription ? getFeedHealth(subscription) : undefined}
      feedLastFetchedAt={subscription?.feed.lastFetchedAt}
      feedName={subscription ? getFeedLabel(subscription) : undefined}
      mode="all"
      subscription={subscription}
    />
  );
}

function ReaderRoute({
  feedId,
  feedHealth,
  feedLastFetchedAt,
  feedName,
  mode,
  subscription,
}: {
  feedId: string | undefined;
  feedHealth: ReturnType<typeof getFeedHealth> | undefined;
  feedLastFetchedAt: string | null | undefined;
  feedName: string | undefined;
  mode: "all" | "unread";
  subscription?: SubscriptionDto | undefined;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const { data } = useQuery({
    queryFn: () => api.getEntries(feedId ? { feedId, status: mode } : { status: mode }),
    queryKey: ["entries", { feedId, mode }],
  });
  const entries = data?.entries ?? [];
  const selectedEntry = entries.find(entry => entry.id === selectedId) ?? entries[0] ?? null;
  const debugQuery = useQuery({
    enabled: debugOpen && !!subscription,
    queryFn: () => api.getSubscriptionDebug(subscription!.id),
    queryKey: ["subscription-debug", subscription?.id],
  });

  const toggleReadMutation = useMutation({
    mutationFn: (entry: EntryDto) => entry.isRead ? api.markUnread(entry.id) : api.markRead(entry.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      await queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });
  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.markRead(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      await queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });
  const refreshMutation = useMutation({
    mutationFn: (id: string) => api.refreshSubscription(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      await queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });

  useEffect(() => {
    if (!selectedEntry || selectedEntry.isRead)
      return;

    if (markReadMutation.isPending && markReadMutation.variables === selectedEntry.id)
      return;

    markReadMutation.mutate(selectedEntry.id);
  }, [markReadMutation, selectedEntry]);

  return (
    <ReaderView
      debugPanel={debugOpen
        ? (
            <DebugPanel
              debug={debugQuery.data}
              error={debugQuery.error instanceof Error ? debugQuery.error.message : null}
              isLoading={debugQuery.isLoading}
            />
          )
        : undefined}
      entries={entries}
      feedHealth={feedHealth}
      feedLastFetchedAt={feedLastFetchedAt}
      feedName={feedName}
      mode={mode}
      onRefresh={subscription ? () => refreshMutation.mutate(subscription.id) : undefined}
      onToggleDebug={subscription ? () => setDebugOpen(value => !value) : undefined}
      onSelect={setSelectedId}
      onToggleRead={entry => toggleReadMutation.mutate(entry)}
      showDebug={debugOpen}
      refreshLabel={refreshMutation.isPending ? "Queued..." : "Refresh now"}
      selectedId={selectedId}
    />
  );
}

function AuthenticatedApp() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const { data: subscriptions = [] } = useQuery({
    queryFn: api.getSubscriptions,
    queryKey: ["subscriptions"],
  });

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/login");
    },
  });

  const selectedFeedId = useMemo(() => {
    if (!pathname.startsWith("/feeds/"))
      return null;

    return pathname.replace("/feeds/", "");
  }, [pathname]);

  return (
    <AppShell
      onLogout={() => logoutMutation.mutate()}
      subscriptions={subscriptions}
    >
      <Routes>
        <Route element={<ReaderRoute feedHealth={undefined} feedId={undefined} feedLastFetchedAt={undefined} feedName={undefined} mode="all" subscription={undefined} />} path="/" />
        <Route element={<ReaderRoute feedHealth={undefined} feedId={undefined} feedLastFetchedAt={undefined} feedName={undefined} mode="unread" subscription={undefined} />} path="/unread" />
        <Route element={<FeedsPage />} path="/feeds" />
        <Route element={<FeedRoute key={selectedFeedId} subscriptions={subscriptions} />} path="/feeds/:feedId" />
        <Route element={<SettingsPage />} path="/settings" />
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </AppShell>
  );
}

export function App() {
  const sessionQuery = useQuery({
    queryFn: api.getMe,
    queryKey: ["session"],
    retry: false,
  });
  const setupQuery = useQuery({
    queryFn: api.getSetupStatus,
    queryKey: ["setup-status"],
    retry: false,
  });

  if (sessionQuery.isLoading || setupQuery.isLoading)
    return <div className="loading-screen">Loading…</div>;

  if (!setupQuery.data?.setupCompleted)
    return <SetupPage />;

  if (!sessionQuery.data?.user)
    return <LoginPage />;

  return <AuthenticatedApp />;
}
