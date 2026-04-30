import type { AuthSession, EntryDto, FeedDebugDto, SubscriptionDto, SubscriptionTransferDto } from "@rss-boi/shared";
import { subscriptionTransferSchema } from "@rss-boi/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Clock,
  Download,
  EllipsisVertical,
  ExternalLink,
  Inbox,
  Library,
  ListFilter,
  LogOut,
  RefreshCw,
  Rss,
  Settings,
  Terminal,
  Upload,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

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

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    publishedAfter: start.toISOString(),
    publishedBefore: end.toISOString(),
  };
}

function getEntryLabel(entry: EntryDto) {
  return entry.title ?? entry.url ?? "Untitled entry";
}

function getPlainTextPreview(value: string | null | undefined) {
  if (!value)
    return null;

  if (typeof DOMParser !== "undefined") {
    const parsed = new DOMParser().parseFromString(value, "text/html");
    const text = parsed.body.textContent?.replace(/\s+/g, " ").trim();

    if (text)
      return text;
  }

  const text = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text || null;
}

function getEntryPreview(entry: EntryDto) {
  return getPlainTextPreview(entry.summary) ?? getPlainTextPreview(entry.contentHtml) ?? "No summary available.";
}

function getEntryFeedLabel(entry: EntryDto, feedLabelsByFeedId: ReadonlyMap<string, string>) {
  return feedLabelsByFeedId.get(entry.feed.id) ?? entry.feed.title ?? "Untitled feed";
}

function getFeedHealth(subscription: SubscriptionDto) {
  if (subscription.feed.lastError && subscription.feed.failureCount > 0) {
    return {
      detail: subscription.feed.lastError,
      label: "Failing",
      variant: "destructive" as const,
    };
  }

  if (subscription.feed.nextFetchAt && new Date(subscription.feed.nextFetchAt).getTime() <= Date.now() + 5000) {
    return {
      detail: "Queued for the worker",
      label: "Queued",
      variant: "warning" as const,
    };
  }

  if (subscription.feed.lastSuccessAt) {
    return {
      detail: formatLastFetched(subscription.feed.lastSuccessAt),
      label: "Healthy",
      variant: "success" as const,
    };
  }

  return {
    detail: "Waiting for first successful fetch",
    label: "Pending",
    variant: "secondary" as const,
  };
}

function getFeedLabel(subscription: SubscriptionDto) {
  return subscription.displayName ?? subscription.feed.title ?? subscription.feed.url;
}

const SESSION_CACHE_KEY = "rss-boi:session";
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";
const STANDALONE_DISPLAY_MODE_QUERY = "(display-mode: standalone)";

type BadgePermissionState = NotificationPermission | "unsupported";

function readCachedJson<T>(key: string): T | null {
  if (typeof window === "undefined")
    return null;

  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  }
  catch {
    return null;
  }
}

function writeCachedJson(key: string, value: unknown) {
  if (typeof window === "undefined")
    return;

  window.localStorage.setItem(key, JSON.stringify(value));
}

function removeCachedJson(key: string) {
  if (typeof window === "undefined")
    return;

  window.localStorage.removeItem(key);
}

function supportsNotificationPermission() {
  return typeof Notification !== "undefined" && typeof Notification.requestPermission === "function";
}

function getNotificationPermission(): BadgePermissionState {
  if (!supportsNotificationPermission())
    return "unsupported";

  return Notification.permission;
}

function isAppleMobileDevice() {
  if (typeof navigator === "undefined")
    return false;

  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandaloneWebApp() {
  if (typeof window === "undefined" || typeof navigator === "undefined")
    return false;

  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia(STANDALONE_DISPLAY_MODE_QUERY).matches || standaloneNavigator.standalone === true;
}

function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => typeof window === "undefined"
    ? false
    : window.matchMedia(DESKTOP_MEDIA_QUERY).matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  return isDesktop;
}

function getQueryErrorMessage(error: unknown, isOnline: boolean) {
  if (error instanceof Error)
    return error.message;

  return isOnline ? "Something went wrong." : "You appear to be offline.";
}

function getCurrentPageTitle(pathname: string, subscriptions: SubscriptionDto[]) {
  if (pathname.startsWith("/feeds/")) {
    const feedId = pathname.replace("/feeds/", "");
    const subscription = subscriptions.find(item => item.feed.id === feedId);
    return subscription ? getFeedLabel(subscription) : "Feed";
  }

  if (pathname === "/today")
    return "Today";

  if (pathname === "/unread")
    return "Unread";

  if (pathname === "/subscriptions")
    return "Subscriptions";

  if (pathname === "/feeds")
    return "Feeds";

  if (pathname === "/settings")
    return "Settings";

  return "All entries";
}

function StatusNotice({
  body,
  className,
  icon: Icon = AlertCircle,
  title,
}: {
  body: string;
  className?: string;
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border border-border bg-card/70 px-4 py-3 text-sm", className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function BadgeSetupNotice({
  action,
  body,
  title,
}: {
  action?: React.ReactNode;
  body: string;
  title: string;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-card/70 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">{title}</p>
          <p className="text-muted-foreground">{body}</p>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function EmptyState({
  body,
  icon: Icon,
  title,
}: {
  body: string;
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
      {Icon ? <Icon className="h-10 w-10 text-muted-foreground/50" /> : null}
      <div className="space-y-1">
        <h3 className="font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
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
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm">Debug</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading
          ? <p className="text-sm text-muted-foreground">Loading feed debug information...</p>
          : error
            ? <p className="text-sm text-destructive">{error}</p>
            : debug
              ? (
                  <div className="space-y-4">
                    <div className="grid gap-2 text-sm text-muted-foreground">
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
                            <span className="text-destructive">
                              Last error:
                              {" "}
                              {debug.feed.lastError}
                            </span>
                          )
                        : null}
                    </div>
                    <pre className="rounded-lg border bg-secondary p-4 font-mono text-xs text-secondary-foreground overflow-auto max-h-[360px] whitespace-pre-wrap break-words">
                      {debug.feed.lastResponseBody ?? "No stored response body yet."}
                    </pre>
                  </div>
                )
              : <p className="text-sm text-muted-foreground">No debug data available.</p>}
      </CardContent>
    </Card>
  );
}

function SidebarLink({
  children,
  icon: Icon,
  to,
}: {
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
}) {
  return (
    <NavLink
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      to={to}
    >
      <Icon className="h-4 w-4" />
      {children}
    </NavLink>
  );
}

