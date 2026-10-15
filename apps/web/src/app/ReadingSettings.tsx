import type { CustomTheme } from "@rss-boi/shared";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { DEFAULT_READING_PREFERENCES } from "@/lib/appearance";
import { checkTheme, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, getAllThemes, getThemeScheme } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { useAppearance } from "./appearance-context";
import { OptionGroup, SizeOptions, SpacingOptions, ThemeGrid, TypefaceOptions, WidthOptions } from "./appearance-controls";

const MAX_CUSTOM_THEMES = 12;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function SaveStatus() {
  const { saveState } = useAppearance();
  const message = {
    error: "Not saved yet. Your changes will sync when RSS Boi can reach the server.",
    idle: "",
    saved: "Saved to your account.",
    saving: "Saving...",
  }[saveState];

  return <p aria-live="polite" className={cn("min-h-4 text-xs", saveState === "error" ? "text-warning" : "text-muted-foreground")}>{message}</p>;
}

function GoogleFontPicker({ onClose }: { onClose: () => void }) {
  const { update } = useAppearance();
  const [query, setQuery] = useState("");
  const [pendingFamily, setPendingFamily] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const catalogQuery = useQuery({
    queryFn: api.getFontCatalog,
    queryKey: ["font-catalog"],
    staleTime: 60 * 60 * 1000,
  });
  const catalog = catalogQuery.data;

  const sections = useMemo(() => {
    if (!catalog)
      return [];

    const search = query.trim().toLowerCase();

    if (!search) {
      const onServer = catalog.families.filter(item => catalog.onServer.includes(item.family));
      const popular = catalog.families.filter(item => !catalog.onServer.includes(item.family)).slice(0, 24);
      return [
        { families: onServer, title: "On this server" },
        { families: popular, title: "Popular" },
      ].filter(section => section.families.length);
    }

    const matches = catalog.families.filter(item => item.family.toLowerCase().includes(search));
    const ranked = [
      ...matches.filter(item => item.family.toLowerCase().startsWith(search)),
      ...matches.filter(item => !item.family.toLowerCase().startsWith(search)),
    ];
    return [{ families: ranked.slice(0, 40), title: "Results" }];
  }, [catalog, query]);

  const choose = async (family: string) => {
    setPendingFamily(family);
    setError(null);

    try {
      await api.getFontCss(family);
      update({ googleFont: family, typeface: "google" });
      onClose();
    }
    catch (chooseError) {
      setError(chooseError instanceof ApiError && chooseError.status === 404
        ? `"${family}" isn't on Google Fonts.`
        : `Couldn't load ${family}. Check your connection and try again.`);
    }
    finally {
      setPendingFamily(null);
    }
  };

  const hasResults = sections.some(section => section.families.length);

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-background/40 p-3">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search Google Fonts"
          autoFocus
          className="pl-9"
          onChange={event => setQuery(event.target.value)}
          placeholder="Search Google Fonts"
          type="search"
          value={query}
        />
      </div>

      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

      <div className="max-h-64 overflow-y-auto">
        {catalogQuery.isLoading
          ? <p className="px-1 py-2 text-sm text-muted-foreground">Loading the Google Fonts list...</p>
          : !catalog || !catalog.available
              ? <p className="px-1 py-2 text-sm text-muted-foreground">Google Fonts can't be reached right now. The built-in typefaces still work.</p>
              : !hasResults
                  ? (
                      <p className="px-1 py-2 text-sm text-muted-foreground">
                        No Google Fonts match &ldquo;
                        {query.trim()}
                        &rdquo;.
                      </p>
                    )
                  : sections.map(section => (
                      <div className="mb-2 last:mb-0" key={section.title}>
                        <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">{section.title}</p>
                        <ul className="grid">
                          {section.families.map(item => (
                            <li key={item.family}>
                              <button
                                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                                disabled={pendingFamily !== null}
                                onClick={() => void choose(item.family)}
                                type="button"
                              >
                                <span className="truncate">{item.family}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {pendingFamily === item.family ? "Loading..." : item.category.replace("-", " ")}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Your server downloads the font, so your browser never contacts Google.</p>
        <Button onClick={onClose} size="sm" variant="ghost">Cancel</Button>
      </div>
    </div>
  );
}

function GoogleFontOption({ name, onOpenPicker }: { name: string; onOpenPicker: () => void }) {
  const { preferences, update } = useAppearance();
  const { googleFont } = preferences;
  const checked = preferences.typeface === "google" && !!googleFont;

  return (
    <label className="flex cursor-pointer flex-col gap-1 rounded-lg border border-dashed border-border px-3 py-2.5 transition-colors hover:bg-accent has-[:checked]:border-solid has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
      <input
        checked={checked}
        className="sr-only"
        name={name}
        onChange={() => googleFont ? update({ typeface: "google" }) : onOpenPicker()}
        type="radio"
        value="google"
      />
      <span aria-hidden="true" className="text-2xl leading-none text-foreground" style={googleFont ? { fontFamily: `"${googleFont}"` } : undefined}>Ag</span>
      <span className="truncate text-sm text-foreground">{googleFont ?? "Google Font"}</span>
      <span className="text-xs text-muted-foreground">{googleFont ? "Google Fonts" : "Choose any family"}</span>
    </label>
  );
}

function ReadingPreview() {
  return (
    <figure aria-label="Preview of an article with your reading options" className="min-w-0 overflow-hidden rounded-xl border border-border bg-card px-5 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto" style={{ maxWidth: "var(--reading-measure)" }}>
        <p className="mb-3 text-sm text-muted-foreground">The Slow Web · 2 hours ago</p>
        <p className="reading-title mb-6 text-balance text-foreground">Reading that suits you</p>
        <div className="prose-article">
          <p>
            Pick the typeface, size and spacing that are comfortable for your eyes. Every article you open uses them, on
            {" "}
            <a href="#preview" onClick={event => event.preventDefault()}>every device</a>
            {" "}
            you sign in on.
          </p>
          <blockquote>A good reading view gets out of the way and lets the writing speak.</blockquote>
          <p>Changes apply as you make them, so you can judge them here before you open your next post.</p>
        </div>
      </div>
    </figure>
  );
}

export function ReadingSettingsCard() {
  const { update } = useAppearance();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const { googleFont, typeface } = useAppearance().preferences;

  return (
    <Card className="sm:col-span-2">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-x-6 gap-y-2 space-y-0">
        <div className="space-y-1.5">
          <h2 className="font-semibold leading-none tracking-tight">Reading</h2>
          <CardDescription>How articles look. Saved to your account, so they follow you to every device.</CardDescription>
        </div>
        <SaveStatus />
      </CardHeader>
      <CardContent className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="grid content-start gap-6">
          <div className="grid gap-3">
            <TypefaceOptions renderExtra={name => <GoogleFontOption name={name} onOpenPicker={() => setIsPickerOpen(true)} />} />
            {isPickerOpen
              ? <GoogleFontPicker onClose={() => setIsPickerOpen(false)} />
              : typeface === "google" && googleFont
                ? <Button className="w-fit" onClick={() => setIsPickerOpen(true)} size="sm" variant="ghost">Choose a different Google Font</Button>
                : null}
          </div>
          <SizeOptions />
          <SpacingOptions />
          <WidthOptions />
          <Button
            className="w-fit"
            onClick={() => update({
              googleFont: DEFAULT_READING_PREFERENCES.googleFont,
              lineSpacing: DEFAULT_READING_PREFERENCES.lineSpacing,
              size: DEFAULT_READING_PREFERENCES.size,
              typeface: DEFAULT_READING_PREFERENCES.typeface,
              width: DEFAULT_READING_PREFERENCES.width,
            })}
            size="sm"
            variant="ghost"
          >
            <RotateCcw className="h-4 w-4" />
            Reset reading options
          </Button>
        </div>
        <ReadingPreview />
      </CardContent>
    </Card>
  );
}

function ColorField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  const id = useId();
  const [text, setText] = useState(value);
  const [lastValue, setLastValue] = useState(value);

  if (value !== lastValue) {
    setLastValue(value);
    setText(value);
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          aria-label={`${label} colour picker`}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-1 max-lg:h-11"
          onChange={event => onChange(event.target.value)}
          type="color"
          value={value}
        />
        <Input
          autoComplete="off"
          className="font-mono uppercase"
          id={id}
          maxLength={7}
          onChange={(event) => {
            const next = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`;
            setText(next);

            if (HEX_COLOR.test(next))
              onChange(next.toLowerCase());
          }}
          spellCheck={false}
          value={text}
        />
      </div>
    </div>
  );
}

function ContrastReadout({ label, ratio, threshold, good, poor }: { good: string; label: string; poor: string; ratio: number; threshold: number }) {
  const passes = ratio >= threshold;

  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border py-2 text-sm first:border-t-0">
      <span className="text-foreground">{label}</span>
      <span className={cn("text-right", passes ? "text-muted-foreground" : "text-warning")}>
        <span className="font-mono tabular-nums">
          {ratio.toFixed(1)}
          :1
        </span>
        {" · "}
        {passes ? good : poor}
      </span>
    </div>
  );
}

function ThemeBuilder({ initial, onDone }: { initial: CustomTheme | null; onDone: () => void }) {
  const { activeTheme, preferences, setPreviewTheme, systemScheme, update } = useAppearance();
  const [draft, setDraft] = useState<CustomTheme>(() => initial ?? {
    accent: activeTheme.accent,
    background: activeTheme.background,
    id: `custom-${Date.now().toString(36)}`,
    name: "My theme",
    text: activeTheme.text,
  });
  const check = checkTheme(draft);
  const nameId = useId();

  useEffect(() => () => setPreviewTheme(null), [setPreviewTheme]);

  const change = (changes: Partial<CustomTheme>) => {
    const next = { ...draft, ...changes };
    setDraft(next);
    setPreviewTheme(next);
  };

  const finish = () => {
    setPreviewTheme(null);
    onDone();
  };

  const save = () => {
    const theme = { ...draft, name: draft.name.trim() || "My theme" };
    const customThemes = initial
      ? preferences.customThemes.map(item => item.id === theme.id ? theme : item)
      : [...preferences.customThemes, theme];
    const scheme = getThemeScheme(theme);
    const slot = preferences.themeMode === "fixed"
      ? { theme: theme.id }
      : scheme === "dark" ? { darkTheme: theme.id } : { lightTheme: theme.id };

    update({ customThemes, ...slot });
    finish();
  };

  return (
    <div className="grid gap-5 rounded-lg border border-border bg-background/40 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{initial ? `Edit ${initial.name}` : "Create a theme"}</h3>
        <p className="text-xs text-muted-foreground">
          The whole app shows your theme while you edit it. Surfaces, borders and secondary text are worked out from these three colours.
          {getThemeScheme(draft) !== systemScheme && preferences.themeMode === "system"
            ? ` It's a ${getThemeScheme(draft)} theme, so it'll be used when your device is in ${getThemeScheme(draft)} mode.`
            : null}
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={nameId}>Name</Label>
        <Input id={nameId} maxLength={40} onChange={event => change({ name: event.target.value })} value={draft.name} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <ColorField label="Background" onChange={background => change({ background })} value={draft.background} />
        <ColorField label="Text" onChange={text => change({ text })} value={draft.text} />
        <ColorField label="Accent" onChange={accent => change({ accent })} value={draft.accent} />
      </div>

      <div className="rounded-md bg-secondary/50 px-3">
        <ContrastReadout good={check.text >= 7 ? "Excellent" : "Meets AA"} label="Text on background" poor="Too low, so RSS Boi will strengthen it" ratio={check.text} threshold={4.5} />
        <ContrastReadout good="Easy to see" label="Accent on background" poor="Hard to see against the background" ratio={check.accent} threshold={3} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={save}>{initial ? "Save changes" : "Save theme"}</Button>
        <Button onClick={finish} variant="ghost">Cancel</Button>
      </div>
    </div>
  );
}

export function ThemeSettingsCard() {
  const { activeTheme, preferences, systemScheme, update } = useAppearance();
  const [editing, setEditing] = useState<CustomTheme | "new" | null>(null);
  const themes = getAllThemes(preferences.customThemes);
  const lightThemes = themes.filter(theme => getThemeScheme(theme) === "light");
  const darkThemes = themes.filter(theme => getThemeScheme(theme) === "dark");

  const deleteTheme = (theme: CustomTheme) => {
    update({
      customThemes: preferences.customThemes.filter(item => item.id !== theme.id),
      darkTheme: preferences.darkTheme === theme.id ? DEFAULT_DARK_THEME : preferences.darkTheme,
      lightTheme: preferences.lightTheme === theme.id ? DEFAULT_LIGHT_THEME : preferences.lightTheme,
      theme: preferences.theme === theme.id ? (systemScheme === "dark" ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME) : preferences.theme,
    });
  };

  return (
    <Card className="sm:col-span-2">
      <CardHeader>
        <h2 className="font-semibold leading-none tracking-tight">Theme</h2>
        <CardDescription>Colours for the whole app. Follow your device's light and dark mode, or keep one theme all the time.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <OptionGroup
          className="max-w-sm"
          label="Use"
          onChange={(themeMode) => {
            update(themeMode === "fixed" ? { theme: activeTheme.id, themeMode } : { themeMode });
          }}
          options={[
            { id: "system", label: "Match device" },
            { id: "fixed", label: "One theme" },
          ]}
          value={preferences.themeMode}
        />

        {preferences.themeMode === "system"
          ? (
              <div className="grid gap-6 lg:grid-cols-2">
                <ThemeGrid label="When your device is in light mode" onSelect={lightTheme => update({ lightTheme })} selectedId={preferences.lightTheme} themes={lightThemes} />
                <ThemeGrid label="When your device is in dark mode" onSelect={darkTheme => update({ darkTheme })} selectedId={preferences.darkTheme} themes={darkThemes} />
              </div>
            )
          : <ThemeGrid label="Theme" onSelect={theme => update({ theme })} selectedId={preferences.theme} themes={themes} />}

        <div className="grid gap-3 border-t border-border pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-foreground">Your themes</h3>
              <p className="text-xs text-muted-foreground">Pick a background, text and accent colour, and RSS Boi works out the rest.</p>
            </div>
            {editing
              ? null
              : (
                  <Button disabled={preferences.customThemes.length >= MAX_CUSTOM_THEMES} onClick={() => setEditing("new")} size="sm" variant="outline">
                    <Plus className="h-4 w-4" />
                    Create a theme
                  </Button>
                )}
          </div>

          {preferences.customThemes.length && !editing
            ? (
                <ul className="grid gap-2">
                  {preferences.customThemes.map(theme => (
                    <li className="flex items-center gap-3 rounded-lg border border-border px-3 py-2" key={theme.id}>
                      <span aria-hidden="true" className="flex h-8 w-12 shrink-0 items-center justify-center gap-1 rounded-md ring-1 ring-border" style={{ backgroundColor: theme.background }}>
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.text }} />
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.accent }} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{theme.name}</span>
                      <Button aria-label={`Edit ${theme.name}`} onClick={() => setEditing(theme)} size="icon" variant="ghost">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button aria-label={`Delete ${theme.name}`} className="text-destructive hover:text-destructive" onClick={() => deleteTheme(theme)} size="icon" variant="ghost">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            : null}

          {editing
            ? <ThemeBuilder initial={editing === "new" ? null : editing} key={editing === "new" ? "new" : editing.id} onDone={() => setEditing(null)} />
            : null}

          {preferences.customThemes.length >= MAX_CUSTOM_THEMES && !editing
            ? <p className="text-xs text-muted-foreground">You can keep up to 12 themes. Delete one to make another.</p>
            : null}
        </div>
      </CardContent>
    </Card>
  );
}
