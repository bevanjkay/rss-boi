import type { ThemeDefinition } from "@/lib/themes";
import { Check } from "lucide-react";
import { useId } from "react";
import { LINE_SPACING_STEPS, SIZE_STEPS, TYPEFACES, WIDTH_STEPS } from "@/lib/appearance";
import { cn } from "@/lib/utils";
import { useAppearance } from "./appearance-context";

interface Option<T extends string> {
  content?: React.ReactNode;
  id: T;
  label: string;
}

/** A row of mutually exclusive choices, built on native radios so arrow keys and screen readers work as expected. */
export function OptionGroup<T extends string>({
  className,
  label,
  onChange,
  options,
  value,
}: {
  className?: string;
  label: string;
  onChange: (value: T) => void;
  options: readonly Option<T>[];
  value: T;
}) {
  const groupId = useId();

  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="mb-2 text-sm font-medium text-foreground">{label}</legend>
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg border border-border bg-secondary/50 p-1">
        {options.map(option => (
          <label
            className="flex min-h-9 cursor-pointer items-center justify-center rounded-md px-2 text-center text-sm text-muted-foreground transition-colors hover:text-foreground has-[:checked]:bg-card has-[:checked]:text-foreground has-[:checked]:shadow-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring max-lg:min-h-11"
            key={option.id}
          >
            <input
              checked={value === option.id}
              className="sr-only"
              name={groupId}
              onChange={() => onChange(option.id)}
              type="radio"
              value={option.id}
            />
            {option.content ?? option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function TypefaceOptions({ compact = false, renderExtra }: { compact?: boolean; renderExtra?: (name: string) => React.ReactNode }) {
  const { preferences, update } = useAppearance();
  const groupId = useId();

  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium text-foreground">Typeface</legend>
      <div className={cn("grid gap-2", compact ? "grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))]" : "grid-cols-2")}>
        {TYPEFACES.map(typeface => (
          <label
            className="flex cursor-pointer flex-col gap-1 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            key={typeface.id}
          >
            <input
              checked={preferences.typeface === typeface.id}
              className="sr-only"
              name={groupId}
              onChange={() => update({ typeface: typeface.id })}
              type="radio"
              value={typeface.id}
            />
            <span aria-hidden="true" className={cn("leading-none text-foreground", compact ? "text-xl" : "text-2xl")} style={{ fontFamily: typeface.stack }}>Ag</span>
            <span className="truncate text-sm text-foreground">{typeface.label}</span>
            {compact ? null : <span className="text-xs text-muted-foreground">{typeface.hint}</span>}
          </label>
        ))}
        {renderExtra?.(groupId)}
      </div>
    </fieldset>
  );
}

export function SizeOptions() {
  const { preferences, update } = useAppearance();

  return (
    <OptionGroup
      label="Text size"
      onChange={size => update({ size })}
      options={SIZE_STEPS.map((step, index) => ({
        content: (
          <>
            <span aria-hidden="true" className="font-reading leading-none" style={{ fontSize: `${0.75 + index * 0.16}rem` }}>A</span>
            <span className="sr-only">{step.label}</span>
          </>
        ),
        id: step.id,
        label: step.label,
      }))}
      value={preferences.size}
    />
  );
}

export function SpacingOptions() {
  const { preferences, update } = useAppearance();

  return (
    <OptionGroup
      label="Line spacing"
      onChange={lineSpacing => update({ lineSpacing })}
      options={LINE_SPACING_STEPS}
      value={preferences.lineSpacing}
    />
  );
}

export function WidthOptions() {
  const { preferences, update } = useAppearance();

  return (
    <OptionGroup
      label="Line width"
      onChange={width => update({ width })}
      options={WIDTH_STEPS}
      value={preferences.width}
    />
  );
}

/** A miniature of the theme: its background, two lines of text and the accent. */
export function ThemeSwatch({
  checked,
  name,
  onSelect,
  theme,
}: {
  checked: boolean;
  name: string;
  onSelect: () => void;
  theme: ThemeDefinition;
}) {
  return (
    <label className="group flex min-w-0 cursor-pointer flex-col gap-1.5">
      <input checked={checked} className="sr-only" name={name} onChange={onSelect} type="radio" value={theme.id} />
      <span
        aria-hidden="true"
        className="relative flex h-14 flex-col justify-center gap-1.5 rounded-lg px-3 ring-1 ring-border transition-shadow group-hover:ring-foreground/40 group-has-[:checked]:ring-2 group-has-[:checked]:ring-primary group-has-[:focus-visible]:ring-2 group-has-[:focus-visible]:ring-ring"
        style={{ backgroundColor: theme.background }}
      >
        <span className="h-1.5 w-3/4 rounded-full opacity-90" style={{ backgroundColor: theme.text }} />
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: theme.accent }} />
          <span className="h-1.5 w-1/2 rounded-full opacity-50" style={{ backgroundColor: theme.text }} />
        </span>
        {checked
          ? (
              <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full" style={{ backgroundColor: theme.accent, color: theme.background }}>
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            )
          : null}
      </span>
      <span className="truncate text-xs text-muted-foreground group-has-[:checked]:text-foreground">{theme.name}</span>
    </label>
  );
}

export function ThemeGrid({
  label,
  onSelect,
  selectedId,
  themes,
}: {
  label: string;
  onSelect: (id: string) => void;
  selectedId: string;
  themes: ThemeDefinition[];
}) {
  const groupId = useId();

  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium text-foreground">{label}</legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-3">
        {themes.map(theme => (
          <ThemeSwatch checked={theme.id === selectedId} key={theme.id} name={groupId} onSelect={() => onSelect(theme.id)} theme={theme} />
        ))}
      </div>
    </fieldset>
  );
}
