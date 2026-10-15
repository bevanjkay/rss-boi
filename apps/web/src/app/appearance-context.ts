import type { ReadingPreferences } from "@rss-boi/shared";
import type { ThemeDefinition, ThemeScheme } from "@/lib/themes";
import { createContext, use } from "react";

export type AppearanceSaveState = "idle" | "saving" | "saved" | "error";

export interface AppearanceContextValue {
  activeTheme: ThemeDefinition;
  /** Tie changes made from now on to this account, before its saved preferences have loaded. */
  attachAccount: (accountId: string) => void;
  /** Accept the account's saved preferences, unless this device has changes from that same account waiting to sync. */
  hydrate: (preferences: ReadingPreferences, accountId: string) => void;
  preferences: ReadingPreferences;
  saveState: AppearanceSaveState;
  /** Show a theme across the app without saving it, for the theme builder. */
  setPreviewTheme: (theme: ThemeDefinition | null) => void;
  systemScheme: ThemeScheme;
  update: (changes: Partial<ReadingPreferences>) => void;
}

export const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function useAppearance() {
  const value = use(AppearanceContext);

  if (!value)
    throw new Error("useAppearance must be used inside AppearanceProvider.");

  return value;
}
