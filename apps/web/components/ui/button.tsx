import { ArrowRight, CircleNotch } from "@phosphor-icons/react/dist/ssr";
import type { ComponentPropsWithoutRef } from "react";

import { AppLink } from "@/components/ui/app-link";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "inverse" | "destructive";
type Size = "sm" | "md" | "lg";

/*
  Buttons sit on the page rather than being painted onto it: a resting shadow,
  a 1px lift and a deeper shadow on hover, and a pressed inset on click. The
  whole cycle is 140ms, and motion-reduce keeps the colour change but drops the
  movement.

  Loading keeps the button at full colour with a spinner in front of the label
  (the kit's "Saving..."), and blocks a second press without dimming.
*/
const base =
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium " +
  "transition-[background-color,color,border-color,box-shadow,translate] duration-150 ease-out " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:pointer-events-none disabled:opacity-50 aria-busy:disabled:opacity-100 " +
  "motion-reduce:transition-[background-color,color,border-color]";

const lift = "hover:-translate-y-px active:translate-y-0 motion-reduce:hover:translate-y-0";

const variants: Record<Variant, string> = {
  primary: cn(
    "bg-primary text-primary-foreground shadow-raised",
    "hover:bg-primary-hover hover:shadow-raised-hover active:shadow-pressed",
    lift,
  ),
  secondary: cn(
    "border border-border bg-surface text-foreground shadow-raised-soft",
    "hover:border-primary/30 hover:text-primary hover:shadow-raised-soft-hover active:shadow-pressed",
    lift,
  ),
  ghost: "px-0 text-primary hover:text-primary-hover",
  inverse: cn(
    "bg-primary-foreground text-primary shadow-raised-soft",
    "hover:bg-surface hover:shadow-raised-soft-hover active:shadow-pressed",
    lift,
  ),
  destructive: cn(
    "bg-destructive text-destructive-foreground shadow-raised",
    "hover:bg-destructive/90 hover:shadow-raised-hover active:shadow-pressed",
    lift,
  ),
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-10 px-5 text-[15px]",
  lg: "h-12 px-6 text-[15px]",
};

type StyleProps = { variant?: Variant | undefined; size?: Size | undefined };

export function buttonClasses(
  { variant = "primary", size = "md" }: StyleProps,
  className?: string,
) {
  return cn(base, variants[variant], variant === "ghost" ? "h-auto" : sizes[size], className);
}

export type ButtonProps = ComponentPropsWithoutRef<"button"> &
  StyleProps & { loading?: boolean | undefined };

export function Button({
  variant,
  size,
  className,
  type = "button",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={buttonClasses({ variant, size }, className)}
      {...props}
    >
      {loading ? (
        <CircleNotch
          size={17}
          weight="bold"
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
        />
      ) : null}
      {children}
    </button>
  );
}

export type ButtonLinkProps = ComponentPropsWithoutRef<typeof AppLink> &
  StyleProps & { arrow?: boolean };

/** Anchor styled as a button. Use for navigation, never for actions. */
export function ButtonLink({
  variant,
  size,
  className,
  arrow,
  children,
  ...props
}: ButtonLinkProps) {
  const showArrow = arrow ?? variant === "ghost";
  return (
    <AppLink className={buttonClasses({ variant, size }, className)} {...props}>
      {children}
      {showArrow ? (
        <ArrowRight
          size={17}
          weight="bold"
          aria-hidden="true"
          className="transition-transform duration-150 ease-out group-hover/btn:translate-x-0.5 motion-reduce:transition-none"
        />
      ) : null}
    </AppLink>
  );
}