function AppShell({
  children,
  onLogout,
  subscriptions,
  topNotice,
}: {
  children: React.ReactNode;
  onLogout: () => void;
  subscriptions: SubscriptionDto[];
  topNotice?: React.ReactNode;
}) {
  const { pathname } = useLocation();
  const isOnline = useOnlineStatus();
  const [menuOpen, setMenuOpen] = useState(false);
  const sortedSubscriptions = useMemo(
    () =>
      [...subscriptions].sort((left, right) =>
        getFeedLabel(left).localeCompare(getFeedLabel(right), undefined, { sensitivity: "base" })),
    [subscriptions],
  );
  const currentPageTitle = useMemo(() => getCurrentPageTitle(pathname, subscriptions), [pathname, subscriptions]);

  return (
    <div className="min-h-screen bg-background">
      <div className="hidden min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-2 border-r border-sidebar-border bg-sidebar p-4">
          <div className="px-3 py-4">
            <div className="flex items-center gap-2">
              <Rss className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold text-foreground">RSS Boi</h1>
            </div>
          </div>

          <nav className="flex flex-col gap-1">
            <SidebarLink icon={Inbox} to="/">All entries</SidebarLink>
            <SidebarLink icon={CalendarDays} to="/today">Today</SidebarLink>
            <SidebarLink icon={ListFilter} to="/unread">Unread</SidebarLink>
          </nav>

          <Separator className="my-2 bg-sidebar-border" />

          <div className="flex min-h-0 flex-col gap-2">
            <h2 className="px-3 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/70">
              Subscriptions
            </h2>
            <ScrollArea className="max-h-[calc(100vh-380px)]">
              <nav className="flex flex-col gap-0.5">
                {sortedSubscriptions.length
                  ? sortedSubscriptions.map(subscription => (
                      <NavLink
                        key={subscription.id}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                            isActive
                              ? "bg-sidebar-accent text-sidebar-accent-foreground"
                              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          )}
                        to={`/feeds/${subscription.feed.id}`}
                      >
                        <span className="min-w-0 truncate">{getFeedLabel(subscription)}</span>
                        {subscription.unreadCount > 0
                          ? (
                              <Badge variant="secondary" className="ml-auto shrink-0 tabular-nums">
                                {subscription.unreadCount}
                              </Badge>
                            )
                          : null}
                      </NavLink>
                    ))
                  : (
                      <p className="px-3 py-2 text-sm text-sidebar-foreground/50">No feeds yet.</p>
                    )}
              </nav>
            </ScrollArea>
          </div>

          <div className="mt-auto flex flex-col gap-1">
            <Separator className="mb-2 bg-sidebar-border" />
            <SidebarLink icon={Rss} to="/feeds">Feeds</SidebarLink>
            <SidebarLink icon={Settings} to="/settings">Settings</SidebarLink>
            <Button
              className="mt-2 w-full justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={onLogout}
              variant="ghost"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </Button>
          </div>
        </aside>

        <main className="min-w-0 overflow-auto p-6">
          {topNotice}
          {!isOnline
            ? (
                <StatusNotice
                  body="The app shell is cached, but feed data still needs a network connection."
                  className="mb-4"
                  icon={WifiOff}
                  title="Offline mode"
                />
              )
            : null}
          {children}
        </main>
      </div>

      <div className="lg:hidden">
        <header className="fixed inset-x-0 top-0 z-40 border-b border-border/80 bg-background/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                <Rss className="h-3.5 w-3.5 text-primary" />
                RSS Boi
              </div>
              <h1 className="truncate text-lg font-semibold text-foreground">{currentPageTitle}</h1>
            </div>
            <Button
              aria-expanded={menuOpen}
              aria-label="Open menu"
              onClick={() => setMenuOpen(value => !value)}
              size="icon"
              variant="ghost"
            >
              <EllipsisVertical className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {menuOpen
          ? (
              <div className="fixed inset-0 z-50 bg-black/40 px-4 pt-[calc(env(safe-area-inset-top)+4.25rem)]" onClick={() => setMenuOpen(false)}>
                <div className="ml-auto w-full max-w-[220px] rounded-2xl border border-border bg-card p-2 shadow-xl" onClick={event => event.stopPropagation()}>
                  <NavLink
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-accent"
                    onClick={() => setMenuOpen(false)}
                    to="/settings"
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                  </NavLink>
                  <button
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-destructive transition-colors hover:bg-accent"
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                    type="button"
                  >
                    <LogOut className="h-4 w-4" />
                    Log out
                  </button>
                </div>
              </div>
            )
          : null}

        <main className="px-4 pb-[calc(env(safe-area-inset-bottom)+5.75rem)] pt-[calc(env(safe-area-inset-top)+5.5rem)]">
          {topNotice}
          {!isOnline
            ? (
                <StatusNotice
                  body="The interface is available offline, but refreshing feeds and loading articles still requires a connection."
                  className="mb-4"
                  icon={WifiOff}
                  title="Offline mode"
                />
              )
            : null}
          {children}
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur">
          <div className="grid grid-cols-5 gap-1">
            <NavLink
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              end
              to="/"
            >
              <Inbox className="h-4 w-4" />
              All
            </NavLink>
            <NavLink
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              to="/today"
            >
              <CalendarDays className="h-4 w-4" />
              Today
            </NavLink>
            <NavLink
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              to="/unread"
            >
              <ListFilter className="h-4 w-4" />
              Unread
            </NavLink>
            <NavLink
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              to="/subscriptions"
            >
              <Library className="h-4 w-4" />
              Subs
            </NavLink>
            <NavLink
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              to="/feeds"
            >
              <Rss className="h-4 w-4" />
              Feeds
            </NavLink>
          </div>
        </nav>
      </div>
    </div>
  );
}

