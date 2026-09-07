"use client";

import { List, X } from "@phosphor-icons/react";
import { AppLink } from "@/components/ui/app-link";
import { useEffect, useId, useState } from "react";

import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { cta, nav } from "@/lib/site";

/*
  Disclosure menu for < lg. Opens tens of times a day at most, so it gets a
  short fade only. Closes on Escape and on navigation.
*/
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
        className="rounded-control text-foreground hover:bg-muted inline-flex size-11 items-center justify-center transition-colors duration-150"
      >
        {open ? <X size={22} /> : <List size={22} />}
      </button>

      <div
        id={panelId}
        hidden={!open}
        className={cn(
          "border-border bg-background shadow-panel absolute inset-x-0 top-16 z-50 border-b px-5 pt-2 pb-6 sm:px-8",
          "transition-opacity duration-150 ease-out motion-reduce:transition-none",
          open ? "opacity-100" : "opacity-0",
        )}
      >
        <nav aria-label="Primary" className="flex flex-col">
          {nav.map((item) => (
            <AppLink
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="rounded-control text-foreground hover:bg-muted px-3 py-3 text-base transition-colors duration-150"
            >
              {item.label}
            </AppLink>
          ))}
        </nav>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <ButtonLink href={cta.login.href} variant="secondary" onClick={() => setOpen(false)}>
            {cta.login.label}
          </ButtonLink>
          <ButtonLink href={cta.signup.href} onClick={() => setOpen(false)}>
            {cta.signup.label}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
