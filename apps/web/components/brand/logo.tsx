import { cn } from "@/lib/cn";
import { site } from "@/lib/site";

/**
 * Wordmark only. Placeholder name; swap the string in lib/site.ts.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-display text-foreground text-[1.0625rem] leading-none tracking-[-0.02em]",
        className,
      )}
    >
      {site.name}
    </span>
  );
}