function PageHeader({
  actions,
  description,
  title,
}: {
  actions?: React.ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function EntryListPanel({
  entries,
  error,
  feedLabelsByFeedId,
  isLoading,
  onSelect,
  selectedId,
}: {
  entries: EntryDto[];
  error: string | null;
  feedLabelsByFeedId: ReadonlyMap<string, string>;
  isLoading: boolean;
  onSelect: (entryId: string) => void;
  selectedId: string | null;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="flex-none pb-3">
        <CardTitle className="text-sm text-muted-foreground">
          {isLoading && !entries.length ? "Loading items..." : `${entries.length} items`}
        </CardTitle>
      </CardHeader>
      <ScrollArea className="flex-1 px-3 pb-3">
        {error
          ? (
              <StatusNotice
                body={error}
                className="mx-1"
                icon={WifiOff}
                title="Unable to load entries"
              />
            )
          : isLoading && !entries.length
            ? (
                <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Loading entries...
                </div>
              )
            : entries.length
              ? (
                  <div className="flex flex-col gap-2">
                    {entries.map(entry => (
                      <button
                        key={entry.id}
                        className={cn(
                          "flex w-full flex-col gap-2 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent",
                          selectedId === entry.id
                            ? "border-primary bg-accent"
                            : "border-transparent",
                        )}
                        onClick={() => onSelect(entry.id)}
                        type="button"
                      >
                        <div className="flex items-start gap-2">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                              entry.isRead ? "bg-muted-foreground/25" : "bg-primary",
                            )}
                          />
                          <h3 className="line-clamp-2 font-medium leading-snug text-foreground">{getEntryLabel(entry)}</h3>
                        </div>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{getEntryPreview(entry)}</p>
                        <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                          <span className="min-w-0 truncate">{getEntryFeedLabel(entry, feedLabelsByFeedId)}</span>
                          <time className="shrink-0 whitespace-nowrap">{formatDate(entry.publishedAt)}</time>
                        </div>
                      </button>
                    ))}
                  </div>
                )
              : (
                  <EmptyState
                    body="Add a feed or wait for the worker to pull in entries."
                    icon={Inbox}
                    title="No entries yet"
                  />
                )}
      </ScrollArea>
    </Card>
  );
}

function EntryDetailPanel({
  entry,
  error,
  feedLabelsByFeedId,
  isLoading,
  isMobile,
  onBack,
  onToggleRead,
}: {
  entry: EntryDto | null;
  error: string | null;
  feedLabelsByFeedId: ReadonlyMap<string, string>;
  isLoading: boolean;
  isMobile?: boolean;
  onBack?: () => void;
  onToggleRead: (entry: EntryDto) => void;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      {isLoading
        ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Loading article...
              </div>
            </div>
          )
        : error
          ? (
              <div className="flex flex-1 items-center p-4 sm:p-6">
                <StatusNotice
                  body={error}
                  className="w-full"
                  icon={WifiOff}
                  title="Unable to load article"
                />
              </div>
            )
          : entry
            ? (
                <>
                  <CardHeader className="flex-none space-y-3 border-b border-border p-4 sm:p-6">
                    {isMobile && onBack
                      ? (
                          <Button className="w-fit" onClick={onBack} size="sm" variant="ghost">
                            <ArrowLeft className="h-4 w-4" />
                            Back
                          </Button>
                        )
                      : null}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{getEntryFeedLabel(entry, feedLabelsByFeedId)}</span>
                          <span>&middot;</span>
                          <span>{formatDate(entry.publishedAt)}</span>
                        </div>
                        <h2 className="text-lg font-semibold leading-tight sm:text-xl">{getEntryLabel(entry)}</h2>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Button onClick={() => onToggleRead(entry)} size="sm" variant="outline">
                          <BookOpen className="h-4 w-4" />
                          Mark
                          {" "}
                          {entry.isRead ? "unread" : "read"}
                        </Button>
                        {entry.url
                          ? (
                              <Button asChild size="sm" variant="default">
                                <a href={entry.url} rel="noreferrer" target="_blank">
                                  <ExternalLink className="h-4 w-4" />
                                  Open source
                                </a>
                              </Button>
                            )
                          : null}
                      </div>
                    </div>
                  </CardHeader>

                  <ScrollArea className="flex-1 p-4 sm:p-6">
                    <div
                      className="prose-article"
                      dangerouslySetInnerHTML={{ __html: entry.contentHtml ?? `<p>${entry.summary ?? "No article content was captured for this entry."}</p>` }}
                    />
                  </ScrollArea>
                </>
              )
            : (
                <div className="flex flex-1 items-center justify-center">
                  <EmptyState
                    body="Pick an item from the list to read it."
                    icon={BookOpen}
                    title="Nothing selected"
                  />
                </div>
              )}
    </Card>
  );
}

