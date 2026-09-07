import { cn } from "@/lib/cn";
import { site } from "@/lib/site";

type LogoProps = {
  className?: string;
  /** Render the wordmark beside the mark. */
  withWordmark?: boolean;
};

/**
 * Placeholder mark: a single wave in a rounded square, for "Abay" (the Blue
 * Nile). One simple geometric path, deliberately easy to replace.
 */
export function Logo({ className, withWordmark = true }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg aria-hidden="true" viewBox="0 0 32 32" className="size-8 shrink-0" focusable="false">
        <rect width="32" height="32" rx="9" className="fill-primary" />
        <path
          d="M7.5 17.5c3.2-4.6 6.4-4.6 9.5 0s6.3 4.6 9.5 0"
          fill="none"
          strokeWidth="2.6"
          strokeLinecap="round"
          className="stroke-primary-foreground"
        />
      </svg>
      {withWordmark ? (
        <span className="text-foreground text-[17px] font-semibold tracking-tight">
          {site.name}
        </span>
      ) : null}
    </span>
  );
}
