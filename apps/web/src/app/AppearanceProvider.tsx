import type { ReadingPreferences, SettingsDto } from "@rss-boi/shared";
import type { AppearanceContextValue, AppearanceSaveState } from "./appearance-context";
import type { ThemeDefinition, ThemeScheme } from "@/lib/themes";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { applyAppearance, getSystemScheme, readCachedPreferences, readStorage, removeStorage, SYSTEM_DARK_QUERY, writeCachedPreferences, writeStorage } from "@/lib/appearance";
import { resolveActiveTheme } from "@/lib/themes";
import { AppearanceContext } from "./appearance-context";

// Holds the id of the account whose changes are waiting to sync, so another
// account signing in on this device never receives them.
const PENDING_KEY = "rss-boi:reading-preferences-pending";
const SAVE_DELAY_MS = 500;

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState<ReadingPreferences>(readCachedPreferences);
  const [systemScheme, setSystemScheme] = useState<ThemeScheme>(getSystemScheme);
  const [previewTheme, setPreviewTheme] = useState<ThemeDefinition | null>(null);
  const [saveState, setSaveState] = useState<AppearanceSaveState>("idle");
  const preferencesRef = useRef(preferences);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const canSyncRef = useRef(false);
  const accountIdRef = useRef<string | null>(null);
  const isSavingRef = useRef(false);
  const saveAgainRef = useRef(false);
  const revisionRef = useRef(0);

  useEffect(() => {
    const query = window.matchMedia(SYSTEM_DARK_QUERY);
    const handleChange = () => setSystemScheme(query.matches ? "dark" : "light");

    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  useLayoutEffect(() => {
    applyAppearance(preferences, systemScheme, previewTheme);
  }, [preferences, previewTheme, systemScheme]);

  // One request at a time, so an older save can never land after a newer one.
  // A save asked for mid-flight runs once the current one finishes, with the latest preferences.
  const save = useCallback(async () => {
    if (!canSyncRef.current)
      return;

    if (isSavingRef.current) {
      saveAgainRef.current = true;
      return;
    }

    isSavingRef.current = true;
    setSaveState("saving");

    try {
      do {
        saveAgainRef.current = false;
        const revision = revisionRef.current;
        const accountId = accountIdRef.current;
        const settings = await api.updateSettings({ readingPreferences: preferencesRef.current });

        // Ignore a response that lands after a different account has signed in,
        // then carry on with any save that account queued in the meantime.
        if (accountId !== accountIdRef.current)
          continue;

        if (revision === revisionRef.current && !saveAgainRef.current) {
          removeStorage(PENDING_KEY);
          queryClient.setQueryData<SettingsDto>(["settings"], settings);
          setSaveState("saved");
        }
      } while (saveAgainRef.current);
    }
    catch {
      saveAgainRef.current = false;
      setSaveState("error");
    }
    finally {
      isSavingRef.current = false;
    }
  }, [queryClient]);

  // Changes made offline stay on this device and sync once the connection is back.
  useEffect(() => {
    const handleOnline = () => {
      if (accountIdRef.current && readStorage(PENDING_KEY) === accountIdRef.current)
        void save();
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [save]);

  const update = useCallback((changes: Partial<ReadingPreferences>) => {
    const next = { ...preferencesRef.current, ...changes };
    revisionRef.current += 1;
    preferencesRef.current = next;
    setPreferences(next);
    writeCachedPreferences(next);
    writeStorage(PENDING_KEY, accountIdRef.current ?? "");
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);

  // Called as soon as someone is signed in, before their settings load, so changes
  // made in the meantime (or offline) belong to them and sync later.
  const attachAccount = useCallback((accountId: string) => {
    if (accountIdRef.current === accountId)
      return;

    accountIdRef.current = accountId;
    canSyncRef.current = true;

    if (readStorage(PENDING_KEY) !== accountId)
      removeStorage(PENDING_KEY);
  }, []);

  const hydrate = useCallback((serverPreferences: ReadingPreferences, accountId: string) => {
    attachAccount(accountId);

    if (readStorage(PENDING_KEY) === accountId) {
      void save();
      return;
    }

    removeStorage(PENDING_KEY);

    if (JSON.stringify(serverPreferences) === JSON.stringify(preferencesRef.current))
      return;

    preferencesRef.current = serverPreferences;
    setPreferences(serverPreferences);
    writeCachedPreferences(serverPreferences);
  }, [attachAccount, save]);

  const value = useMemo<AppearanceContextValue>(() => ({
    activeTheme: previewTheme ?? resolveActiveTheme(preferences, systemScheme),
    attachAccount,
    hydrate,
    preferences,
    saveState,
    setPreviewTheme,
    systemScheme,
    update,
  }), [attachAccount, hydrate, preferences, previewTheme, saveState, systemScheme, update]);

  return <AppearanceContext value={value}>{children}</AppearanceContext>;
}
