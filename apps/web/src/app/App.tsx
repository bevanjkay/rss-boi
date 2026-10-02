import type { AuthSession, EntryDto, EntryListDto, EntryListItemDto, FeedDebugDto, SubscriptionDto, SubscriptionTransferDto } from "@rss-boi/shared";
import type { InfiniteData, QueryKey } from "@tanstack/react-query";
import { subscriptionTransferSchema } from "@rss-boi/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Inbox,
  Keyboard,
  ListFilter,
  LogOut,
  RefreshCw,
  Rss,
  Search,
  Settings,
  Terminal,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import { createContext, use, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import { cn } from "@/lib/utils";

function formatDate(value: string | null) {
  if (!value)
    return "Not published";

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const relativeTimeFormat = new Intl.RelativeTimeFormat("en-AU", { numeric: "auto" });
const RELATIVE_TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

function formatRelativeTime(value: string) {
  const elapsedSeconds = (new Date(value).getTime() - Date.now()) / 1000;

  for (const [unit, seconds] of RELATIVE_TIME_UNITS) {
    if (Math.abs(elapsedSeconds) >= seconds)
      return relativeTimeFormat.format(Math.round(elapsedSeconds / seconds), unit);
  }

  return "just now";
}

function formatListDate(value: string | null) {
  if (!value)
    return "Undated";

  const date = new Date(value);
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));

  if (elapsedMinutes < 1)
    return "now";

  if (elapsedMinutes < 60)
    return `${elapsedMinutes}m`;

  if (elapsedMinutes < 24 * 60)
    return `${Math.floor(elapsedMinutes / 60)}h`;

  if (elapsedMinutes < 7 * 24 * 60)
    return `${Math.floor(elapsedMinutes / (24 * 60))}d`;

  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

function formatLastAttemptedFetch(value: string | null) {
  if (!value)
    return "Never fetched";

  return `Last attempted fetch ${formatDate(value)}`;
}

function formatLastSuccessfulFetch(value: string | null) {
  if (!value)
    return "Never fetched successfully";

  return `Last successful fetch ${formatDate(value)}`;
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

function getEntryLabel(entry: Pick<EntryDto, "title" | "url">) {
  return entry.title ?? entry.url ?? "Untitled entry";
}

function getEntryPreview(entry: EntryListItemDto) {
  return entry.preview || "No summary available.";
}

function getEntryArticleHtml(entry: EntryDto) {
  if (entry.contentHtml)
    return entry.contentHtml;

  const summary = entry.summary?.trim() || "This post was published without any article text.";
  return summary.startsWith("<") ? summary : `<p>${summary}</p>`;
}

function getEntryImageHtml(entry: EntryDto) {
  return [entry.contentHtml, entry.summary].filter((value): value is string => !!value).join("\n");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function decodeHtmlAttribute(value: string) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function getImageSourcesFromHtml(html: string) {
  if (typeof DOMParser !== "undefined") {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    return Array.from(parsed.images)
      .map(image => image.currentSrc || image.src)
      .filter((source): source is string => !!source);
  }

  return Array.from(html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi))
    .map(match => match[1])
    .filter((source): source is string => !!source)
    .map(decodeHtmlAttribute);
}

function getEntryFeedLabel(entry: Pick<EntryDto, "feed">, feedLabelsByFeedId: ReadonlyMap<string, string>) {
  return feedLabelsByFeedId.get(entry.feed.id) ?? entry.feed.title ?? "Untitled feed";
}

function isFeedFailing(subscription: SubscriptionDto) {
  return Boolean(subscription.feed.lastError) && subscription.feed.failureCount > 0;
}

function getFeedHealth(subscription: SubscriptionDto) {
  if (isFeedFailing(subscription)) {
    return {
      detail: subscription.feed.lastSuccessAt
        ? `${subscription.feed.lastError} Last updated ${formatRelativeTime(subscription.feed.lastSuccessAt)}.`
        : subscription.feed.lastError,
      label: "Failing",
      variant: "destructive" as const,
    };
  }

  if (subscription.feed.nextFetchAt && new Date(subscription.feed.nextFetchAt).getTime() <= Date.now() + 5000) {
    return {
      detail: "Checking for new posts now",
      label: "Queued",
      variant: "warning" as const,
    };
  }

  if (subscription.feed.lastSuccessAt) {
    return {
      detail: `Updated ${formatRelativeTime(subscription.feed.lastSuccessAt)}`,
      label: "Healthy",
      variant: "success" as const,
    };
  }

  return {
    detail: "Waiting for the first successful check",
    label: "Pending",
    variant: "secondary" as const,
  };
}

function getFeedLabel(subscription: SubscriptionDto) {
  return subscription.displayName ?? subscription.feed.title ?? subscription.feed.url;
}

const SESSION_CACHE_KEY = "rss-boi:session";
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";
const READER_STALE_TIME_MS = 30_000;
const ARTICLE_STALE_TIME_MS = 5 * 60_000;
// Read-state writes share one mutation scope so they reach the API in the
// order the user made them; the optimistic cache patch still applies at once.
const READ_STATE_MUTATION_KEY = ["entry-read-state"];
const READ_STATE_MUTATION_SCOPE = { id: "entry-read-state" };
const STANDALONE_DISPLAY_MODE_QUERY = "(display-mode: standalone)";

type BadgePermissionState = NotificationPermission | "unsupported";

interface ReadStateTarget {
  feed: { id: string };
  id: string;
  isRead: boolean;
}

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

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));
}

function isDialogOpen() {
  return document.querySelector("dialog[open]") !== null;
}

type ToastTone = "default" | "error";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

function useToast() {
  return use(ToastContext);
}

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(0);
  const dismissToast = useCallback((id: number) => {
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);
  const showToast = useCallback((message: string, tone: ToastTone = "default") => {
    nextIdRef.current += 1;
    const id = nextIdRef.current;

    setToasts(current => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(dismissToast, tone === "error" ? 8000 : 4000, id);
  }, [dismissToast]);

  return (
    <ToastContext value={showToast}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--mobile-nav-height)+0.75rem)] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:px-6"
        role="status"
      >
        {toasts.map(toast => (
          <div
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-secondary py-2.5 pl-4 pr-2 text-sm text-secondary-foreground",
              toast.tone === "error" ? "border-destructive/60" : "border-border",
            )}
            key={toast.id}
          >
            {toast.tone === "error"
              ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              : <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
            <p className="min-w-0 flex-1 break-words py-px">{toast.message}</p>
            <button
              aria-label="Dismiss"
              className="-my-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => dismissToast(toast.id)}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
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
      <div className="min-w-0 space-y-1 break-words">
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
  action,
  body,
  icon: Icon,
  title,
}: {
  action?: React.ReactNode;
  body: string;
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      {Icon ? <Icon className="h-8 w-8 text-muted-foreground/60" /> : null}
      <div className="max-w-xs space-y-1">
        <h3 className="font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
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
                    <div className="grid grid-cols-1 gap-2 break-words text-sm text-muted-foreground">
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
                      <span>{formatLastAttemptedFetch(debug.feed.lastFetchedAt)}</span>
                      <span>{formatLastSuccessfulFetch(debug.feed.lastSuccessAt)}</span>
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
  end,
  icon: Icon,
  to,
}: {
  children: React.ReactNode;
  end?: boolean;
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
      end={end ?? false}
      to={to}
    >
      <Icon className="h-4 w-4" />
      {children}
    </NavLink>
  );
}

function MobileNavLink({
  children,
  end,
  icon: Icon,
  to,
}: {
  children: React.ReactNode;
  end?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
}) {
  return (
    <NavLink
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-xs font-medium transition-colors",
          isActive
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      end={end ?? false}
      to={to}
    >
      <Icon className="h-4 w-4" />
      {children}
    </NavLink>
  );
}

const KEYBOARD_SHORTCUTS: [keys: string[], description: string][] = [
  [["j"], "Next article"],
  [["k"], "Previous article"],
  [["m"], "Mark read or unread"],
  [["o"], "Open the original post"],
  [["Shift", "A"], "Mark all as read (press twice)"],
  [["Esc"], "Close the article"],
  [["?"], "Show this list"],
];