function ReaderView({
  bulkReadLabel,
  canMarkAllRead,
  debugPanel,
  detailError,
  entries,
  entriesError,
  feedHealth,
  feedLabelsByFeedId,
  feedLastFetchedAt,
  feedName,
  isDesktop,
  isDetailLoading,
  isEntriesLoading,
  mode,
  onCloseDetail,
  onToggleDebug,
  onMarkAllRead,
  onRefresh,
  refreshLabel,
  onSelect,
  onToggleRead,
  selectedEntry,
  selectedId,
  showDebug,
}: {
  bulkReadLabel?: string;
  canMarkAllRead?: boolean;
  debugPanel?: React.ReactNode;
  detailError: string | null;
  entries: EntryDto[];
  entriesError: string | null;
  feedHealth: ReturnType<typeof getFeedHealth> | undefined;
  feedLabelsByFeedId: ReadonlyMap<string, string>;
  feedLastFetchedAt: string | null | undefined;
  feedName: string | undefined;
  isDesktop: boolean;
  isDetailLoading: boolean;
  isEntriesLoading: boolean;
  mode: "all" | "today" | "unread";
  onCloseDetail: () => void;
  onToggleDebug?: (() => void) | undefined;
  onMarkAllRead?: (() => void) | undefined;
  onRefresh?: (() => void) | undefined;
  refreshLabel?: string | undefined;
  onSelect: (entryId: string) => void;
  onToggleRead: (entry: EntryDto) => void;
  selectedEntry: EntryDto | null;
  selectedId: string | null;
  showDebug?: boolean;
}) {
  const title = feedName
    ?? (mode === "unread"
      ? "Unread"
      : mode === "today"
        ? "Today"
        : "All entries");
  const description = feedName
    ? `${formatLastFetched(feedLastFetchedAt ?? null)}. ${feedHealth?.detail ?? formatNextFetch(null)}.`
    : mode === "unread"
      ? "Only unread items from your active subscriptions."
      : mode === "today"
        ? "Entries published today across your active subscriptions."
        : "Recent items across your active subscriptions.";
  const isMobileDetailOpen = !isDesktop && !!selectedId;

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      {isDesktop || !isMobileDetailOpen
        ? (
            <PageHeader
              actions={onRefresh || onMarkAllRead
                ? (
                    <>
                      {feedHealth
                        ? <Badge variant={feedHealth.variant}>{feedHealth.label}</Badge>
                        : null}
                      {onMarkAllRead
                        ? (
                            <Button disabled={!canMarkAllRead} onClick={onMarkAllRead} size="sm" variant="outline">
                              <BookOpen className="h-4 w-4" />
                              {bulkReadLabel ?? "Mark all as read"}
                            </Button>
                          )
                        : null}
                      {onRefresh
                        ? (
                            <Button onClick={onRefresh} size="sm" variant="outline">
                              <RefreshCw className="h-4 w-4" />
                              {refreshLabel ?? "Refresh now"}
                            </Button>
                          )
                        : null}
                      {onToggleDebug
                        ? (
                            <Button onClick={onToggleDebug} size="sm" variant="outline">
                              <Terminal className="h-4 w-4" />
                              {showDebug ? "Hide debug" : "Show debug"}
                            </Button>
                          )
                        : null}
                    </>
                  )
                : undefined}
              description={description}
              title={title}
            />
          )
        : null}

      <div className="hidden h-[calc(100dvh-12rem)] min-h-0 gap-5 lg:grid lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <EntryListPanel
          entries={entries}
          error={entriesError}
          feedLabelsByFeedId={feedLabelsByFeedId}
          isLoading={isEntriesLoading}
          onSelect={onSelect}
          selectedId={selectedId}
        />
        <EntryDetailPanel
          entry={selectedEntry}
          error={detailError}
          feedLabelsByFeedId={feedLabelsByFeedId}
          isLoading={isDetailLoading}
          onToggleRead={onToggleRead}
        />
      </div>

      <div className="relative min-h-[calc(100dvh-13rem)] lg:hidden">
        <div className={cn("h-full transition-opacity", isMobileDetailOpen ? "pointer-events-none opacity-0" : "opacity-100")}>
          <EntryListPanel
            entries={entries}
            error={entriesError}
            feedLabelsByFeedId={feedLabelsByFeedId}
            isLoading={isEntriesLoading}
            onSelect={onSelect}
            selectedId={selectedId}
          />
        </div>

        {isMobileDetailOpen
          ? (
              <div className="fixed inset-x-0 bottom-0 z-20 top-[calc(env(safe-area-inset-top)+4.5rem)] pb-[calc(env(safe-area-inset-bottom)+4.5rem)]">
                <EntryDetailPanel
                  entry={selectedEntry}
                  error={detailError}
                  feedLabelsByFeedId={feedLabelsByFeedId}
                  isLoading={isDetailLoading}
                  isMobile
                  onBack={onCloseDetail}
                  onToggleRead={onToggleRead}
                />
              </div>
            )
          : null}
      </div>

      {debugPanel}
    </div>
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
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
        <CardFooter>
          <p className="text-xs text-muted-foreground">{action}</p>
        </CardFooter>
      </Card>
    </div>
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
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          loginMutation.mutate();
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            onChange={event => setEmail(event.target.value)}
            type="email"
            value={email}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            onChange={event => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </div>
        {loginMutation.error
          ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {loginMutation.error.message}
              </div>
            )
          : null}
        <Button disabled={loginMutation.isPending} type="submit">
          {loginMutation.isPending ? "Signing in..." : "Sign in"}
        </Button>
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
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setupMutation.mutate();
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="setup-name">Instance name</Label>
          <Input
            id="setup-name"
            onChange={event => setInstanceName(event.target.value)}
            value={instanceName}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="setup-email">Admin email</Label>
          <Input
            id="setup-email"
            onChange={event => setEmail(event.target.value)}
            type="email"
            value={email}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="setup-password">Password</Label>
          <Input
            id="setup-password"
            onChange={event => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="setup-poll">Default polling interval (minutes)</Label>
          <Input
            id="setup-poll"
            min={5}
            onChange={event => setDefaultPollMinutes(Number(event.target.value))}
            type="number"
            value={defaultPollMinutes}
          />
        </div>
        {setupMutation.error
          ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {setupMutation.error.message}
              </div>
            )
          : null}
        <Button disabled={setupMutation.isPending} type="submit">
          {setupMutation.isPending ? "Creating..." : "Create admin account"}
        </Button>
      </form>
    </AuthCard>
  );
}

function SubscriptionsPage({
  subscriptions,
}: {
  subscriptions: SubscriptionDto[];
}) {
  const sortedSubscriptions = useMemo(
    () =>
      [...subscriptions].sort((left, right) =>
        getFeedLabel(left).localeCompare(getFeedLabel(right), undefined, { sensitivity: "base" })),
    [subscriptions],
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        description="Browse entries for a specific feed."
        title="Subscriptions"
      />

      <Card>
        <CardContent className="p-0">
          {sortedSubscriptions.length
            ? (
                <div className="grid">
                  {sortedSubscriptions.map(subscription => (
                    <NavLink
                      key={subscription.id}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm transition-colors last:border-b-0",
                          isActive
                            ? "bg-accent"
                            : "hover:bg-accent/50",
                        )}
                      to={`/feeds/${subscription.feed.id}`}
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate font-medium text-foreground">{getFeedLabel(subscription)}</span>
                        <span className="text-xs text-muted-foreground">{formatLastFetched(subscription.feed.lastFetchedAt)}</span>
                      </div>
                      {subscription.unreadCount > 0
                        ? (
                            <Badge variant="secondary" className="shrink-0 tabular-nums">
                              {subscription.unreadCount}
                            </Badge>
                          )
                        : null}
                    </NavLink>
                  ))}
                </div>
              )
            : (
                <EmptyState
                  body="Add a feed on the Feeds page to get started."
                  icon={Rss}
                  title="No subscriptions"
                />
              )}
        </CardContent>
      </Card>
    </div>
  );
}

