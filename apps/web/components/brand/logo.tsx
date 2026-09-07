import { cn } from "@/lib/cn";
import { site } from "@/lib/site";

/**
 * Wordmark only, set in the display serif, the way the kit signs itself.
 * Placeholder name; swap the string in lib/site.ts.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-foreground text-[1.45rem] leading-none", className)}>
      {site.name}
    </span>
  );
}