function ShortcutsDialog({
  onClose,
  open,
}: {
  onClose: () => void;
  open: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog)
      return;

    if (open && !dialog.open)
      dialog.showModal();
    else if (!open && dialog.open)
      dialog.close();
  }, [open]);

  return (
    <dialog
      aria-labelledby="shortcuts-title"
      className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-0 text-card-foreground backdrop:bg-black/60"
      onClick={(event) => {
        if (event.target === event.currentTarget)
          onClose();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="flex items-center justify-between border-b border-border py-3 pl-5 pr-3">
        <h2 className="font-semibold" id="shortcuts-title">Keyboard shortcuts</h2>
        <Button aria-label="Close" onClick={onClose} size="icon" variant="ghost">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-3 px-5 py-4 text-sm">
        {KEYBOARD_SHORTCUTS.map(([keys, description]) => (
          <div className="contents" key={description}>
            <dt className="flex gap-1">
              {keys.map(key => (
                <kbd
                  className="min-w-6 rounded border border-border bg-secondary px-1.5 py-0.5 text-center font-mono text-xs text-secondary-foreground"
                  key={key}
                >
                  {key}
                </kbd>
              ))}
            </dt>
            <dd className="text-muted-foreground">{description}</dd>
          </div>
        ))}
      </dl>
    </dialog>
  );
}

function AppShell({
  children,
  onLogout,
  subscriptions,
  topNotice,
  unreadCount,
}: {
  children: React.ReactNode;
  onLogout: () => void;
  subscriptions: SubscriptionDto[];
  topNotice?: React.ReactNode;
  unreadCount: number;
}) {
  const { pathname } = useLocation();
  const isOnline = useOnlineStatus();
  const isDesktop = useIsDesktop();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const sortedSubscriptions = useMemo(
    () =>
      [...subscriptions].sort((left, right) =>
        getFeedLabel(left).localeCompare(getFeedLabel(right), undefined, { sensitivity: "base" })),
    [subscriptions],
  );
  const currentPageTitle = useMemo(() => getCurrentPageTitle(pathname, subscriptions), [pathname, subscriptions]);
  const offlineNotice = isOnline
    ? null
    : (
        <StatusNotice
          body="You can still read what's already loaded. New posts and articles need a connection."
          className="mb-4"
          icon={WifiOff}
          title="You're offline"
        />
      );

  useEffect(() => {
    document.title = `${unreadCount > 0 ? `(${unreadCount}) ` : ""}${currentPageTitle} · RSS Boi`;
  }, [currentPageTitle, unreadCount]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target))
        return;

      event.preventDefault();
      setShortcutsOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="hidden min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
        <a
          className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
          href="#main-content"
        >
          Skip to content
        </a>
        <aside className="flex h-dvh flex-col gap-2 border-r border-sidebar-border bg-sidebar p-4">
          <div className="flex items-center gap-2 px-3 py-4">
            <Rss className="h-5 w-5 text-primary" />
            <span className="text-lg font-semibold text-foreground">RSS Boi</span>
          </div>

          <nav aria-label="Views" className="flex flex-col gap-1">
            <SidebarLink end icon={Inbox} to="/">All entries</SidebarLink>
            <SidebarLink icon={CalendarDays} to="/today">Today</SidebarLink>
            <SidebarLink icon={ListFilter} to="/unread">Unread</SidebarLink>
          </nav>

          <Separator className="my-2 bg-sidebar-border" />

          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <h2 className="px-3 text-xs font-medium text-sidebar-foreground">
              Subscriptions
            </h2>
            <ScrollArea className="min-h-0 flex-1">
              <nav aria-label="Subscriptions" className="flex flex-col gap-0.5">
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
                      <Link className="block px-3 py-2 text-sm text-sidebar-foreground hover:text-foreground" to="/feeds">
                        No feeds yet. Add one on the Feeds page.
                      </Link>
                    )}
              </nav>
            </ScrollArea>
          </div>

          <div className="flex flex-col gap-1">
            <Separator className="mb-2 bg-sidebar-border" />
            <SidebarLink icon={Rss} to="/feeds">Feeds</SidebarLink>
            <SidebarLink icon={Settings} to="/settings">Settings</SidebarLink>
            <Button
              className="w-full justify-start gap-3 px-3 font-normal text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={() => setShortcutsOpen(true)}
              variant="ghost"
            >
              <Keyboard className="h-4 w-4" />
              Keyboard shortcuts
              <kbd className="ml-auto rounded border border-sidebar-border px-1.5 font-mono text-xs">?</kbd>
            </Button>
            <Button
              className="w-full justify-start gap-3 px-3 font-normal text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={onLogout}
              variant="ghost"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </Button>
          </div>
        </aside>

        <main className="flex h-dvh min-w-0 flex-col overflow-auto p-6" id="main-content" tabIndex={-1}>
          {topNotice}
          {offlineNotice}
          {/* Both shells stay mounted for layout, but the route tree renders
              once: rendering it in both ran every reader query and effect twice. */}
          {isDesktop ? children : null}
        </main>
      </div>

      <div className="lg:hidden">
        <header className="fixed inset-x-0 top-0 z-40 flex h-[var(--mobile-header-height)] items-end border-b border-border/80 bg-background/95 px-4 pb-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <Rss aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
            <h1 className="truncate text-lg font-semibold text-foreground">{currentPageTitle}</h1>
          </div>
        </header>

        <main className="px-4 pb-[calc(var(--mobile-nav-height)+1.5rem)] pt-[calc(var(--mobile-header-height)+1rem)]">
          {topNotice}
          {offlineNotice}
          {isDesktop ? null : children}
        </main>

        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-40 h-[var(--mobile-nav-height)] border-t border-border/80 bg-background/95 px-3 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur"
        >
          <div className="grid grid-cols-5 gap-1">
            <MobileNavLink end icon={Inbox} to="/">All</MobileNavLink>
            <MobileNavLink icon={CalendarDays} to="/today">Today</MobileNavLink>
            <MobileNavLink icon={ListFilter} to="/unread">Unread</MobileNavLink>
            <MobileNavLink icon={Rss} to="/feeds">Feeds</MobileNavLink>
            <MobileNavLink icon={Settings} to="/settings">Settings</MobileNavLink>
          </div>
        </nav>
      </div>

      <ShortcutsDialog onClose={() => setShortcutsOpen(false)} open={shortcutsOpen} />
    </div>
  );
}

