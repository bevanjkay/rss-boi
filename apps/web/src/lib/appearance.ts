import type { ReadingPreferences } from "@rss-boi/shared";
import type { ThemeDefinition, ThemeScheme } from "./themes";
import { api, API_BASE_URL } from "./api";
import { getThemeScheme, getThemeTokens, resolveActiveTheme } from "./themes";

export const DEFAULT_READING_PREFERENCES: ReadingPreferences = {
  accentColor: null,
  customThemes: [],
  darkTheme: "midnight",
  feedSort: "alphabetical",
  googleFont: null,
  lightTheme: "daylight",
  lineSpacing: "comfortable",
  size: "m",
  theme: "midnight",
  themeMode: "system",
  typeface: "literata",
  width: "standard",
};

const LITERATA_STACK = "\"Literata Variable\", \"Iowan Old Style\", Georgia, serif";

export const TYPEFACES = [
  { id: "literata", label: "Literata", hint: "Serif", stack: LITERATA_STACK },
  { id: "sans", label: "Sans", hint: "System", stack: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif" },
  { id: "atkinson", label: "Atkinson", hint: "Hyperlegible", stack: "\"Atkinson Hyperlegible Next Variable\", ui-sans-serif, system-ui, sans-serif" },
] as const;

export const SIZE_STEPS = [
  { id: "xs", label: "Extra small", mobile: 15, desktop: 16 },
  { id: "s", label: "Small", mobile: 16, desktop: 17 },
  { id: "m", label: "Medium", mobile: 17, desktop: 18 },
  { id: "l", label: "Large", mobile: 19, desktop: 20 },
  { id: "xl", label: "Extra large", mobile: 21, desktop: 23 },
] as const;

export const LINE_SPACING_STEPS = [
  { id: "compact", label: "Compact", value: 1.5 },
  { id: "comfortable", label: "Comfortable", value: 1.7 },
  { id: "airy", label: "Airy", value: 1.9 },
] as const;

export const WIDTH_STEPS = [
  { id: "narrow", label: "Narrow", value: "58ch" },
  { id: "standard", label: "Standard", value: "68ch" },
  { id: "wide", label: "Wide", value: "80ch" },
] as const;

const PREFERENCES_KEY = "rss-boi:reading-preferences";
// Read by the inline script in index.html so the saved theme paints before React loads.
const APPLIED_KEY = "rss-boi:applied-appearance";
const FONT_CSS_KEY_PREFIX = "rss-boi:font-css:";
const GOOGLE_FONT_STYLE_ID = "reading-google-font";

// Browser storage can be unavailable or full (private browsing, quotas), so appearance treats it as optional.
export function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  }
  catch {
    return null;
  }
}

export function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  }
  catch {}
}

export function removeStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  }
  catch {}
}

export function readCachedPreferences(): ReadingPreferences {
  try {
    const value = readStorage(PREFERENCES_KEY);
    return value ? { ...DEFAULT_READING_PREFERENCES, ...JSON.parse(value) } : DEFAULT_READING_PREFERENCES;
  }
  catch {
    return DEFAULT_READING_PREFERENCES;
  }
}

export function writeCachedPreferences(preferences: ReadingPreferences) {
  writeStorage(PREFERENCES_KEY, JSON.stringify(preferences));
}

export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function getSystemScheme(): ThemeScheme {
  return window.matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light";
}

function getReadingFontStack(preferences: ReadingPreferences) {
  if (preferences.typeface === "google" && preferences.googleFont)
    return `"${preferences.googleFont.replaceAll("\"", "")}", ${LITERATA_STACK}`;

  return TYPEFACES.find(typeface => typeface.id === preferences.typeface)?.stack ?? LITERATA_STACK;
}

function getReadingVariables(preferences: ReadingPreferences): Record<string, string> {
  const size = SIZE_STEPS.find(step => step.id === preferences.size) ?? SIZE_STEPS[2];
  const spacing = LINE_SPACING_STEPS.find(step => step.id === preferences.lineSpacing) ?? LINE_SPACING_STEPS[1];
  const width = WIDTH_STEPS.find(step => step.id === preferences.width) ?? WIDTH_STEPS[1];

  return {
    "reading-font": getReadingFontStack(preferences),
    "reading-leading": String(spacing.value),
    "reading-measure": width.value,
    "reading-size": `${size.desktop}px`,
    "reading-size-mobile": `${size.mobile}px`,
  };
}

/** Paint the theme and reading options onto the document. `previewTheme` overrides the saved theme while building one. */
export function applyAppearance(preferences: ReadingPreferences, systemScheme: ThemeScheme, previewTheme?: ThemeDefinition | null) {
  const theme = previewTheme ?? resolveActiveTheme(preferences, systemScheme);
  const scheme = getThemeScheme(theme);
  const variables = { ...getThemeTokens(theme), ...getReadingVariables(preferences) };
  const root = document.documentElement;

  for (const [name, value] of Object.entries(variables))
    root.style.setProperty(`--${name}`, value);

  root.style.colorScheme = scheme;
  root.dataset.scheme = scheme;
  document.querySelector("meta[name=\"theme-color\"]")?.setAttribute("content", theme.background);

  if (!previewTheme) {
    writeStorage(APPLIED_KEY, JSON.stringify({ scheme, themeColor: theme.background, variables }));
  }

  void loadGoogleFont(preferences.typeface === "google" ? preferences.googleFont : null);
}

function injectFontCss(css: string) {
  let style = document.getElementById(GOOGLE_FONT_STYLE_ID);

  if (!style) {
    style = document.createElement("style");
    style.id = GOOGLE_FONT_STYLE_ID;
    document.head.append(style);
  }

  style.textContent = css.replaceAll("url(/api/fonts/files/", `url(${API_BASE_URL}/api/fonts/files/`);
}

let loadedFamily: string | null = null;

/** Fetch a family's stylesheet through the API, cached on this device so it also works offline. */
export async function loadGoogleFont(family: string | null) {
  if (family === loadedFamily)
    return;

  loadedFamily = family;

  if (!family) {
    document.getElementById(GOOGLE_FONT_STYLE_ID)?.remove();
    return;
  }

  const cacheKey = `${FONT_CSS_KEY_PREFIX}${family}`;
  const cached = readStorage(cacheKey);

  if (cached)
    injectFontCss(cached);

  let css: string;

  try {
    css = await api.getFontCss(family);
  }
  catch {
    // Keep the cached copy, or fall back to Literata through the font stack. Without
    // a cached copy, forget the family so the next call tries the request again.
    if (!cached && loadedFamily === family)
      loadedFamily = null;

    return;
  }

  if (loadedFamily !== family)
    return;

  injectFontCss(css);

  // Only the active family is kept, and a full storage quota just skips the offline copy.
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(FONT_CSS_KEY_PREFIX) && key !== cacheKey)
        window.localStorage.removeItem(key);
    }

    window.localStorage.setItem(cacheKey, css);
  }
  catch {}
}
