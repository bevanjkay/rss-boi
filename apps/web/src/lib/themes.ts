import type { CustomTheme, ReadingPreferences } from "@rss-boi/shared";
import { contrastRatio, ensureContrast, lightness, mix, shiftLightness, toHslTriplet } from "./color";

export type ThemeScheme = "dark" | "light";
export type ThemeTokens = Record<string, string>;

export interface ThemeDefinition {
  accent: string;
  background: string;
  id: string;
  name: string;
  text: string;
  /** Hand-tuned tokens that override derivation, so Midnight stays exactly as it was. */
  tokens?: ThemeTokens;
}

export const PRESET_THEMES: ThemeDefinition[] = [
  {
    id: "midnight",
    name: "Midnight",
    background: "#0f1114",
    text: "#ecf0f3",
    accent: "#df762b",
    tokens: {
      "background": "220 14% 7%",
      "foreground": "210 20% 94%",
      "card": "215 14% 11%",
      "card-foreground": "210 20% 94%",
      "primary": "27 73% 52%",
      "primary-foreground": "24 80% 8%",
      "secondary": "215 12% 16%",
      "secondary-foreground": "210 20% 86%",
      "muted": "215 12% 16%",
      "muted-foreground": "215 12% 64%",
      "accent": "215 12% 16%",
      "accent-foreground": "210 20% 94%",
      "border": "215 12% 20%",
      "input": "215 10% 43%",
      "ring": "27 73% 52%",
      "sidebar": "215 14% 9%",
      "sidebar-foreground": "215 12% 72%",
      "sidebar-accent": "215 12% 14%",
      "sidebar-accent-foreground": "210 20% 94%",
      "sidebar-border": "215 12% 18%",
      "reading-foreground": "210 16% 85%",
    },
  },
  { id: "daylight", name: "Daylight", background: "#f7f7f5", text: "#1c1e22", accent: "#b4530f" },
  { id: "paper", name: "Paper", background: "#f3ecdf", text: "#2d2620", accent: "#a4470e" },
  { id: "slate", name: "Slate", background: "#1d222b", text: "#dfe5ec", accent: "#f0a060" },
  { id: "ink", name: "Ink", background: "#000000", text: "#e4e4e4", accent: "#ff8b3d" },
  { id: "high-contrast", name: "High contrast", background: "#000000", text: "#ffffff", accent: "#ffc53d" },
];

export const DEFAULT_LIGHT_THEME = "daylight";
export const DEFAULT_DARK_THEME = "midnight";

// Status colours stay fixed per scheme so their meaning never depends on a custom theme.
const STATUS_TOKENS: Record<ThemeScheme, ThemeTokens> = {
  dark: {
    "destructive": "0 65% 68%",
    "destructive-foreground": "0 50% 10%",
    "success": "152 55% 58%",
    "warning": "38 85% 60%",
  },
  light: {
    "destructive": "0 62% 44%",
    "destructive-foreground": "0 0% 100%",
    "success": "152 62% 28%",
    "warning": "32 90% 34%",
  },
};

export function getThemeScheme(theme: Pick<ThemeDefinition, "background">): ThemeScheme {
  return lightness(theme.background) < 0.5 ? "dark" : "light";
}

/** Every app token from three colours: surfaces step away from the background, text is held to WCAG AA. */
export function deriveThemeTokens(theme: ThemeDefinition): ThemeTokens {
  const scheme = getThemeScheme(theme);
  const { accent, background } = theme;
  const isDark = scheme === "dark";
  const step = (delta: number) => shiftLightness(background, isDark ? delta : -delta);

  // Light cards step towards white, so even a near-white page keeps a visible reading pane.
  const card = isDark ? step(0.035) : mix(background, "#ffffff", 0.75);
  const secondary = step(isDark ? 0.075 : 0.05);
  const border = step(isDark ? 0.11 : 0.11);
  const sidebar = step(isDark ? 0.015 : 0.025);
  const sidebarAccent = step(isDark ? 0.06 : 0.07);
  const sidebarBorder = step(isDark ? 0.095 : 0.1);

  const foreground = ensureContrast(theme.text, [background, card, secondary], 4.5);
  const reading = ensureContrast(mix(foreground, background, 0.12), [card], 4.5);
  const secondaryForeground = ensureContrast(mix(foreground, background, 0.1), [secondary], 4.5);
  const mutedForeground = ensureContrast(mix(foreground, background, 0.4), [background, card, secondary], 4.5);
  const sidebarForeground = ensureContrast(mix(foreground, background, 0.25), [sidebar, sidebarAccent], 4.5);
  const input = ensureContrast(mix(background, foreground, 0.4), [background, card], 3);
  const onAccent = contrastRatio(accent, "#ffffff") >= contrastRatio(accent, "#111111") ? "#ffffff" : mix(background, "#000000", 0.6);

  return {
    "background": toHslTriplet(background),
    "foreground": toHslTriplet(foreground),
    "card": toHslTriplet(card),
    "card-foreground": toHslTriplet(foreground),
    "primary": toHslTriplet(accent),
    "primary-foreground": toHslTriplet(onAccent),
    "secondary": toHslTriplet(secondary),
    "secondary-foreground": toHslTriplet(secondaryForeground),
    "muted": toHslTriplet(secondary),
    "muted-foreground": toHslTriplet(mutedForeground),
    "accent": toHslTriplet(secondary),
    "accent-foreground": toHslTriplet(foreground),
    "border": toHslTriplet(border),
    "input": toHslTriplet(input),
    "ring": toHslTriplet(accent),
    "sidebar": toHslTriplet(sidebar),
    "sidebar-foreground": toHslTriplet(sidebarForeground),
    "sidebar-accent": toHslTriplet(sidebarAccent),
    "sidebar-accent-foreground": toHslTriplet(foreground),
    "sidebar-border": toHslTriplet(sidebarBorder),
    "reading-foreground": toHslTriplet(reading),
  };
}

export function getThemeTokens(theme: ThemeDefinition): ThemeTokens {
  return { ...(theme.tokens ?? deriveThemeTokens(theme)), ...STATUS_TOKENS[getThemeScheme(theme)] };
}

export function getAllThemes(customThemes: CustomTheme[]): ThemeDefinition[] {
  return [...PRESET_THEMES, ...customThemes];
}

export function findTheme(id: string, customThemes: CustomTheme[]) {
  return getAllThemes(customThemes).find(theme => theme.id === id);
}

/** The theme to show right now, falling back to the defaults if a saved id no longer exists. */
export function resolveActiveTheme(preferences: ReadingPreferences, systemScheme: ThemeScheme): ThemeDefinition {
  const id = preferences.themeMode === "fixed"
    ? preferences.theme
    : systemScheme === "dark" ? preferences.darkTheme : preferences.lightTheme;
  const fallback = systemScheme === "dark" ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;

  return findTheme(id, preferences.customThemes) ?? findTheme(fallback, [])!;
}

export interface ThemeCheck {
  accent: number;
  text: number;
}

/** Contrast of the raw picks against the background, for the builder's readouts. */
export function checkTheme(theme: Pick<ThemeDefinition, "accent" | "background" | "text">): ThemeCheck {
  return {
    accent: contrastRatio(theme.accent, theme.background),
    text: contrastRatio(theme.text, theme.background),
  };
}