function PageHeader({
  actions,
  description,
  title,
}: {
  actions?: React.ReactNode;
  description?: string | null | undefined;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 space-y-1 break-words">
        <h1 className="hidden text-2xl font-semibold tracking-tight lg:block">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function LoadMoreSentinel({ onVisible }: { onVisible: () => void }) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const onVisibleRef = useRef(onVisible);

  useEffect(() => {
    onVisibleRef.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    const sentinel = sentinelRef.current;

    if (!sentinel || typeof IntersectionObserver === "undefined")
      return;

    const observer = new IntersectionObserver((records) => {
      if (records.some(record => record.isIntersecting))
        onVisibleRef.current();
    }, { rootMargin: "400px 0px" });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return <div aria-hidden="true" ref={sentinelRef} />;
}

function EntryListPanel({
  emptyState,
  entries,
  error,
  feedLabelsByFeedId,
  hasMore,
  isLoading,
  isLoadingMore,
  onLoadMore,
  onPrefetch,
  onSelect,
  selectedId,
}: {
  emptyState: React.ReactNode;
  entries: EntryListItemDto[];
  error: string | null;
  feedLabelsByFeedId: ReadonlyMap<string, string>;
  hasMore?: boolean | undefined;
  isLoading: boolean;
  isLoadingMore?: boolean | undefined;
  onLoadMore?: (() => void) | undefined;
  onPrefetch: (entryId: string) => void;
  onSelect: (entryId: string) => void;
  selectedId: string | null;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const loadMore = useCallback(() => {
    if (hasMore && !isLoadingMore)
      onLoadMore?.();
  }, [hasMore, isLoadingMore, onLoadMore]);

  useEffect(() => {
    if (!selectedId)
      return;

    listRef.current
      ?.querySelector(`[data-entry-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card">
      <ScrollArea className="flex-1 p-2" ref={listRef}>
        {error
          ? (
              <StatusNotice
                body={error}
                className="m-1"
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
                  <div className="flex flex-col gap-1">
                    {entries.map(entry => (
                      <button
                        aria-current={selectedId === entry.id ? "true" : undefined}
                        className={cn(
                          "flex w-full flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selectedId === entry.id
                            ? "border-primary/70 bg-accent"
                            : "border-transparent",
                        )}
                        data-entry-id={entry.id}
                        key={entry.id}
                        onClick={() => onSelect(entry.id)}
                        onFocus={() => onPrefetch(entry.id)}
                        onMouseEnter={() => onPrefetch(entry.id)}
                        type="button"
                      >
                        <div className="flex items-start gap-2">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                              entry.isRead ? "bg-transparent" : "bg-primary",
                            )}
                          />
                          <h3
                            className={cn(
                              "line-clamp-2 leading-snug",
                              entry.isRead ? "font-normal text-muted-foreground" : "font-semibold text-foreground",
                            )}
                          >
                            {entry.isRead ? null : <span className="sr-only">Unread: </span>}
                            {getEntryLabel(entry)}
                          </h3>
                        </div>
                        <p className="line-clamp-2 pl-4 text-xs leading-relaxed text-muted-foreground">{getEntryPreview(entry)}</p>
                        <div className="flex items-center justify-between gap-3 pl-4 text-xs text-muted-foreground">
                          <span className="min-w-0 truncate">{getEntryFeedLabel(entry, feedLabelsByFeedId)}</span>
                          <time
                            className="shrink-0 whitespace-nowrap tabular-nums"
                            dateTime={entry.publishedAt ?? undefined}
                            title={formatDate(entry.publishedAt)}
                          >
                            {formatListDate(entry.publishedAt)}
                          </time>
                        </div>
                      </button>
                    ))}
                    {hasMore
                      ? (
                          <>
                            <LoadMoreSentinel onVisible={loadMore} />
                            <Button
                              className="mt-1 w-full"
                              disabled={isLoadingMore}
                              onClick={loadMore}
                              type="button"
                              variant="ghost"
                            >
                              {isLoadingMore
                                ? (
                                    <>
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                      Loading...
                                    </>
                                  )
                                : "Load more"}
                            </Button>
                          </>
                        )
                      : null}
                  </div>
                )
              : emptyState}
      </ScrollArea>
    </div>
  );
}

function EntryDetailPanel({
  entry,
  error,
  feedLabelsByFeedId,
  isLoading,
  isMobile,
  nextEntry,
  onBack,
  onNext,
  onPrevious,
  onToggleRead,
  previousEntry,
}: {
  entry: EntryDto | null;
  error: string | null;
  feedLabelsByFeedId: ReadonlyMap<string, string>;
  isLoading: boolean;
  isMobile?: boolean;
  nextEntry: EntryListItemDto | null;
  onBack?: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onToggleRead: (entry: EntryDto) => void;
  previousEntry: EntryListItemDto | null;
}) {
  const showToast = useToast();
  const [activeDownload, setActiveDownload] = useState<"images" | "pdf" | null>(null);
  const articleContentRef = useRef<HTMLDivElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const entryId = entry?.id;
  // DOMPurify over a full article is expensive. Memoize on the article source
  // rather than the entry object: a read/unread toggle replaces the object but
  // leaves the content untouched, and useMemo compares string deps by value.
  const articleSource = entry ? getEntryArticleHtml(entry) : null;
  const articleHtml = useMemo(
    () => articleSource === null ? null : sanitizeArticleHtml(articleSource),
    [articleSource],
  );
  const imageHtml = entry ? getEntryImageHtml(entry) : null;
  const imageSources = useMemo(() => imageHtml ? getImageSourcesFromHtml(imageHtml) : [], [imageHtml]);
  const getRenderedImageSources = useCallback(() => {
    const renderedSources = Array.from(articleContentRef.current?.querySelectorAll("img") ?? [])
      .map(image => image.currentSrc || image.src)
      .filter((source): source is string => !!source);

    return renderedSources.length ? renderedSources : imageSources;
  }, [imageSources]);
  const handleDownload = useCallback(async (kind: "images" | "pdf") => {
    if (!entry)
      return;

    setActiveDownload(kind);

    try {
      if (kind === "images") {
        const download = await api.downloadEntryImagesZip(entry.id, getRenderedImageSources());
        downloadBlob(download.blob, download.filename ?? "rss-boi-images.zip");
      }
      else {
        const download = await api.downloadEntryPdf(entry.id, getRenderedImageSources());
        downloadBlob(download.blob, download.filename ?? "rss-boi-post.pdf");
      }
    }
    catch (downloadError) {
      showToast(
        getErrorMessage(downloadError, kind === "images" ? "Couldn't download the post's images." : "Couldn't create a PDF of this post."),
        "error",
      );
    }
    finally {
      setActiveDownload(null);
    }
  }, [entry, getRenderedImageSources, showToast]);

  useEffect(() => {
    if (!entryId)
      return;

    scrollAreaRef.current?.scrollTo({ top: 0 });

    if (isMobile)
      headingRef.current?.focus({ preventScroll: true });
  }, [entryId, isMobile]);

  const readToggleLabel = entry?.isRead ? "Mark unread" : "Mark read";
  const ReadToggleIcon = entry?.isRead ? CircleDot : Check;

  return (
    <section
      aria-label="Article"
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-card",
        isMobile ? "" : "rounded-xl",
      )}
    >
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
                  {isMobile
                    ? null
                    : (
                        <div className="flex flex-none items-center justify-between gap-2 border-b border-border px-3 py-2">
                          <div className="flex items-center gap-1">
                            <Button
                              aria-label="Previous article"
                              disabled={!previousEntry}
                              onClick={onPrevious}
                              size="icon"
                              title="Previous article (k)"
                              variant="ghost"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </Button>
                            <Button
                              aria-label="Next article"
                              disabled={!nextEntry}
                              onClick={onNext}
                              size="icon"
                              title="Next article (j)"
                              variant="ghost"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button onClick={() => onToggleRead(entry)} size="sm" title={`${readToggleLabel} (m)`} variant="ghost">
                              <ReadToggleIcon className="h-4 w-4" />
                              {readToggleLabel}
                            </Button>
                            {entry.url
                              ? (
                                  <Button asChild size="sm" title="Open the original post (o)" variant="ghost">
                                    <a href={entry.url} rel="noreferrer" target="_blank">
                                      <ExternalLink className="h-4 w-4" />
                                      Open original
                                    </a>
                                  </Button>
                                )
                              : null}
                          </div>
                        </div>
                      )}

                  <ScrollArea className="flex-1" ref={scrollAreaRef}>
                    <article className="mx-auto max-w-[68ch] px-5 pb-12 pt-7 sm:px-8 sm:pt-12">
                      <header className="mb-8 space-y-3">
                        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                          <span className="font-medium text-foreground/80">{getEntryFeedLabel(entry, feedLabelsByFeedId)}</span>
                          <span aria-hidden="true">&middot;</span>
                          <time dateTime={entry.publishedAt ?? undefined}>{formatDate(entry.publishedAt)}</time>
                        </p>
                        <h2
                          className="font-reading text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.015em] text-balance text-foreground focus:outline-none sm:text-[2.125rem]"
                          ref={headingRef}
                          tabIndex={-1}
                        >
                          {getEntryLabel(entry)}
                        </h2>
                      </header>

                      <div
                        className="prose-article"
                        dangerouslySetInnerHTML={{ __html: articleHtml ?? "" }}
                        ref={articleContentRef}
                      />

                      <footer className="mt-14 space-y-6 border-t border-border pt-6">
                        <div className="flex flex-wrap gap-2">
                          {entry.url
                            ? (
                                <Button asChild size="sm" variant="outline">
                                  <a href={entry.url} rel="noreferrer" target="_blank">
                                    <ExternalLink className="h-4 w-4" />
                                    Open original
                                  </a>
                                </Button>
                              )
                            : null}
                          <Button disabled={activeDownload !== null} onClick={() => void handleDownload("pdf")} size="sm" variant="ghost">
                            <FileText className="h-4 w-4" />
                            {activeDownload === "pdf" ? "Preparing PDF..." : "Save as PDF"}
                          </Button>
                          {imageSources.length > 0
                            ? (
                                <Button disabled={activeDownload !== null} onClick={() => void handleDownload("images")} size="sm" variant="ghost">
                                  <Download className="h-4 w-4" />
                                  {activeDownload === "images" ? "Preparing images..." : "Download images"}
                                </Button>
                              )
                            : null}
                        </div>
                        {nextEntry
                          ? (
                              <button
                                className="group flex w-full items-center justify-between gap-4 rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={onNext}
                                type="button"
                              >
                                <span className="min-w-0 space-y-0.5">
                                  <span className="block text-xs text-muted-foreground">Next article</span>
                                  <span className="block truncate font-medium text-foreground">{getEntryLabel(nextEntry)}</span>
                                </span>
                                <ChevronDown className="h-4 w-4 shrink-0 -rotate-90 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                              </button>
                            )
                          : (
                              <p className="text-sm text-muted-foreground">That's the last article in this list.</p>
                            )}
                      </footer>
                    </article>
                  </ScrollArea>

                  {isMobile
                    ? (
                        <div className="flex flex-none items-center justify-between border-t border-border bg-background/95 px-1 backdrop-blur">
                          <Button aria-label="Back to list" onClick={onBack} size="icon-lg" variant="ghost">
                            <ArrowLeft className="h-5 w-5" />
                          </Button>
                          <div className="flex items-center">
                            <Button aria-label="Previous article" disabled={!previousEntry} onClick={onPrevious} size="icon-lg" variant="ghost">
                              <ChevronUp className="h-5 w-5" />
                            </Button>
                            <Button aria-label="Next article" disabled={!nextEntry} onClick={onNext} size="icon-lg" variant="ghost">
                              <ChevronDown className="h-5 w-5" />
                            </Button>
                            <Button aria-label={readToggleLabel} onClick={() => onToggleRead(entry)} size="icon-lg" variant="ghost">
                              <ReadToggleIcon className="h-5 w-5" />
                            </Button>
                            {entry.url
                              ? (
                                  <Button aria-label="Open original" asChild size="icon-lg" variant="ghost">
                                    <a href={entry.url} rel="noreferrer" target="_blank">
                                      <ExternalLink className="h-5 w-5" />
                                    </a>
                                  </Button>
                                )
                              : null}
                          </div>
                        </div>
                      )
                    : null}
                </>
              )
            : (
                <div className="flex flex-1 items-center justify-center">
                  <EmptyState
                    body="Pick an article from the list, or press j to start reading."
                    icon={BookOpen}
                    title="Nothing selected"
                  />
                </div>
              )}
    </section>
  );
}

function ReaderView({
  canMarkAllRead,
  debugPanel,
  detailError,
  emptyState,
  entries,
  entriesError,
  feedHealth,
  feedLabelsByFeedId,
  feedName,
  hasMoreEntries,
  isDesktop,
  isDetailLoading,
  isEntriesLoading,
  isLoadingMoreEntries,
  isMarkAllArmed,
  isMarkingAllRead,
  mode,
  nextEntry,
  onCloseDetail,
  onLoadMoreEntries,
  onMarkAllRead,
  onNext,
  onPrefetch,
  onPrevious,
  onRefresh,
  onSelect,
  onToggleDebug,
  onToggleRead,
  previousEntry,
  refreshLabel,
  selectedEntry,
  selectedId,
  showDebug,
  unreadCount,
}: {
  canMarkAllRead?: boolean;
  debugPanel?: React.ReactNode;
  detailError: string | null;
  emptyState: React.ReactNode;
  entries: EntryListItemDto[];
  entriesError: string | null;
  feedHealth: ReturnType<typeof getFeedHealth> | undefined;
  feedLabelsByFeedId: ReadonlyMap<string, string>;
  feedName: string | undefined;
  hasMoreEntries?: boolean | undefined;
  isDesktop: boolean;
  isDetailLoading: boolean;
  isEntriesLoading: boolean;
  isLoadingMoreEntries?: boolean | undefined;
  isMarkAllArmed: boolean;
  isMarkingAllRead: boolean;
  mode: "all" | "today" | "unread";
  nextEntry: EntryListItemDto | null;
  onCloseDetail: () => void;
  onLoadMoreEntries?: (() => void) | undefined;
  onMarkAllRead?: (() => void) | undefined;
  onNext: () => void;
  onPrefetch: (entryId: string) => void;
  onPrevious: () => void;
  onRefresh?: (() => void) | undefined;
  onSelect: (entryId: string) => void;
  onToggleDebug?: (() => void) | undefined;
  onToggleRead: (entry: EntryDto) => void;
  previousEntry: EntryListItemDto | null;
  refreshLabel?: string | undefined;
  selectedEntry: EntryDto | null;
  selectedId: string | null;
  showDebug?: boolean;
  unreadCount: number;
}) {
  const title = feedName
    ?? (mode === "unread"
      ? "Unread"
      : mode === "today"
        ? "Today"
        : "All entries");
  const description = feedName
    ? feedHealth?.detail
    : mode === "unread"
      ? "Posts you haven't read yet, newest first."
      : mode === "today"
        ? "Everything your feeds published today."
        : "The latest posts from all your feeds.";
  const isMobileDetailOpen = !isDesktop && !!selectedId;
  const hasActions = !!(onRefresh || onMarkAllRead || onToggleDebug);
  const detailProps = {
    entry: selectedEntry,
    error: detailError,
    feedLabelsByFeedId,
    isLoading: isDetailLoading,
    nextEntry,
    onNext,
    onPrevious,
    onToggleRead,
    previousEntry,
  };
  const listPanel = (
    <EntryListPanel
      emptyState={emptyState}
      entries={entries}
      error={entriesError}
      feedLabelsByFeedId={feedLabelsByFeedId}
      hasMore={hasMoreEntries}
      isLoading={isEntriesLoading}
      isLoadingMore={isLoadingMoreEntries}
      onLoadMore={onLoadMoreEntries}
      onPrefetch={onPrefetch}
      onSelect={onSelect}
      selectedId={selectedId}
    />
  );

  return (
    <div className="flex flex-col gap-4 sm:gap-5 lg:min-h-[36rem] lg:flex-1">
      {isDesktop || !isMobileDetailOpen
        ? (
            <PageHeader
              actions={hasActions
                ? (
                    <>
                      {feedHealth && feedHealth.label !== "Healthy"
                        ? <Badge variant={feedHealth.variant}>{feedHealth.label}</Badge>
                        : null}
                      {onMarkAllRead
                        ? (
                            <Button
                              disabled={!canMarkAllRead}
                              onClick={onMarkAllRead}
                              size="sm"
                              title="Mark all as read (Shift+A)"
                              variant={isMarkAllArmed ? "default" : "outline"}
                            >
                              <CheckCheck className="h-4 w-4" />
                              {isMarkingAllRead
                                ? "Marking..."
                                : isMarkAllArmed
                                  ? `Mark ${unreadCount} as read?`
                                  : "Mark all as read"}
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
                            <Button aria-pressed={showDebug} onClick={onToggleDebug} size="sm" variant="ghost">
                              <Terminal className="h-4 w-4" />
                              Diagnostics
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

      {isDesktop
        ? (
            <div className="grid min-h-[28rem] flex-1 grid-cols-[minmax(320px,400px)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-4">
              {listPanel}
              <EntryDetailPanel {...detailProps} />
            </div>
          )
        : (
            <div className="relative min-h-[calc(100dvh-13rem)]">
              <div
                className={cn("h-full transition-opacity", isMobileDetailOpen ? "pointer-events-none opacity-0" : "opacity-100")}
                inert={isMobileDetailOpen}
              >
                {listPanel}
              </div>

              {isMobileDetailOpen
                ? (
                    <div className="fixed inset-x-0 bottom-[var(--mobile-nav-height)] top-[var(--mobile-header-height)] z-20">
                      <EntryDetailPanel {...detailProps} isMobile onBack={onCloseDetail} />
                    </div>
                  )
                : null}
            </div>
          )}

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
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
            <Rss aria-hidden="true" className="h-4 w-4 text-primary" />
            RSS Boi
          </div>
          <h1 className="text-2xl font-semibold leading-none tracking-tight">{title}</h1>
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

function FormError({ error }: { error: Error | null }) {
  if (!error)
    return null;

  return (
    <div className="flex items-start gap-2 text-sm text-destructive" role="alert">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">{error.message}</span>
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
      action="Don't have an account? Ask the person who runs this RSS Boi server to create one for you."
      description="Sign in to pick up your feeds where you left off."
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
            autoComplete="email"
            id="login-email"
            onChange={event => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="login-password">Password</Label>
          <Input
            autoComplete="current-password"
            id="login-password"
            onChange={event => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </div>
        <FormError error={loginMutation.error} />
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
  const [confirmPassword, setConfirmPassword] = useState("");
  const [instanceName, setInstanceName] = useState("RSS Boi");
  const [defaultPollMinutes, setDefaultPollMinutes] = useState("30");
  const passwordsMatch = !confirmPassword || password === confirmPassword;
  const setupMutation = useMutation({
    mutationFn: () => api.setup({ defaultPollMinutes: Number(defaultPollMinutes), email, instanceName, password }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["setup-status"] });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/feeds");
    },
  });

  return (
    <AuthCard
      action="Setup only runs once. After this, new accounts are added by the server admin."
      description="Create the admin account for this server. You'll add your first feed next."
      title="Welcome to RSS Boi"
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();

          if (password !== confirmPassword)
            return;

          setupMutation.mutate();
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="setup-name">Server name</Label>
          <Input
            id="setup-name"
            onChange={event => setInstanceName(event.target.value)}
            required
            value={instanceName}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="setup-email">Your email</Label>
          <Input
            autoComplete="email"
            id="setup-email"
            onChange={event => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="setup-password">Password</Label>
          <Input
            aria-describedby="setup-password-hint"
            autoComplete="new-password"
            id="setup-password"
            minLength={8}
            onChange={event => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          <p className="text-xs text-muted-foreground" id="setup-password-hint">At least 8 characters.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="setup-password-confirm">Confirm password</Label>
          <Input
            aria-describedby={passwordsMatch ? undefined : "setup-password-mismatch"}
            aria-invalid={!passwordsMatch}
            autoComplete="new-password"
            id="setup-password-confirm"
            onChange={event => setConfirmPassword(event.target.value)}
            required
            type="password"
            value={confirmPassword}
          />
          {passwordsMatch
            ? null
            : <p className="text-xs text-destructive" id="setup-password-mismatch">The passwords don't match.</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="setup-poll">Check feeds every (minutes)</Label>
          <Input
            aria-describedby="setup-poll-hint"
            id="setup-poll"
            inputMode="numeric"
            min={5}
            onChange={event => setDefaultPollMinutes(event.target.value)}
            required
            type="number"
            value={defaultPollMinutes}
          />
          <p className="text-xs text-muted-foreground" id="setup-poll-hint">At least 5. You can change this later in Settings.</p>
        </div>
        <FormError error={setupMutation.error} />
        <Button disabled={setupMutation.isPending || !passwordsMatch} type="submit">
          {setupMutation.isPending ? "Creating..." : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}

function SubscriptionForm({
  onCancel,
  onSaved,
  subscription,
}: {
  onCancel?: () => void;
  onSaved?: () => void;
  subscription?: SubscriptionDto;
}) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const id = useId();
  const [url, setUrl] = useState(subscription?.feed.url ?? "");
  const [displayName, setDisplayName] = useState(subscription?.displayName ?? "");
  const [includeInAggregateViews, setIncludeInAggregateViews] = useState(subscription?.includeInAggregateViews ?? true);
  const [overridePollMinutes, setOverridePollMinutes] = useState<number | "">(subscription?.overridePollMinutes ?? "");
  const [overrideFetchTimeoutSeconds, setOverrideFetchTimeoutSeconds] = useState<number | "">(subscription?.overrideFetchTimeoutSeconds ?? "");
  const hasAdvancedOverrides = !!subscription
    && (!subscription.includeInAggregateViews || subscription.overridePollMinutes !== null || subscription.overrideFetchTimeoutSeconds !== null);

  const mutation = useMutation({
    mutationFn: () => {
      const input = {
        displayName: displayName || null,
        includeInAggregateViews,
        overrideFetchTimeoutSeconds: overrideFetchTimeoutSeconds === "" ? null : overrideFetchTimeoutSeconds,
        overridePollMinutes: overridePollMinutes === "" ? null : overridePollMinutes,
        url,
      };

      return subscription
        ? api.updateSubscription(subscription.id, input)
        : api.createSubscription(input);
    },
    onSuccess: async (saved) => {
      if (!subscription) {
        setUrl("");
        setDisplayName("");
        setIncludeInAggregateViews(true);
        setOverridePollMinutes("");
        setOverrideFetchTimeoutSeconds("");
      }
      showToast(subscription
        ? `Saved changes to ${getFeedLabel(saved)}.`
        : `Added ${getFeedLabel(saved)}. New posts will appear once it's checked.`);
      onSaved?.();
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      await queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-url`}>Feed URL</Label>
          <Input
            id={`${id}-url`}
            inputMode="url"
            onChange={event => setUrl(event.target.value)}
            placeholder="https://example.com/feed.xml"
            required
            value={url}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-name`}>Name (optional)</Label>
          <Input
            id={`${id}-name`}
            onChange={event => setDisplayName(event.target.value)}
            placeholder="Uses the feed's own title"
            value={displayName}
          />
        </div>
      </div>
      <details className="group" open={hasAdvancedOverrides || undefined}>
        <summary className="w-fit cursor-pointer select-none rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Advanced options
        </summary>
        <div className="mt-4 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-interval`}>Check every (minutes)</Label>
              <Input
                id={`${id}-interval`}
                inputMode="numeric"
                min={5}
                onChange={event => setOverridePollMinutes(event.target.value ? Number(event.target.value) : "")}
                placeholder="Use the default"
                type="number"
                value={overridePollMinutes}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-timeout`}>Give up after (seconds)</Label>
              <Input
                id={`${id}-timeout`}
                inputMode="numeric"
                max={60}
                min={5}
                onChange={event => setOverrideFetchTimeoutSeconds(event.target.value ? Number(event.target.value) : "")}
                placeholder="Default (15)"
                type="number"
                value={overrideFetchTimeoutSeconds}
              />
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-border px-3 py-3 text-sm">
            <input
              checked={includeInAggregateViews}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              onChange={event => setIncludeInAggregateViews(event.target.checked)}
              type="checkbox"
            />
            <span className="space-y-1">
              <span className="block font-medium text-foreground">Show in All, Today and Unread</span>
              <span className="block text-muted-foreground">
                Turn this off to read this feed only from its own page.
              </span>
            </span>
          </label>
        </div>
      </details>
      <FormError error={mutation.error} />
      <div className="flex gap-2">
        <Button disabled={mutation.isPending} type="submit">
          {mutation.isPending
            ? (subscription ? "Saving..." : "Adding...")
            : (subscription ? "Save changes" : "Add feed")}
        </Button>
        {onCancel
          ? (
              <Button
                onClick={onCancel}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            )
          : null}
      </div>
    </form>
  );
}

function FeedsPage() {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const showToast = useToast();
  const subscriptionsQuery = useQuery({
    queryFn: api.getSubscriptions,
    queryKey: ["subscriptions"],
    retry: false,
    staleTime: READER_STALE_TIME_MS,
  });
  const subscriptions = useMemo(() => subscriptionsQuery.data ?? [], [subscriptionsQuery.data]);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showFailingOnly, setShowFailingOnly] = useState(false);

  const sortedSubscriptions = useMemo(
    () =>
      [...subscriptions].sort((left, right) =>
        getFeedLabel(left).localeCompare(getFeedLabel(right), undefined, { sensitivity: "base" })),
    [subscriptions],
  );
  const failingCount = useMemo(
    () => subscriptions.filter(isFeedFailing).length,
    [subscriptions],
  );
  const visibleSubscriptions = useMemo(() => {
    const query = search.trim().toLowerCase();

    return sortedSubscriptions.filter((subscription) => {
      if (showFailingOnly && !isFeedFailing(subscription))
        return false;

      if (!query)
        return true;

      return [getFeedLabel(subscription), subscription.feed.title, subscription.feed.url]
        .some(value => value?.toLowerCase().includes(query));
    });
  }, [search, showFailingOnly, sortedSubscriptions]);

  const deleteMutation = useMutation({
    mutationFn: (subscription: SubscriptionDto) => api.deleteSubscription(subscription.id),
    onError: (error, subscription) => {
      showToast(`Couldn't remove ${getFeedLabel(subscription)}. ${getErrorMessage(error, "Try again.")}`, "error");
    },
    onSuccess: async (_, subscription) => {
      showToast(`Removed ${getFeedLabel(subscription)}.`);
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      await queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: (subscription: SubscriptionDto) => api.refreshSubscription(subscription.id),
    onError: (error, subscription) => {
      showToast(`Couldn't refresh ${getFeedLabel(subscription)}. ${getErrorMessage(error, "Try again.")}`, "error");
    },
    onSuccess: async (_, subscription) => {
      showToast(`Checking ${getFeedLabel(subscription)} for new posts.`);
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      await queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });
  const exportMutation = useMutation({
    mutationFn: api.exportSubscriptions,
    onError: (error) => {
      showToast(`Couldn't export your feeds. ${getErrorMessage(error, "Try again.")}`, "error");
    },
    onSuccess: (payload) => {
      const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
      const timestamp = new Date().toISOString().slice(0, 10);

      downloadBlob(blob, `rss-boi-feeds-${timestamp}.json`);
      showToast(`Exported ${payload.subscriptions.length} feed${payload.subscriptions.length === 1 ? "" : "s"}.`);
    },
  });
  const importMutation = useMutation({
    mutationFn: (payload: SubscriptionTransferDto) => api.importSubscriptions(payload),
    onError: (error) => {
      showToast(`Couldn't import feeds. ${getErrorMessage(error, "Try again.")}`, "error");
    },
    onSuccess: async (result) => {
      showToast(`Imported feeds: ${result.created} added, ${result.updated} updated.`);
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      await queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });

  const handleImportFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file)
      return;

    try {
      const text = await file.text();
      const payload = subscriptionTransferSchema.parse(JSON.parse(text));
      importMutation.mutate(payload);
    }
    catch {
      showToast("That file isn't an RSS Boi feed export. Choose a .json file exported from the Feeds page.", "error");
    }
  }, [importMutation, showToast]);

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
              onClick={() => exportMutation.mutate()}
              size="sm"
              variant="outline"
            >
              <Download className="h-4 w-4" />
              {exportMutation.isPending ? "Exporting..." : "Export feeds"}
            </Button>
            <Button
              disabled={importMutation.isPending}
              onClick={() => importInputRef.current?.click()}
              size="sm"
              variant="outline"
            >
              <Upload className="h-4 w-4" />
              {importMutation.isPending ? "Importing..." : "Import feeds"}
            </Button>
          </>
        )}
        description="Add and manage the feeds you follow. Your list and read state are private to your account."
        title="Feeds"
      />

      {subscriptionsQuery.error && subscriptions.length
        ? (
            <StatusNotice
              body={getQueryErrorMessage(subscriptionsQuery.error, isOnline)}
              icon={WifiOff}
              title="Couldn't refresh your feeds"
            />
          )
        : null}

      <Card>
        <CardHeader className="pb-4">
          <h2 className="font-semibold leading-none tracking-tight">Add a feed</h2>
        </CardHeader>
        <CardContent>
          <SubscriptionForm />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-1">
            <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search feeds"
                  className="pl-9"
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search feeds"
                  type="search"
                  value={search}
                />
              </div>
              <Button
                aria-pressed={showFailingOnly}
                onClick={() => setShowFailingOnly(current => !current)}
                size="sm"
                variant={showFailingOnly ? "default" : "outline"}
              >
                <AlertCircle className="h-3.5 w-3.5" />
                {failingCount > 0 ? `Errors only (${failingCount})` : "Errors only"}
              </Button>
            </div>

            {subscriptionsQuery.error && !subscriptions.length
              ? (
                  <div className="p-4">
                    <StatusNotice
                      body={getQueryErrorMessage(subscriptionsQuery.error, isOnline)}
                      icon={WifiOff}
                      title="Your feeds are unavailable right now"
                    />
                  </div>
                )
              : visibleSubscriptions.length
                ? visibleSubscriptions.map((subscription) => {
                    if (editingId === subscription.id) {
                      return (
                        <div className="border-b border-border px-4 py-4 last:border-b-0" key={subscription.id}>
                          <SubscriptionForm
                            onCancel={() => setEditingId(null)}
                            onSaved={() => setEditingId(null)}
                            subscription={subscription}
                          />
                        </div>
                      );
                    }

                    const health = getFeedHealth(subscription);
                    const isRefreshing = refreshMutation.isPending && refreshMutation.variables?.id === subscription.id;

                    return (
                      <div
                        className="grid grid-cols-1 items-center gap-3 border-b border-border px-4 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-6"
                        key={subscription.id}
                      >
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <NavLink
                              className="min-w-0 truncate font-medium text-foreground transition-colors hover:text-primary"
                              to={`/feeds/${subscription.feed.id}`}
                            >
                              {getFeedLabel(subscription)}
                            </NavLink>
                            {subscription.unreadCount > 0
                              ? (
                                  <Badge variant="secondary" className="shrink-0 tabular-nums">
                                    {subscription.unreadCount}
                                    <span className="sr-only"> unread</span>
                                  </Badge>
                                )
                              : null}
                          </div>
                          <span className="truncate text-xs text-muted-foreground">{subscription.feed.url}</span>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            {health.label === "Healthy"
                              ? null
                              : <Badge variant={health.variant}>{health.label}</Badge>}
                            {subscription.includeInAggregateViews
                              ? null
                              : <Badge variant="outline">Own page only</Badge>}
                            <span className={cn("min-w-0 break-words", health.label === "Failing" && "text-destructive")}>
                              {health.detail}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground" title="How often this feed is checked">
                          <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                          <span className="sr-only">Checked every </span>
                          {subscription.effectivePollMinutes}
                          {" "}
                          min
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            onClick={() => setEditingId(subscription.id)}
                            size="sm"
                            variant="outline"
                          >
                            Edit
                          </Button>
                          <Button
                            disabled={isRefreshing}
                            onClick={() => refreshMutation.mutate(subscription)}
                            size="sm"
                            variant="ghost"
                          >
                            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
                            Refresh
                          </Button>
                          <Button
                            className="text-destructive hover:text-destructive"
                            disabled={deleteMutation.isPending && deleteMutation.variables?.id === subscription.id}
                            onClick={() => {
                              // eslint-disable-next-line no-alert
                              if (window.confirm(`Remove ${getFeedLabel(subscription)} from your feeds?`))
                                deleteMutation.mutate(subscription);
                            }}
                            size="sm"
                            variant="ghost"
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    );
                  })
                : subscriptions.length
                  ? (
                      <EmptyState
                        body={showFailingOnly && !search.trim()
                          ? "All your feeds are working."
                          : "Try a different search, or clear the filters."}
                        icon={Search}
                        title={showFailingOnly && !search.trim() ? "No errors" : "No matching feeds"}
                      />
                    )
                  : subscriptionsQuery.isLoading
                    ? (
                        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                          Loading feeds...
                        </div>
                      )
                    : (
                        <EmptyState
                          body="Paste a feed URL above to start collecting posts."
                          icon={Rss}
                          title="No feeds yet"
                        />
                      )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsPage({ onLogout }: { onLogout: () => void }) {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const showToast = useToast();
  const settingsQuery = useQuery({
    queryFn: api.getSettings,
    queryKey: ["settings"],
    retry: false,
  });
  const [defaultPollMinutes, setDefaultPollMinutes] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const effectiveDefaultPollMinutes = defaultPollMinutes ?? String(settingsQuery.data?.defaultPollMinutes ?? 30);

  const settingsMutation = useMutation({
    mutationFn: () => api.updateSettings(Number(effectiveDefaultPollMinutes)),
    onSuccess: async () => {
      showToast(`Feeds will be checked every ${effectiveDefaultPollMinutes} minutes.`);
      setDefaultPollMinutes(null);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: () => api.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      showToast("Password changed.");
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
            <h2 className="font-semibold leading-none tracking-tight">Checking for new posts</h2>
            <CardDescription>The default for every feed. Individual feeds can override it.</CardDescription>
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
                <Label htmlFor="settings-poll">Check feeds every (minutes)</Label>
                <Input
                  disabled={!settingsQuery.data}
                  id="settings-poll"
                  inputMode="numeric"
                  min={5}
                  onChange={event => setDefaultPollMinutes(event.target.value)}
                  required
                  type="number"
                  value={effectiveDefaultPollMinutes}
                />
              </div>
              <FormError error={settingsMutation.error} />
              <Button className="w-fit" disabled={!settingsQuery.data || settingsMutation.isPending} type="submit">
                {settingsMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold leading-none tracking-tight">Password</h2>
            <CardDescription>Change the password you sign in with.</CardDescription>
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
                  autoComplete="current-password"
                  disabled={!settingsQuery.data}
                  id="settings-current-pw"
                  onChange={event => setCurrentPassword(event.target.value)}
                  required
                  type="password"
                  value={currentPassword}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="settings-new-pw">New password</Label>
                <Input
                  aria-describedby="settings-new-pw-hint"
                  autoComplete="new-password"
                  disabled={!settingsQuery.data}
                  id="settings-new-pw"
                  minLength={8}
                  onChange={event => setNewPassword(event.target.value)}
                  required
                  type="password"
                  value={newPassword}
                />
                <p className="text-xs text-muted-foreground" id="settings-new-pw-hint">At least 8 characters.</p>
              </div>
              <FormError error={passwordMutation.error} />
              <Button className="w-fit" disabled={!settingsQuery.data || passwordMutation.isPending} type="submit">
                {passwordMutation.isPending ? "Changing..." : "Change password"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:hidden">
          <CardHeader>
            <h2 className="font-semibold leading-none tracking-tight">Account</h2>
            <CardDescription>Sign out of RSS Boi on this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="text-destructive hover:text-destructive" onClick={onLogout} variant="outline">
              <LogOut className="h-4 w-4" />
              Log out
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FeedRoute({
  feedLabelsByFeedId,
  subscriptions,
  subscriptionsLoaded,
}: {
  feedLabelsByFeedId: ReadonlyMap<string, string>;
  subscriptions: SubscriptionDto[];
  subscriptionsLoaded: boolean;
}) {
  const { feedId } = useParams();
  const subscription = subscriptions.find(item => item.feed.id === feedId);

  if (subscriptionsLoaded && !subscription) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Feed not found" />
        <EmptyState
          action={(
            <Button asChild variant="outline">
              <Link to="/feeds">Go to Feeds</Link>
            </Button>
          )}
          body="This feed isn't in your list. It may have been removed."
          icon={Rss}
          title="Feed not found"
        />
      </div>
    );
  }

  return (
    <ReaderRoute
      feedHealth={subscription ? getFeedHealth(subscription) : undefined}
      feedId={feedId}
      feedLabelsByFeedId={feedLabelsByFeedId}
      feedName={subscription ? getFeedLabel(subscription) : undefined}
      mode="all"
      subscription={subscription}
      subscriptionCount={subscriptions.length}
      subscriptionsLoaded={subscriptionsLoaded}
      unreadCount={subscription?.unreadCount ?? 0}
    />
  );
}

function getReaderEmptyState({
  feedName,
  hasNoSubscriptions,
  mode,
}: {
  feedName: string | undefined;
  hasNoSubscriptions: boolean;
  mode: "all" | "today" | "unread";
}) {
  if (hasNoSubscriptions) {
    return (
      <EmptyState
        action={(
          <Button asChild>
            <Link to="/feeds">Add a feed</Link>
          </Button>
        )}
        body="Follow a blog, newsletter or news site and its posts will show up here."
        icon={Rss}
        title="Add your first feed"
      />
    );
  }

  if (mode === "unread")
    return <EmptyState body="New posts will show up here as your feeds update." icon={CheckCheck} title="You're all caught up" />;

  if (mode === "today")
    return <EmptyState body="Nothing has been published today yet. Check back later." icon={CalendarDays} title="Quiet day so far" />;

  if (feedName)
    return <EmptyState body="New posts will show up here after the next check." icon={Inbox} title="No posts yet" />;

  return <EmptyState body="Your feeds haven't published anything yet. New posts will show up after the next check." icon={Inbox} title="No posts yet" />;
}

function ReaderRoute({
  feedHealth,
  feedId,
  feedLabelsByFeedId,
  feedName,
  mode,
  subscription,
  subscriptionCount,
  subscriptionsLoaded,
  unreadCount,
}: {
  feedHealth: ReturnType<typeof getFeedHealth> | undefined;
  feedId: string | undefined;
  feedLabelsByFeedId: ReadonlyMap<string, string>;
  feedName: string | undefined;
  mode: "all" | "today" | "unread";
  subscription?: SubscriptionDto | undefined;
  subscriptionCount: number;
  subscriptionsLoaded: boolean;
  unreadCount: number;
}) {
  const showToast = useToast();
  const isDesktop = useIsDesktop();
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [debugOpen, setDebugOpen] = useState(false);
  const [isMarkAllArmed, setIsMarkAllArmed] = useState(false);
  const suppressAutoReadRef = useRef(new Set<string>());
  const lastAutoMarkedRef = useRef<string | null>(null);
  const pendingMarkReadRef = useRef(new Set<string>());
  const selectedEntryRef = useRef<ReadStateTarget | null>(null);
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
  const entriesQuery = useInfiniteQuery<EntryListDto, Error, InfiniteData<EntryListDto>, QueryKey, string | undefined>({
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam }) =>
      api.getEntries({
        ...(feedId ? { feedId } : {}),
        ...(mode === "unread" ? { status: "unread" as const } : { status: "all" as const }),
        ...(todayRange ?? {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    queryKey: ["entries", { feedId, mode, ...todayRange }],
    retry: false,
    // Entries only change when the worker polls, so navigating between feeds
    // should reuse the cached list rather than refetch it immediately.
    staleTime: READER_STALE_TIME_MS,
  });
  const entries = useMemo(
    () => entriesQuery.data?.pages.flatMap(page => page.entries) ?? [],
    [entriesQuery.data],
  );
  const selectedListItem = useMemo(
    () => entries.find(entry => entry.id === selectedId) ?? null,
    [entries, selectedId],
  );
  const selectedEntryQuery = useQuery({
    enabled: !!selectedId,
    queryFn: () => api.getEntry(selectedId!),
    queryKey: ["entry", selectedId],
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: ARTICLE_STALE_TIME_MS,
  });
  // Bulk actions refetch the list but not cached articles, so the list item
  // is the source of truth for read state whenever it is loaded.
  const selectedListIsRead = selectedListItem?.isRead;
  const selectedEntry = useMemo(() => {
    const article = selectedEntryQuery.data;

    if (!article)
      return null;

    return selectedListIsRead === undefined || selectedListIsRead === article.isRead
      ? article
      : { ...article, isRead: selectedListIsRead };
  }, [selectedEntryQuery.data, selectedListIsRead]);
  const selectedReadState: ReadStateTarget | null = selectedListItem ?? selectedEntry;
  const prefetchEntry = useCallback((entryId: string) => {
    void queryClient.prefetchQuery({
      queryFn: () => api.getEntry(entryId),
      queryKey: ["entry", entryId],
      staleTime: ARTICLE_STALE_TIME_MS,
    });
  }, [queryClient]);
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

  // A read/unread toggle only flips one boolean, so patch the cached pages,
  // the cached article and the sidebar unread count in place. Invalidating
  // ["entries"] or ["subscriptions"] here refetched every loaded page and
  // re-counted every feed on each click, which is what made selecting entries
  // lag.
  const setCachedEntryRead = useCallback((target: ReadStateTarget, isRead: boolean) => {
    if (target.isRead === isRead)
      return;

    queryClient.setQueriesData<InfiniteData<EntryListDto>>(
      { queryKey: ["entries"] },
      (data) => {
        if (!data)
          return data;

        let changed = false;
        const pages = data.pages.map((page) => {
          if (!page.entries.some(entry => entry.id === target.id && entry.isRead !== isRead))
            return page;

          changed = true;
          return {
            ...page,
            entries: page.entries.map(entry => entry.id === target.id ? { ...entry, isRead } : entry),
          };
        });

        return changed ? { ...data, pages } : data;
      },
    );

    queryClient.setQueryData<EntryDto>(["entry", target.id], previous =>
      previous ? { ...previous, isRead } : previous);

    queryClient.setQueryData<SubscriptionDto[]>(["subscriptions"], previous =>
      previous?.map(subscription => subscription.feed.id === target.feed.id
        ? { ...subscription, unreadCount: Math.max(0, subscription.unreadCount + (isRead ? -1 : 1)) }
        : subscription));
  }, [queryClient]);

  // Optimistic patches are not rolled back write by write: a failed write
  // undoing its own patch would clobber a newer toggle still queued behind
  // it. Instead, note the failure and refetch from the server once the scoped
  // queue has drained, so every cache converges on what actually landed.
  const readStateWriteFailedRef = useRef(false);
  const markReadStateWriteFailed = useCallback(() => {
    readStateWriteFailedRef.current = true;
  }, []);
  const reconcileReadState = useCallback(() => {
    if (!readStateWriteFailedRef.current || queryClient.isMutating({ mutationKey: READ_STATE_MUTATION_KEY }) > 1)
      return;

    readStateWriteFailedRef.current = false;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["entries"] }),
      queryClient.invalidateQueries({ queryKey: ["entry"] }),
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
    ]);
  }, [queryClient]);

  // A background refetch already in flight would land after the patch and
  // overwrite it with pre-mutation state, so cancel those first. Initial
  // loads (no data yet) are left alone: cancelling them would leave the view
  // empty with nothing scheduled to retry.
  const cancelReadStateRefetches = useCallback(() => Promise.all([
    queryClient.cancelQueries({ queryKey: ["entries"], predicate: query => query.state.data !== undefined }),
    queryClient.cancelQueries({ queryKey: ["subscriptions"], predicate: query => query.state.data !== undefined }),
  ]), [queryClient]);

  const toggleReadMutation = useMutation({
    mutationFn: (entry: EntryDto) => entry.isRead ? api.markUnread(entry.id) : api.markRead(entry.id),
    mutationKey: READ_STATE_MUTATION_KEY,
    onError: markReadStateWriteFailed,
    onMutate: async (entry) => {
      await cancelReadStateRefetches();
      setCachedEntryRead(entry, !entry.isRead);
    },
    onSettled: reconcileReadState,
    scope: READ_STATE_MUTATION_SCOPE,
  });
  const markReadMutation = useMutation({
    mutationFn: (entry: ReadStateTarget) => api.markRead(entry.id),
    mutationKey: READ_STATE_MUTATION_KEY,
    onError: markReadStateWriteFailed,
    onMutate: async (entry: ReadStateTarget) => {
      await cancelReadStateRefetches();
      setCachedEntryRead(entry, true);
    },
    onSettled: reconcileReadState,
    scope: READ_STATE_MUTATION_SCOPE,
  });
  const markRead = markReadMutation.mutate;
  const markAllReadMutation = useMutation({
    mutationFn: (_count: number) => api.markAllRead(feedId ? { feedId } : {}),
    mutationKey: READ_STATE_MUTATION_KEY,
    onError: (error) => {
      markReadStateWriteFailed();
      showToast(`Couldn't mark everything as read. ${getErrorMessage(error, "Try again.")}`, "error");
    },
    onSettled: reconcileReadState,
    onSuccess: async (_, count) => {
      showToast(`Marked ${count} ${count === 1 ? "post" : "posts"} as read.`);
      await invalidateReaderData();
    },
    scope: READ_STATE_MUTATION_SCOPE,
  });
  const refreshMutation = useMutation({
    mutationFn: (id: string) => api.refreshSubscription(id),
    onError: (error) => {
      showToast(`Couldn't refresh this feed. ${getErrorMessage(error, "Try again.")}`, "error");
    },
    onSuccess: async () => {
      showToast("Checking for new posts. They'll appear here shortly.");
      await invalidateReaderData();
    },
  });
  const markEntryRead = useCallback((entry: ReadStateTarget) => {
    if (pendingMarkReadRef.current.has(entry.id))
      return;

    pendingMarkReadRef.current.add(entry.id);
    markRead(entry, {
      onSettled: () => {
        pendingMarkReadRef.current.delete(entry.id);
      },
    });
  }, [markRead]);

  useEffect(() => {
    selectedEntryRef.current = selectedReadState;
  }, [selectedReadState]);

  useEffect(() => {
    if (mode === "unread")
      return;

    if (!selectedId)
      return;

    if (selectedId === lastAutoMarkedRef.current)
      return;

    if (suppressAutoReadRef.current.has(selectedId))
      return;

    const entry = selectedReadState;
    if (!entry || entry.isRead)
      return;

    lastAutoMarkedRef.current = selectedId;
    markEntryRead(entry);
  }, [markEntryRead, mode, selectedReadState, selectedId]);

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

      markEntryRead(entry);
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

  // The API marks every unread entry in scope and cannot be undone, so the
  // first press only arms the action and a second press within a few seconds
  // confirms it. Today is excluded because the endpoint has no date scope.
  const canMarkAllRead = mode !== "today" && unreadCount > 0 && !markAllReadMutation.isPending;
  const handleMarkAllRead = useCallback(() => {
    if (!canMarkAllRead)
      return;

    if (!isMarkAllArmed) {
      setIsMarkAllArmed(true);
      return;
    }

    setIsMarkAllArmed(false);

    if (mode === "unread" && selectedId) {
      suppressAutoReadRef.current.add(selectedId);
      updateSelectedId(null);
    }

    markAllReadMutation.mutate(unreadCount);
  }, [canMarkAllRead, isMarkAllArmed, markAllReadMutation, mode, selectedId, unreadCount, updateSelectedId]);

  useEffect(() => {
    if (!isMarkAllArmed)
      return;

    const timeout = window.setTimeout(setIsMarkAllArmed, 4000, false);
    return () => window.clearTimeout(timeout);
  }, [isMarkAllArmed]);

  const selectedIndex = useMemo(
    () => selectedId ? entries.findIndex(entry => entry.id === selectedId) : -1,
    [entries, selectedId],
  );
  const previousEntry = selectedIndex > 0 ? entries[selectedIndex - 1] ?? null : null;
  const nextEntry = selectedId
    ? (selectedIndex >= 0 ? entries[selectedIndex + 1] ?? null : null)
    : entries[0] ?? null;
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = entriesQuery;

  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex >= entries.length - 3 && hasNextPage && !isFetchingNextPage)
      void fetchNextPage();
  }, [entries.length, fetchNextPage, hasNextPage, isFetchingNextPage, selectedIndex]);

  useEffect(() => {
    if (nextEntry && selectedId)
      prefetchEntry(nextEntry.id);
  }, [nextEntry, prefetchEntry, selectedId]);

  const handleNext = useCallback(() => {
    if (nextEntry)
      handleSelect(nextEntry.id);
  }, [handleSelect, nextEntry]);

  const handlePrevious = useCallback(() => {
    if (previousEntry)
      handleSelect(previousEntry.id);
  }, [handleSelect, previousEntry]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey)
        return;

      if (isEditableTarget(event.target) || isDialogOpen())
        return;

      switch (event.key) {
        case "j":
          handleNext();
          break;
        case "k":
          handlePrevious();
          break;
        case "m":
          if (!selectedEntry)
            return;
          handleToggleRead(selectedEntry);
          break;
        case "o":
          if (!selectedEntry?.url)
            return;
          window.open(selectedEntry.url, "_blank", "noopener,noreferrer");
          break;
        case "A":
          handleMarkAllRead();
          break;
        case "Escape":
          if (!selectedId)
            return;
          handleCloseDetail();
          break;
        default:
          return;
      }

      event.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCloseDetail, handleMarkAllRead, handleNext, handlePrevious, handleToggleRead, selectedEntry, selectedId]);

  const entriesError = entriesQuery.error && !entries.length
    ? getQueryErrorMessage(entriesQuery.error, isOnline)
    : null;
  const detailError = selectedId && selectedEntryQuery.error
    ? getQueryErrorMessage(selectedEntryQuery.error, isOnline)
    : null;

  return (
    <ReaderView
      canMarkAllRead={canMarkAllRead}
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
      emptyState={getReaderEmptyState({
        feedName,
        hasNoSubscriptions: subscriptionsLoaded && subscriptionCount === 0,
        mode,
      })}
      entries={entries}
      entriesError={entriesError}
      feedHealth={feedHealth}
      feedLabelsByFeedId={feedLabelsByFeedId}
      feedName={feedName}
      hasMoreEntries={hasNextPage}
      isDesktop={isDesktop}
      isDetailLoading={!!selectedId && !selectedEntry && selectedEntryQuery.isLoading}
      isEntriesLoading={entriesQuery.isLoading}
      isLoadingMoreEntries={isFetchingNextPage}
      isMarkAllArmed={isMarkAllArmed}
      isMarkingAllRead={markAllReadMutation.isPending}
      mode={mode}
      nextEntry={nextEntry}
      onCloseDetail={handleCloseDetail}
      onLoadMoreEntries={() => void fetchNextPage()}
      onMarkAllRead={mode === "today" ? undefined : handleMarkAllRead}
      onNext={handleNext}
      onPrefetch={prefetchEntry}
      onPrevious={handlePrevious}
      onRefresh={subscription ? () => refreshMutation.mutate(subscription.id) : undefined}
      onSelect={handleSelect}
      onToggleDebug={subscription ? () => setDebugOpen(value => !value) : undefined}
      onToggleRead={handleToggleRead}
      previousEntry={previousEntry}
      refreshLabel={refreshMutation.isPending ? "Checking..." : "Refresh now"}
      selectedEntry={selectedEntry}
      selectedId={selectedId}
      showDebug={debugOpen}
      unreadCount={unreadCount}
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
    staleTime: READER_STALE_TIME_MS,
  });
  const subscriptions = useMemo(() => subscriptionsQuery.data ?? [], [subscriptionsQuery.data]);
  const subscriptionsLoaded = subscriptionsQuery.isSuccess;
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
  const aggregateUnreadCount = useMemo(
    () =>
      subscriptions.reduce(
        (total, subscription) =>
          subscription.includeInAggregateViews ? total + subscription.unreadCount : total,
        0,
      ),
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

    if (aggregateUnreadCount > 0)
      navigator.setAppBadge(aggregateUnreadCount);
    else
      navigator.clearAppBadge();
  }, [aggregateUnreadCount, badgePermission, isStandaloneApp]);

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

  const readerRouteProps = {
    feedHealth: undefined,
    feedId: undefined,
    feedLabelsByFeedId,
    feedName: undefined,
    subscription: undefined,
    subscriptionCount: subscriptions.length,
    subscriptionsLoaded,
  };
  const handleLogout = () => logoutMutation.mutate();

  return (
    <ToastProvider>
      <AppShell
        onLogout={handleLogout}
        subscriptions={subscriptions}
        topNotice={badgeSetupNotice}
        unreadCount={aggregateUnreadCount}
      >
        <Routes>
          <Route element={<ReaderRoute {...readerRouteProps} mode="all" unreadCount={aggregateUnreadCount} />} path="/" />
          <Route element={<ReaderRoute {...readerRouteProps} mode="today" unreadCount={0} />} path="/today" />
          <Route element={<ReaderRoute {...readerRouteProps} mode="unread" unreadCount={aggregateUnreadCount} />} path="/unread" />
          <Route element={<Navigate replace to="/feeds" />} path="/subscriptions" />
          <Route element={<FeedsPage />} path="/feeds" />
          <Route element={<FeedRoute key={selectedFeedId} feedLabelsByFeedId={feedLabelsByFeedId} subscriptions={subscriptions} subscriptionsLoaded={subscriptionsLoaded} />} path="/feeds/:feedId" />
          <Route element={<SettingsPage onLogout={handleLogout} />} path="/settings" />
          <Route element={<Navigate replace to="/" />} path="*" />
        </Routes>
      </AppShell>
    </ToastProvider>
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
                ? "RSS Boi couldn't reach its server. Check that the API is running, then try again."
                : "You're offline, and this device hasn't saved enough to open RSS Boi without a connection."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <StatusNotice
              body={getQueryErrorMessage(sessionQuery.error ?? setupQuery.error, isOnline)}
              icon={WifiOff}
              title={isOnline ? "Server unavailable" : "No connection"}
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
