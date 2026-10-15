import { ALargeSmall, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getAllThemes, getThemeScheme } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { useAppearance } from "./appearance-context";
import { SizeOptions, SpacingOptions, ThemeGrid, TypefaceOptions, WidthOptions } from "./appearance-controls";

function GoogleFontChoice({ name }: { name: string }) {
  const { preferences, update } = useAppearance();
  const { googleFont } = preferences;

  if (!googleFont)
    return null;

  return (
    <label className="flex cursor-pointer flex-col gap-1 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
      <input
        checked={preferences.typeface === "google"}
        className="sr-only"
        name={name}
        onChange={() => update({ typeface: "google" })}
        type="radio"
        value="google"
      />
      <span aria-hidden="true" className="text-xl leading-none text-foreground" style={{ fontFamily: `"${googleFont}"` }}>Ag</span>
      <span className="truncate text-sm text-foreground">{googleFont}</span>
    </label>
  );
}

function ReaderThemes() {
  const { activeTheme, preferences, systemScheme, update } = useAppearance();

  return (
    <ThemeGrid
      label="Theme"
      onSelect={(id) => {
        const theme = getAllThemes(preferences.customThemes).find(item => item.id === id);

        // Keep matching the device when the pick suits the current mode; otherwise pin it.
        if (preferences.themeMode === "system" && theme && getThemeScheme(theme) === systemScheme)
          update(systemScheme === "dark" ? { darkTheme: id } : { lightTheme: id });
        else
          update({ theme: id, themeMode: "fixed" });
      }}
      selectedId={activeTheme.id}
      themes={getAllThemes(preferences.customThemes)}
    />
  );
}

/** The "Aa" control in the article toolbar: a popover on desktop, a bottom sheet on phones. */
export function ReaderOptionsButton({ variant }: { variant: "popover" | "sheet" }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const isPopover = variant === "popover";

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog)
      return;

    if (open && !dialog.open) {
      if (isPopover && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        dialog.style.top = `${rect.bottom + 8}px`;
        dialog.style.right = `${Math.max(16, window.innerWidth - rect.right)}px`;
        dialog.style.maxHeight = `${window.innerHeight - rect.bottom - 24}px`;
      }

      dialog.showModal();
    }
    else if (!open && dialog.open) {
      dialog.close();
    }
  }, [isPopover, open]);

  const close = () => setOpen(false);

  return (
    <>
      <Button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Reading options"
        onClick={() => setOpen(true)}
        ref={buttonRef}
        size={isPopover ? "icon" : "icon-lg"}
        title="Reading options"
        variant="ghost"
      >
        <ALargeSmall className={isPopover ? "h-4 w-4" : "h-5 w-5"} />
      </Button>

      <dialog
        aria-labelledby="reader-options-title"
        className={cn(
          "sheet-dialog m-0 border border-border bg-card p-0 text-card-foreground shadow-2xl shadow-black/30",
          isPopover
            ? "fixed left-auto w-[22rem] overflow-y-auto rounded-xl backdrop:bg-transparent"
            : "reader-sheet fixed inset-x-0 bottom-0 top-auto max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl pb-[env(safe-area-inset-bottom)] backdrop:bg-background/50",
        )}
        onClick={(event) => {
          if (event.target === event.currentTarget)
            close();
        }}
        onClose={close}
        ref={dialogRef}
      >
        <div className="flex items-center justify-between border-b border-border py-2 pl-4 pr-2">
          <h2 className="text-sm font-semibold" id="reader-options-title">Reading options</h2>
          <Button aria-label="Close" onClick={close} size="icon" variant="ghost">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid gap-5 p-4">
          <TypefaceOptions compact renderExtra={name => <GoogleFontChoice name={name} />} />
          <SizeOptions />
          <SpacingOptions />
          {isPopover ? <WidthOptions /> : null}
          <ReaderThemes />
        </div>
        <div className="border-t border-border px-4 py-3">
          <Link className="text-sm text-primary underline-offset-4 hover:underline" onClick={close} to="/settings">
            More options, including Google Fonts and your own themes, in Settings
          </Link>
        </div>
      </dialog>
    </>
  );
}
