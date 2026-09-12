"use client";

import { type ReactNode } from "react";

import { AppLink } from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { type LedgerReason, type LedgerScope } from "@/lib/admin/ledger";
import { formatMicro } from "@/lib/admin/money";
import { cn } from "@/lib/cn";

/*
  The small parts every ledger screen is built from, so that a balance, a
  reason and a code look the same on all of them. Numbers are monospaced and
  right-aligned because they are compared down a column; codes are
  monospaced because they are copied.
*/

export const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});
export const integer = new Intl.NumberFormat("en-GB");

export const TH =
  "text-muted-foreground px-3 py-2 text-left text-[12px] font-medium whitespace-nowrap";
export const TD = "px-3 py-2.5 align-top text-[13px]";
export const TD_NUM = cn(TD, "text-right font-mono tabular-nums whitespace-nowrap");

export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-foreground text-2xl leading-tight">{title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-surface border-border bg-surface border", className)}>
      {title ? (
        <h2 className="text-foreground border-border border-b px-4 py-3 text-[15px] font-semibold">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

/** A table that scrolls inside its panel on a narrow screen rather than the page. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">{children}</table>
    </div>
  );
}

export function Amount({ value, className }: { value: string; className?: string }) {
  const negative = value.startsWith("-");
  const zero = /^-?0+$/.test(value);
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        negative && "text-destructive",
        zero && "text-muted-foreground",
        className,
      )}
    >
      {formatMicro(value)}
    </span>
  );
}

export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12px] break-all", className)}>{children}</span>;
}

export const humanize = (text: string): string => text.toLowerCase().replace(/_/g, " ");

const REASON_TONE: Record<string, string> = {
  DEPOSIT: "bg-status-complete text-status-complete-fg",
  ESCROW: "bg-status-pending text-status-pending-fg",
  WITHDRAWAL: "bg-status-neutral text-status-neutral-fg",
  DISPUTE: "bg-status-attention text-status-attention-fg",
  RECONCILIATION: "bg-status-attention text-status-attention-fg",
};

export function ReasonTag({ reason }: { reason: LedgerReason }) {
  const family = reason.split("_")[0] ?? "";
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap",
        REASON_TONE[family] ?? "bg-status-neutral text-status-neutral-fg",
      )}
    >
      {humanize(reason)}
    </span>
  );
}

export function ScopeTag({ scope }: { scope: LedgerScope }) {
  return (
    <span className="bg-muted text-muted-foreground inline-block rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide">
      {scope}
    </span>
  );
}

export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <AppLink href={href} className="text-primary text-[12px] font-medium hover:underline">
      {children}
    </AppLink>
  );
}

export function Notice({ tone, children }: { tone: "loading" | "error"; children: ReactNode }) {
  return tone === "error" ? (
    <p role="alert" className="text-destructive text-sm">
      {children}
    </p>
  ) : (
    <p role="status" className="text-muted-foreground text-sm">
      {children}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground px-4 py-8 text-center text-[13px]">{children}</p>;
}

export function LoadMore({
  cursor,
  busy,
  onClick,
}: {
  cursor: string | null;
  busy: boolean;
  onClick: () => void;
}) {
  if (!cursor) return null;
  return (
    <div className="border-border border-t px-4 py-3">
      <Button type="button" variant="secondary" size="sm" loading={busy} onClick={onClick}>
        {busy ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}
