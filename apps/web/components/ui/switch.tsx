"use client";

import { cn } from "@/lib/cn";

/*
  On or off, as a switch: a button with role="switch", so a screen reader says
  "on" or "off" rather than "checked". For a state that takes effect at once -
  an ad online or offline, a filter - or a setting that reads as one. A yes/no
  sent with the rest of a form is a Checkbox.

  Named by a visible label (aria-labelledby, or a <label htmlFor>) wherever
  there is one; `label` only when nothing on screen names it.
*/
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
  ...rest
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  id?: string | undefined;
  "aria-labelledby"?: string | undefined;
  "aria-describedby"?: string | undefined;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150",
        "focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-sage",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn(
          "bg-surface shadow-raised-soft size-5 rounded-full transition-transform duration-150 motion-reduce:transition-none",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
