import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "inverse" | "destructive";
type Size = "sm" | "md" | "lg";

/*
  The kit's actions. Primary is Forest on Canvas text; Secondary is an outlined
  Forest; Ghost is a Forest text link with an arrow. 6px radius throughout.
  Press feedback is a 1px nudge over 120ms; hover only changes colour.
*/
const base =
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium " +
  "transition-[background-color,color,border-color,transform] duration-150 ease-out " +
  "active:translate-y-px motion-reduce:active:translate-y-0 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "border border-primary bg-surface text-primary hover:bg-primary-soft",
  ghost: "px-0 text-primary hover:text-primary-hover",
  inverse: "bg-primary-foreground text-primary hover:bg-surface",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-[15px]",
  lg: "h-12 px-6 text-base",
};

type StyleProps = { variant?: Variant | undefined; size?: Size | undefined };

export function buttonClasses(
  { variant = "primary", size = "md" }: StyleProps,
  className?: string,
) {
  return cn(base, variants[variant], variant === "ghost" ? "h-auto" : sizes[size], className);
}

export type ButtonProps = ComponentPropsWithoutRef<"button"> & StyleProps;

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size }, className)} {...props} />;
}

export type ButtonLinkProps = ComponentPropsWithoutRef<typeof Link> &
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
    <Link className={buttonClasses({ variant, size }, className)} {...props}>
      {children}
      {showArrow ? <ArrowRight size={18} weight="bold" aria-hidden="true" /> : null}
    </Link>
  );
}
