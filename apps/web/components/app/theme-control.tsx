"use client";

import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";
import {
  applyThemeChoice,
  getServerThemeChoice,
  readThemeChoice,
  subscribeThemeChoice,
  type ThemeChoice,
} from "@/lib/theme";

/*
  System / Light / Dark, as a segmented control. The choice applies the moment
  it is pressed and is remembered across pages and visits (lib/theme.ts).
  Rendered as a radio group, which is what it is: one of three.
*/

const OPTIONS: readonly { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Desktop },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function ThemeControl({ className }: { className?: string | undefined }) {
  // The server renders "system" and the client corrects it after hydration,
  // so the markup agrees on both sides.
  const choice = useSyncExternalStore(subscribeThemeChoice, readThemeChoice, getServerThemeChoice);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn("bg-muted rounded-control grid grid-cols-3 gap-1 p-1", className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const checked = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => applyThemeChoice(value)}
            className={cn(
              "rounded-control flex h-9 items-center justify-center gap-1.5 text-[13px] font-medium transition-colors duration-150",
              checked
                ? "bg-surface text-foreground shadow-raised-soft"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon size={15} weight={checked ? "fill" : "regular"} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