function FeedsPage() {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const subscriptionsQuery = useQuery({
    queryFn: api.getSubscriptions,
    queryKey: ["subscriptions"],
    retry: false,
  });
  const subscriptions = subscriptionsQuery.data ?? [];
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [url, setUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [overridePollMinutes, setOverridePollMinutes] = useState<number | "">("");
  const [overrideFetchTimeoutSeconds, setOverrideFetchTimeoutSeconds] = useState<number | "">("");

  const createMutation = useMutation({
    mutationFn: () => api.createSubscription({
      displayName: displayName || null,
      overrideFetchTimeoutSeconds: overrideFetchTimeoutSeconds === "" ? null : overrideFetchTimeoutSeconds,
      overridePollMinutes: overridePollMinutes === "" ? null : overridePollMinutes,
      url,
    }),
    onSuccess: async () => {
      setUrl("");
      setDisplayName("");
      setOverridePollMinutes("");
      setOverrideFetchTimeoutSeconds("");
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
      overrideFetchTimeoutSeconds: overrideFetchTimeoutSeconds === "" ? null : overrideFetchTimeoutSeconds,
      overridePollMinutes: overridePollMinutes === "" ? null : overridePollMinutes,
      url,
    }),
    onSuccess: async () => {
      setEditingId(null);
      setUrl("");
      setDisplayName("");
      setOverridePollMinutes("");
      setOverrideFetchTimeoutSeconds("");
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      await queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });
  const exportMutation = useMutation({
    mutationFn: api.exportSubscriptions,
    onSuccess: (payload) => {
      const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
      const exportUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().slice(0, 10);

      link.href = exportUrl;
      link.download = `rss-boi-feeds-${timestamp}.json`;
      link.click();
      URL.revokeObjectURL(exportUrl);
      setImportFeedback(`Exported ${payload.subscriptions.length} feed${payload.subscriptions.length === 1 ? "" : "s"}.`);
    },
  });
  const importMutation = useMutation({
    mutationFn: (payload: SubscriptionTransferDto) => api.importSubscriptions(payload),
    onSuccess: async (result) => {
      setImportFeedback(`Imported feeds: ${result.created} created, ${result.updated} updated.`);
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      await queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });
  const activeMutation = editingId ? updateMutation : createMutation;
  const toolbarError = exportMutation.error ?? importMutation.error;

  const handleImportFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file)
      return;

    setImportFeedback(null);

    try {
      const text = await file.text();
      const payload = subscriptionTransferSchema.parse(JSON.parse(text));
      importMutation.mutate(payload);
    }
    catch (error) {
      const message = error instanceof Error ? error.message : "Failed to parse the export file.";
      setImportFeedback(message);
    }
  }, [importMutation]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        actions={(
          <>
            <input
              accept="application/json"
              className="hidden"
              onChange={handleImportFile}
              ref={importInputRef}
              type="file"
            />
            <Button
              disabled={exportMutation.isPending}
              onClick={() => {
                setImportFeedback(null);
                exportMutation.mutate();
              }}
              size="sm"
              variant="outline"
            >
              <Download className="h-4 w-4" />
              {exportMutation.isPending ? "Exporting..." : "Export feeds"}
            </Button>
            <Button
              disabled={importMutation.isPending}
              onClick={() => {
                setImportFeedback(null);
                importInputRef.current?.click();
              }}
              size="sm"
              variant="outline"
            >
              <Upload className="h-4 w-4" />
              {importMutation.isPending ? "Importing..." : "Import feeds"}
            </Button>
          </>
        )}
        description="Subscriptions are shared at the fetch layer, but each account keeps its own list and read state."
        title="Feeds"
      />

      {toolbarError
        ? (
            <StatusNotice body={toolbarError.message} title="Feed transfer failed" />
          )
        : importFeedback
          ? <p className="text-sm text-muted-foreground">{importFeedback}</p>
          : null}

      {subscriptionsQuery.error
        ? (
            <StatusNotice
              body={getQueryErrorMessage(subscriptionsQuery.error, isOnline)}
              icon={WifiOff}
              title="Unable to load feed subscriptions"
            />
          )
        : null}

      <Card>
        <CardContent className="pt-6">
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (editingId)
                updateMutation.mutate(editingId);
              else
                createMutation.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="grid gap-2">
                <Label htmlFor="feed-url">Feed URL</Label>
                <Input
                  id="feed-url"
                  onChange={event => setUrl(event.target.value)}
                  placeholder="https://example.com/feed.xml"
                  value={url}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="feed-name">Display name</Label>
                <Input
                  id="feed-name"
                  onChange={event => setDisplayName(event.target.value)}
                  placeholder="Optional"
                  value={displayName}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="feed-interval">Override interval (min)</Label>
                <Input
                  id="feed-interval"
                  min={5}
                  onChange={event => setOverridePollMinutes(event.target.value ? Number(event.target.value) : "")}
                  placeholder="Use default"
                  type="number"
                  value={overridePollMinutes}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="feed-timeout">Fetch timeout (sec)</Label>
                <Input
                  id="feed-timeout"
                  max={60}
                  min={5}
                  onChange={event => setOverrideFetchTimeoutSeconds(event.target.value ? Number(event.target.value) : "")}
                  placeholder="Default (15s)"
                  type="number"
                  value={overrideFetchTimeoutSeconds}
                />
              </div>
            </div>
            {activeMutation.error
              ? (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    {activeMutation.error.message}
                  </div>
                )
              : null}
            <div className="flex gap-2">
              <Button disabled={activeMutation.isPending} type="submit">
                {editingId ? "Save changes" : "Add feed"}
              </Button>
              {editingId
                ? (
                    <Button
                      onClick={() => {
                        setEditingId(null);
                        setUrl("");
                        setDisplayName("");
                        setOverridePollMinutes("");
                        setOverrideFetchTimeoutSeconds("");
                      }}
                      type="button"
                      variant="outline"
                    >
                      Cancel
                    </Button>
                  )
                : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="grid">
            <div className="hidden border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1.8fr)_minmax(100px,0.6fr)_minmax(200px,0.9fr)] sm:gap-4">
              <span>Feed</span>
              <span>Interval</span>
              <span>Actions</span>
            </div>

            {subscriptionsQuery.error && !subscriptions.length
              ? (
                  <div className="p-4">
                    <StatusNotice
                      body={getQueryErrorMessage(subscriptionsQuery.error, isOnline)}
                      icon={WifiOff}
                      title="Subscriptions are unavailable right now"
                    />
                  </div>
                )
              : subscriptions.length
                ? subscriptions.map(subscription => (
                    <div
                      className="grid items-center gap-4 border-b border-border px-4 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1.8fr)_minmax(100px,0.6fr)_minmax(200px,0.9fr)]"
                      key={subscription.id}
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <NavLink
                            className="min-w-0 truncate font-medium text-foreground hover:text-primary transition-colors"
                            to={`/feeds/${subscription.feed.id}`}
                          >
                            {getFeedLabel(subscription)}
                          </NavLink>
                          {subscription.unreadCount > 0
                            ? (
                                <Badge variant="secondary" className="shrink-0 tabular-nums">
                                  {subscription.unreadCount}
                                </Badge>
                              )
                            : null}
                        </div>
                        <span className="truncate text-xs text-muted-foreground">{subscription.feed.url}</span>
                        <span className="text-xs text-muted-foreground">{formatLastFetched(subscription.feed.lastFetchedAt)}</span>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={getFeedHealth(subscription).variant}>
                            {getFeedHealth(subscription).label}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{getFeedHealth(subscription).detail}</span>
                          <span className="text-xs text-muted-foreground">{formatNextFetch(subscription.feed.nextFetchAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {subscription.effectivePollMinutes}
                        {" "}
                        min
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => {
                            setEditingId(subscription.id);
                            setUrl(subscription.feed.url);
                            setDisplayName(subscription.displayName ?? "");
                            setOverridePollMinutes(subscription.overridePollMinutes ?? "");
                            setOverrideFetchTimeoutSeconds(subscription.overrideFetchTimeoutSeconds ?? "");
                          }}
                          size="sm"
                          variant="outline"
                        >
                          Edit
                        </Button>
                        <Button
                          disabled={refreshMutation.isPending}
                          onClick={() => refreshMutation.mutate(subscription.id)}
                          size="sm"
                          variant="outline"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          {refreshMutation.isPending && refreshMutation.variables === subscription.id ? "Queued..." : "Refresh"}
                        </Button>
                        <Button
                          onClick={() => {
                          // eslint-disable-next-line no-alert
                            if (window.confirm(`Remove ${getFeedLabel(subscription)} from your subscriptions?`))
                              deleteMutation.mutate(subscription.id);
                          }}
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))
                : (
                    <EmptyState
                      body="Add a feed URL to start collecting entries."
                      icon={Rss}
                      title="No subscriptions"
                    />
                  )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const settingsQuery = useQuery({
    queryFn: api.getSettings,
    queryKey: ["settings"],
    retry: false,
  });
  const [defaultPollMinutes, setDefaultPollMinutes] = useState<number | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const effectiveDefaultPollMinutes = defaultPollMinutes ?? settingsQuery.data?.defaultPollMinutes ?? 30;

  const settingsMutation = useMutation({
    mutationFn: () => api.updateSettings(effectiveDefaultPollMinutes),
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
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" />

      {settingsQuery.error
        ? (
            <StatusNotice
              body={getQueryErrorMessage(settingsQuery.error, isOnline)}
              icon={WifiOff}
              title="Unable to load settings"
            />
          )
        : null}

      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Polling</CardTitle>
            <CardDescription>Configure how often feeds are checked for new content.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                settingsMutation.mutate();
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="settings-poll">Default polling interval (minutes)</Label>
                <Input
                  disabled={!settingsQuery.data}
                  id="settings-poll"
                  min={5}
                  onChange={event => setDefaultPollMinutes(Number(event.target.value))}
                  type="number"
                  value={effectiveDefaultPollMinutes}
                />
              </div>
              <Button className="w-fit" disabled={!settingsQuery.data || settingsMutation.isPending} type="submit">
                Save
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>Change your account password.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                passwordMutation.mutate();
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="settings-current-pw">Current password</Label>
                <Input
                  disabled={!settingsQuery.data}
                  id="settings-current-pw"
                  onChange={event => setCurrentPassword(event.target.value)}
                  type="password"
                  value={currentPassword}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="settings-new-pw">New password</Label>
                <Input
                  disabled={!settingsQuery.data}
                  id="settings-new-pw"
                  onChange={event => setNewPassword(event.target.value)}
                  type="password"
                  value={newPassword}
                />
              </div>
              <Button className="w-fit" disabled={!settingsQuery.data || passwordMutation.isPending} type="submit">
                Change password
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FeedRoute({
  feedLabelsByFeedId,
  subscriptions,
}: {
  feedLabelsByFeedId: ReadonlyMap<string, string>;
  subscriptions: SubscriptionDto[];
}) {
  const { feedId } = useParams();
  const subscription = subscriptions.find(item => item.feed.id === feedId);

  return (
    <ReaderRoute
      feedId={feedId}
      feedHealth={subscription ? getFeedHealth(subscription) : undefined}
      feedLabelsByFeedId={feedLabelsByFeedId}
      feedLastFetchedAt={subscription?.feed.lastFetchedAt}
      feedName={subscription ? getFeedLabel(subscription) : undefined}
      mode="all"
      subscription={subscription}
      unreadCount={subscription?.unreadCount ?? 0}
    />
  );
}

function ReaderRoute({
  feedId,
  feedHealth,
  feedLabelsByFeedId,
  feedLastFetchedAt,
  feedName,
  mode,
  subscription,
  unreadCount,
}: {
  feedId: string | undefined;
  feedHealth: ReturnType<typeof getFeedHealth> | undefined;
  feedLabelsByFeedId: ReadonlyMap<string, string>;
  feedLastFetchedAt: string | null | undefined;
  feedName: string | undefined;
  mode: "all" | "today" | "unread";
  subscription?: SubscriptionDto | undefined;
  unreadCount: number;
}) {
  const isDesktop = useIsDesktop();
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [debugOpen, setDebugOpen] = useState(false);
  const suppressAutoReadRef = useRef(new Set<string>());
  const lastAutoMarkedRef = useRef<string | null>(null);
  const pendingMarkReadRef = useRef(new Set<string>());
  const selectedEntryRef = useRef<EntryDto | null>(null);
  const selectedId = searchParams.get("entry");
  const isMobileDetailOpen = !isDesktop && !!selectedId;

  useEffect(() => {
    if (!isMobileDetailOpen)
      return;

    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileDetailOpen]);

  const todayRange = useMemo(() => mode === "today" ? getTodayRange() : undefined, [mode]);
  const entriesQuery = useQuery({
    queryFn: () =>
      api.getEntries({
        ...(feedId ? { feedId } : {}),
        ...(mode === "unread" ? { status: "unread" as const } : { status: "all" as const }),
        ...(todayRange ?? {}),
      }),
    queryKey: ["entries", { feedId, mode, ...todayRange }],
    retry: false,
  });
  const entries = useMemo(() => entriesQuery.data?.entries ?? [], [entriesQuery.data?.entries]);
  const selectedEntryFromList = useMemo(
    () => entries.find(entry => entry.id === selectedId) ?? null,
    [entries, selectedId],
  );
  const selectedEntryQuery = useQuery({
    enabled: !!selectedId && !selectedEntryFromList,
    queryFn: () => api.getEntry(selectedId!),
    queryKey: ["entry", selectedId],
    retry: false,
  });
  const selectedEntry = selectedEntryFromList ?? selectedEntryQuery.data ?? null;
  const debugQuery = useQuery({
    enabled: debugOpen && !!subscription,
    queryFn: () => api.getSubscriptionDebug(subscription!.id),
    queryKey: ["subscription-debug", subscription?.id],
  });
  const invalidateReaderData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
      queryClient.invalidateQueries({ queryKey: ["entries"] }),
    ]);
  }, [queryClient]);

  const toggleReadMutation = useMutation({
    mutationFn: (entry: EntryDto) => entry.isRead ? api.markUnread(entry.id) : api.markRead(entry.id),
    onSuccess: invalidateReaderData,
  });
  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.markRead(id),
    onSuccess: invalidateReaderData,
  });
  const markRead = markReadMutation.mutate;
  const markAllReadMutation = useMutation({
    mutationFn: () => api.markAllRead(feedId ? { feedId } : {}),
    onSuccess: invalidateReaderData,
  });
  const refreshMutation = useMutation({
    mutationFn: (id: string) => api.refreshSubscription(id),
    onSuccess: invalidateReaderData,
  });
  const markEntryRead = useCallback((entryId: string) => {
    if (pendingMarkReadRef.current.has(entryId))
      return;

    pendingMarkReadRef.current.add(entryId);
    markRead(entryId, {
      onSettled: () => {
        pendingMarkReadRef.current.delete(entryId);
      },
    });
  }, [markRead]);

  useEffect(() => {
    selectedEntryRef.current = selectedEntry;
  }, [selectedEntry]);

  useEffect(() => {
    if (mode === "unread")
      return;

    if (!selectedId)
      return;

    if (selectedId === lastAutoMarkedRef.current)
      return;

    if (suppressAutoReadRef.current.has(selectedId))
      return;

    const entry = selectedEntry;
    if (!entry || entry.isRead)
      return;

    lastAutoMarkedRef.current = selectedId;
    markEntryRead(selectedId);
  }, [markEntryRead, mode, selectedEntry, selectedId]);

  useEffect(() => {
    if (mode !== "unread")
      return;

    const suppressAutoRead = suppressAutoReadRef.current;

    return () => {
      if (!selectedId)
        return;

      if (suppressAutoRead.has(selectedId)) {
        suppressAutoRead.delete(selectedId);
        return;
      }

      const entry = selectedEntryRef.current;

      if (!entry || entry.isRead)
        return;

      markEntryRead(selectedId);
    };
  }, [markEntryRead, mode, selectedId]);

  const updateSelectedId = useCallback((entryId: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);

      if (entryId)
        next.set("entry", entryId);
      else
        next.delete("entry");

      return next;
    });
  }, [setSearchParams]);

  const handleSelect = useCallback((entryId: string) => {
    suppressAutoReadRef.current.delete(entryId);
    lastAutoMarkedRef.current = null;
    updateSelectedId(entryId);
  }, [updateSelectedId]);

  const handleCloseDetail = useCallback(() => {
    updateSelectedId(null);
  }, [updateSelectedId]);

  const handleToggleRead = useCallback((entry: EntryDto) => {
    if (entry.isRead)
      suppressAutoReadRef.current.add(entry.id);
    else
      suppressAutoReadRef.current.delete(entry.id);

    toggleReadMutation.mutate(entry);
  }, [toggleReadMutation]);

  const handleMarkAllRead = useCallback(() => {
    if (mode === "unread" && selectedId) {
      suppressAutoReadRef.current.add(selectedId);
      updateSelectedId(null);
    }

    markAllReadMutation.mutate();
  }, [markAllReadMutation, mode, selectedId, updateSelectedId]);

  const entriesError = entriesQuery.error && !entries.length
    ? getQueryErrorMessage(entriesQuery.error, isOnline)
    : null;
  const detailError = selectedId && selectedEntryQuery.error
    ? getQueryErrorMessage(selectedEntryQuery.error, isOnline)
    : null;

  return (
    <ReaderView
      bulkReadLabel={markAllReadMutation.isPending ? "Marking..." : "Mark all as read"}
      canMarkAllRead={unreadCount > 0 && !markAllReadMutation.isPending}
      detailError={detailError}
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
      entriesError={entriesError}
      feedHealth={feedHealth}
      feedLabelsByFeedId={feedLabelsByFeedId}
      feedLastFetchedAt={feedLastFetchedAt}
      feedName={feedName}
      isDesktop={isDesktop}
      isDetailLoading={!!selectedId && !selectedEntry && selectedEntryQuery.isLoading}
      isEntriesLoading={entriesQuery.isLoading}
      mode={mode}
      onCloseDetail={handleCloseDetail}
      onMarkAllRead={mode === "unread" || subscription ? handleMarkAllRead : undefined}
      onRefresh={subscription ? () => refreshMutation.mutate(subscription.id) : undefined}
      onToggleDebug={subscription ? () => setDebugOpen(value => !value) : undefined}
      onSelect={handleSelect}
      onToggleRead={handleToggleRead}
      selectedEntry={selectedEntry}
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
  const [badgePermission, setBadgePermission] = useState<BadgePermissionState>(() => getNotificationPermission());
  const [isBadgePermissionPending, setIsBadgePermissionPending] = useState(false);
  const [badgePermissionError, setBadgePermissionError] = useState<string | null>(null);
  const [isStandaloneApp, setIsStandaloneApp] = useState(() => isStandaloneWebApp());
  const subscriptionsQuery = useQuery({
    queryFn: api.getSubscriptions,
    queryKey: ["subscriptions"],
    retry: false,
  });
  const subscriptions = useMemo(() => subscriptionsQuery.data ?? [], [subscriptionsQuery.data]);
  const isAppleMobile = useMemo(() => isAppleMobileDevice(), []);
  const supportsBadging = useMemo(() => typeof navigator !== "undefined" && "setAppBadge" in navigator, []);

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      removeCachedJson(SESSION_CACHE_KEY);
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/login");
    },
  });

  const selectedFeedId = useMemo(() => {
    if (!pathname.startsWith("/feeds/"))
      return null;

    return pathname.replace("/feeds/", "");
  }, [pathname]);
  const unreadCount = useMemo(
    () => subscriptions.reduce((total, subscription) => total + subscription.unreadCount, 0),
    [subscriptions],
  );

  useEffect(() => {
    if (typeof window === "undefined")
      return;

    const mediaQuery = window.matchMedia(STANDALONE_DISPLAY_MODE_QUERY);
    const syncBadgeSupport = () => {
      setBadgePermission(getNotificationPermission());
      setIsStandaloneApp(isStandaloneWebApp());
    };

    mediaQuery.addEventListener("change", syncBadgeSupport);
    document.addEventListener("visibilitychange", syncBadgeSupport);

    return () => {
      mediaQuery.removeEventListener("change", syncBadgeSupport);
      document.removeEventListener("visibilitychange", syncBadgeSupport);
    };
  }, []);

  useEffect(() => {
    if (!("setAppBadge" in navigator))
      return;

    if (unreadCount > 0)
      navigator.setAppBadge(unreadCount);
    else
      navigator.clearAppBadge();
  }, [badgePermission, isStandaloneApp, unreadCount]);

  const handleEnableBadgePermission = useCallback(async () => {
    if (!supportsNotificationPermission())
      return;

    setBadgePermissionError(null);
    setIsBadgePermissionPending(true);

    try {
      const permission = await Notification.requestPermission();
      setBadgePermission(permission);
    }
    catch (error) {
      setBadgePermissionError(error instanceof Error ? error.message : "Unable to enable unread badges.");
    }
    finally {
      setIsBadgePermissionPending(false);
    }
  }, []);

  const badgeSetupNotice = useMemo(() => {
    if (!isAppleMobile)
      return null;

    if (!isStandaloneApp) {
      return (
        <BadgeSetupNotice
          body="iPhone only shows unread badges for the Home Screen app. Add RSS Boi to your Home Screen from Safari, then open it from the app icon."
          title="Add RSS Boi to Home Screen"
        />
      );
    }

    if (!supportsBadging || badgePermission === "unsupported") {
      return (
        <BadgeSetupNotice
          body="Unread app-icon badges need iOS 16.4 or newer and the installed Home Screen app."
          title="Unread badges are unavailable on this iPhone"
        />
      );
    }

    if (badgePermission === "granted")
      return null;

    if (badgePermission === "denied") {
      return (
        <BadgeSetupNotice
          body="Notifications are blocked for RSS Boi on this iPhone. Re-enable them in Settings > Notifications > RSS Boi, then turn on Badges."
          title="Unread badges are blocked"
        />
      );
    }

    return (
      <BadgeSetupNotice
        action={(
          <Button disabled={isBadgePermissionPending} onClick={() => void handleEnableBadgePermission()} size="sm" variant="outline">
            {isBadgePermissionPending ? "Enabling..." : "Enable badges"}
          </Button>
        )}
        body={badgePermissionError ?? "iPhone requires notification permission before RSS Boi can show the unread count on its app icon."}
        title={badgePermissionError ? "Unable to enable unread badges" : "Enable unread badges on iPhone"}
      />
    );
  }, [badgePermission, badgePermissionError, handleEnableBadgePermission, isAppleMobile, isBadgePermissionPending, isStandaloneApp, supportsBadging]);

  const feedLabelsByFeedId = useMemo(
    () => new Map(subscriptions.map(subscription => [subscription.feed.id, getFeedLabel(subscription)])),
    [subscriptions],
  );

  return (
    <AppShell
      onLogout={() => logoutMutation.mutate()}
      subscriptions={subscriptions}
      topNotice={badgeSetupNotice}
    >
      <Routes>
        <Route element={<ReaderRoute feedHealth={undefined} feedId={undefined} feedLabelsByFeedId={feedLabelsByFeedId} feedLastFetchedAt={undefined} feedName={undefined} mode="all" subscription={undefined} unreadCount={0} />} path="/" />
        <Route element={<ReaderRoute feedHealth={undefined} feedId={undefined} feedLabelsByFeedId={feedLabelsByFeedId} feedLastFetchedAt={undefined} feedName={undefined} mode="today" subscription={undefined} unreadCount={0} />} path="/today" />
        <Route element={<ReaderRoute feedHealth={undefined} feedId={undefined} feedLabelsByFeedId={feedLabelsByFeedId} feedLastFetchedAt={undefined} feedName={undefined} mode="unread" subscription={undefined} unreadCount={unreadCount} />} path="/unread" />
        <Route element={<SubscriptionsPage subscriptions={subscriptions} />} path="/subscriptions" />
        <Route element={<FeedsPage />} path="/feeds" />
        <Route element={<FeedRoute key={selectedFeedId} feedLabelsByFeedId={feedLabelsByFeedId} subscriptions={subscriptions} />} path="/feeds/:feedId" />
        <Route element={<SettingsPage />} path="/settings" />
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </AppShell>
  );
}

