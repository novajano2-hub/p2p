import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/cn";

/*
  The three building blocks every signed-in page is made of: a page header, a
  panel, and the empty state a panel shows before there is anything in it.
  Kept plain and generic so the pages read as content, not as chrome.
*/

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  /** Pills, buttons: whatever belongs at the right of the title. */
  children?: ReactNode;
};

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-foreground text-2xl leading-tight sm:text-[1.75rem]">
          {title}
        </h1>
        {description ? (
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

type PanelProps = {
  title?: string | undefined;
  description?: string | undefined;
  /** A link or button that belongs with the title, e.g. "See all". */
  action?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
};

/** The kit's surface: white on canvas, 8px corners, the panel shadow. */
export function Panel({ title, description, action, className, children }: PanelProps) {
  return (
    <section
      aria-label={title}
      className={cn(
        "rounded-surface border-border bg-surface shadow-panel border px-5 py-5 sm:px-6",
        className,
      )}
    >
      {title ? (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-foreground text-[15px] font-semibold">{title}</h2>
            {description ? (
              <p className="text-muted-foreground mt-0.5 text-[13px]">{description}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0 text-[13px]">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

type EmptyStateProps = {
  icon: ComponentType<{
    size?: number;
    weight?: "regular" | "fill" | "duotone";
    className?: string;
  }>;
  title: string;
  description: string;
  action?: ReactNode;
};

/** What a panel says before it has anything to show. Never a spinner, never blank. */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <span className="bg-muted text-muted-foreground mb-3 flex size-11 items-center justify-center rounded-full">
        <Icon size={22} weight="duotone" aria-hidden="true" />
      </span>
      <p className="text-foreground text-sm font-medium">{title}</p>
      <p className="text-muted-foreground mt-1 max-w-xs text-[13px] leading-relaxed">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
