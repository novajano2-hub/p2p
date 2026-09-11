"use client";

import { CaretDown, GearSix, SignOut } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";

import { useSession } from "@/components/app/session-provider";
import { ThemeControl } from "@/components/app/theme-control";
import { FormError } from "@/components/auth/notices";
import { AppLink } from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { settingsHref } from "@/lib/app-nav";
import { cn } from "@/lib/cn";

/*
  The account menu in the header: who is signed in, the theme, the way to
  settings, and the way out. A hand-rolled disclosure rather than a dialog
  library: it closes on Escape, on a click outside, and on choosing a link.
*/

export function AccountMenu() {
  const { user, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const initial = user.username.charAt(0).toUpperCase();

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="rounded-control hover:bg-muted flex h-10 items-center gap-2 pr-2 pl-1 transition-colors duration-150"
      >
        <span
          aria-hidden="true"
          className="bg-primary-soft text-primary-soft-foreground flex size-8 items-center justify-center rounded-full text-sm font-semibold"
        >
          {initial}
        </span>
        <span className="text-foreground hidden max-w-[12rem] truncate text-sm md:block">
          {user.username}
        </span>
        <CaretDown
          size={14}
          weight="bold"
          aria-hidden="true"
          className={cn(
            "text-muted-foreground transition-transform duration-150",
            open ? "rotate-180" : "",
          )}
        />
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="border-border bg-surface shadow-panel rounded-surface absolute top-full right-0 z-50 mt-2 w-72 border p-2"
      >
        <div className="px-2 pt-2 pb-3">
          <p className="text-foreground text-sm font-medium break-all">{user.username}</p>
          <p className="text-muted-foreground mt-0.5 text-[12px] break-all">{user.email}</p>
          <p className="text-muted-foreground mt-1 text-[12px]">
            UID <span className="text-foreground font-mono tabular-nums">{user.platformId}</span>
          </p>
        </div>

        <div className="border-border border-t px-2 py-3">
          <p className="text-muted-foreground mb-2 text-[12px] font-medium tracking-wide uppercase">
            Appearance
          </p>
          <ThemeControl />
        </div>

        <div className="border-border flex flex-col border-t py-1">
          <AppLink
            href={settingsHref}
            onClick={() => setOpen(false)}
            className="rounded-control text-foreground hover:bg-muted flex items-center gap-2.5 px-2 py-2 text-sm transition-colors duration-150"
          >
            <GearSix size={17} aria-hidden="true" />
            Settings
          </AppLink>
        </div>

        <div className="border-border border-t pt-2">
          <FormError message={signOutError} />
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive hover:bg-muted rounded-control flex w-full items-center justify-start gap-2.5 px-2 py-2 text-sm"
            loading={signingOut}
            onClick={async () => {
              setSigningOut(true);
              setSignOutError(null);
              const result = await signOut();
              if (!result.ok) {
                setSigningOut(false);
                setSignOutError(result.message);
              }
              // On success the page is leaving; the button stays busy until it has.
            }}
          >
            <SignOut size={17} weight="bold" aria-hidden="true" />
            Log out
          </Button>
        </div>
      </div>
    </div>
  );
}
