import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/*
  What a page shows in place of itself: a 404, a crash, a missing order. One
  shape for all of them - a mark, one heading that says what happened, one
  sentence on why, and the way out - so a person who meets one has met them
  all. The icon is chosen by the page; the tone says whether anything went
  wrong (attention) or something simply is not there (neutral).
*/
export function Fallback({
  icon: Mark,
  tone = "neutral",
  title,
  children,
  actions,
  reference,
  className,
}: {
  icon: Icon;
  tone?: "neutral" | "attention";
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  /** The id a support request can quote, when there is one. */
  reference?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-md flex-col items-center px-2 py-12 text-center sm:py-16",
        className,
      )}
    >
      <span
        className={cn(
          "mb-5 flex size-12 items-center justify-center rounded-full",
          tone === "attention"
            ? "bg-status-attention text-status-attention-fg"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Mark size={24} weight="duotone" aria-hidden="true" />
      </span>
      <h1 className="font-display text-foreground text-xl font-semibold text-balance sm:text-2xl">
        {title}
      </h1>
      <div className="text-muted-foreground mt-2 text-sm leading-relaxed text-balance">
        {children}
      </div>
      {actions ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{actions}</div>
      ) : null}
      {reference ? (
        <p className="text-muted-foreground mt-6 text-[12px]">
          Reference <span className="font-mono">{reference}</span>
        </p>
      ) : null}
    </div>
  );
}