export function App() {
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();
  const cachedSession = useMemo(() => readCachedJson<AuthSession>(SESSION_CACHE_KEY), []);
  useEffect(() => removeCachedJson("rss-boi:setup-status"), []);
  const sessionQuery = useQuery({
    queryFn: api.getMe,
    queryKey: ["session"],
    retry: 3,
    retryDelay: attempt => Math.min(1000 * 2 ** attempt, 5000),
  });
  const setupQuery = useQuery({
    queryFn: api.getSetupStatus,
    queryKey: ["setup-status"],
    retry: 3,
    retryDelay: attempt => Math.min(1000 * 2 ** attempt, 5000),
  });
  const session = sessionQuery.data ?? (sessionQuery.error ? null : cachedSession);
  const setupStatus = setupQuery.data ?? null;

  useEffect(() => {
    if (sessionQuery.data?.user)
      writeCachedJson(SESSION_CACHE_KEY, sessionQuery.data);
    else if (sessionQuery.data)
      removeCachedJson(SESSION_CACHE_KEY);
  }, [sessionQuery.data]);

  if ((sessionQuery.isLoading && !session) || (setupQuery.isLoading && !setupStatus)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  if ((setupQuery.error && !setupStatus) || (sessionQuery.error && !session)) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="text-xl">Unable to start RSS Boi</CardTitle>
            <CardDescription>
              {isOnline
                ? "The app shell loaded, but the session bootstrap request failed."
                : "You appear to be offline and this device does not have enough cached account state to open the app shell."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <StatusNotice
              body={getQueryErrorMessage(sessionQuery.error ?? setupQuery.error, isOnline)}
              icon={WifiOff}
              title={isOnline ? "Startup request failed" : "Offline startup is unavailable"}
            />
            <Button
              onClick={async () => {
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: ["session"] }),
                  queryClient.invalidateQueries({ queryKey: ["setup-status"] }),
                ]);
              }}
              variant="outline"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!setupStatus?.setupCompleted)
    return <SetupPage />;

  if (!session?.user)
    return <LoginPage />;

  return <AuthenticatedApp />;
}
