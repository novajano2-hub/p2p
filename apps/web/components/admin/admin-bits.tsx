"use client";

import { CheckCircle, Copy } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import { AppLink } from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { type LedgerReason, type LedgerScope } from "@/lib/admin/ledger";
import { formatMicro } from "@/lib/admin/money";
import { cn } from "@/lib/cn";

/*
  The small parts every administration screen is built from, so that a
  balance, a reason and a code look the same on all of them. Numbers are
  monospaced and right-aligned because they are compared down a column; codes
  are monospaced because they are copied.

  One file rather than one per area: a second kit is how two screens end up
  with two different ideas of what an amount looks like.
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

/* ------------------------------------------------ the operations screens */

/*
  What follows is the vocabulary the deposit, withdrawal and reconciliation
  screens are written in. It is lifted, knowingly, from what the big exchanges
  show a customer about a transfer - the amount first and large, one line
  saying where it is, a rail of steps, then a flat list of the facts with the
  hashes copyable - because that arrangement answers "what happened to this
  money" faster than anything else does, and an administrator is asking the
  same question a customer is.

  What is ours: every screen also shows why a decision is pending, who it is
  about, and the ledger entries each step posted. A customer is shown a
  transfer; an administrator is shown a transfer and the case for it.
*/

export type Tone = "complete" | "pending" | "attention" | "neutral";

const TONE_SURFACE: Record<Tone, string> = {
  complete: "bg-status-complete text-status-complete-fg",
  pending: "bg-status-pending text-status-pending-fg",
  attention: "bg-status-attention text-status-attention-fg",
  neutral: "bg-status-neutral text-status-neutral-fg",
};

/** A status word, in the tone of what it means. */
export function Tag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap",
        TONE_SURFACE[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * The amount, large, with what happened to it underneath. The sign is part of
 * the story - money in reads "+", money out reads "−" - so it is passed in
 * rather than inferred from a value that is always positive.
 */
export function AmountHeader({
  sign,
  amount,
  asset,
  tone,
  status,
  note,
}: {
  sign: "+" | "−" | "";
  amount: string;
  asset: string;
  tone: Tone;
  status: string;
  note?: string;
}) {
  return (
    <div className="border-border border-b px-5 py-6 text-center">
      <p className="text-foreground font-mono text-[28px] leading-none font-semibold tabular-nums sm:text-[32px]">
        {sign}
        {formatMicro(amount)}
        <span className="text-muted-foreground ml-2 text-[15px] font-medium">{asset}</span>
      </p>
      <div className="mt-3 flex justify-center">
        <Tag tone={tone}>{status}</Tag>
      </div>
      {note ? (
        <p className="text-muted-foreground mx-auto mt-2.5 max-w-md text-[13px] leading-relaxed">
          {note}
        </p>
      ) : null}
    </div>
  );
}

export type StepState = "done" | "active" | "todo" | "failed";

/**
 * Where this transfer has got to, as a rail of steps. Only ever three or
 * four: the machines behind these screens have seven and fourteen states,
 * and a rail with fourteen stops is a diagram, not a status.
 */
export function StepRail({
  steps,
}: {
  steps: readonly { label: string; state: StepState; detail?: string }[];
}) {
  return (
    <ol className="flex items-start px-5 py-5">
      {steps.map((step, index) => {
        const first = index === 0;
        const previous = steps[index - 1]?.state;
        /*
          Each gap is drawn as two halves - the trailing rung of one step and
          the leading rung of the next - so both halves must agree or a gap
          lights halfway. Both ask the same question: did the step before this
          one complete. A failed step is where the rail stops, so nothing after
          it lights, including the half that leaves it.
        */
        const litIn = previous === "done";
        return (
          <li key={step.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <div className="flex w-full items-center">
              <Rung lit={litIn} hidden={first} />
              <Bead state={step.state} />
              <Rung lit={step.state === "done"} hidden={index === steps.length - 1} />
            </div>
            {/* w-full, so the label is bounded by its step's share of the rail
                and truncates there. Without it `items-center` shrinks this to
                the text's own width and two labels run together. */}
            <div className="w-full min-w-0 px-1 text-center">
              <p
                title={step.label}
                className={cn(
                  "truncate text-[12px] font-medium",
                  step.state === "todo" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {step.label}
              </p>
              {step.detail ? (
                <p className="text-muted-foreground mt-0.5 text-[11px] tabular-nums">
                  {step.detail}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Rung({ lit, hidden }: { lit: boolean; hidden: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "h-0.5 flex-1 rounded-full",
        hidden ? "opacity-0" : lit ? "bg-primary" : "bg-border",
      )}
    />
  );
}

function Bead({ state }: { state: StepState }) {
  const shared = "flex size-5 shrink-0 items-center justify-center rounded-full";
  if (state === "done") {
    return (
      <span className={cn(shared, "bg-primary text-primary-foreground")}>
        <Check />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className={cn(shared, "bg-destructive text-background")}>
        <Cross />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className={cn(shared, "ring-primary/30 bg-primary text-primary-foreground ring-4")}>
        <span className="bg-primary-foreground size-1.5 rounded-full" />
      </span>
    );
  }
  return <span className={cn(shared, "border-border bg-surface border-2")} />;
}

/* Two glyphs small enough that pulling in an icon set for them would be silly. */
const Check = () => (
  <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true" fill="none">
    <path
      d="M2.5 6.2 4.8 8.5 9.5 3.8"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Cross = () => (
  <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true" fill="none">
    <path
      d="M3.4 3.4 8.6 8.6M8.6 3.4 3.4 8.6"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

/** The flat label-and-value list a transfer's facts are read off. */
export function DetailList({ children }: { children: ReactNode }) {
  return <dl className="divide-border divide-y">{children}</dl>;
}

export function DetailRow({
  label,
  children,
  wrap,
}: {
  label: string;
  children: ReactNode;
  /** For a hash or an address: let it take the full width and break. */
  wrap?: boolean;
}) {
  return (
    <div
      className={cn(
        "gap-3 px-5 py-3",
        wrap ? "flex flex-col" : "flex items-baseline justify-between",
      )}
    >
      <dt className="text-muted-foreground shrink-0 text-[13px]">{label}</dt>
      <dd className={cn("text-foreground text-[13px]", wrap ? "min-w-0" : "text-right")}>
        {children}
      </dd>
    </div>
  );
}

/**
 * A hash or an address: shown whole, wrapped, with a button that copies it.
 * Never truncated with an ellipsis - somebody checking a transaction against
 * an explorer needs all of it, and the middle is where a swapped address
 * hides.
 */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex items-start gap-2">
      <span className="min-w-0 flex-1 font-mono text-[12px] break-all">{value}</span>
      <button
        type="button"
        aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            },
            () => undefined,
          );
        }}
        className="text-muted-foreground hover:text-foreground shrink-0 transition-colors duration-150"
      >
        {copied ? (
          <CheckCircle size={15} weight="fill" aria-hidden="true" className="text-primary" />
        ) : (
          <Copy size={15} aria-hidden="true" />
        )}
      </button>
    </span>
  );
}

/** Who this is about: the account number first, because that is what gets quoted. */
export function CustomerLine({
  customer,
}: {
  customer: { platformId: string; username: string; email: string } | null;
}) {
  if (!customer) {
    return <span className="text-muted-foreground text-[13px]">nobody yet</span>;
  }
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono text-[13px]">{customer.platformId}</span>
      <span className="text-muted-foreground text-[12px] break-all">
        {customer.username} · {customer.email}
      </span>
    </span>
  );
}

/**
 * What an administrator typed when they decided something, shown back as a
 * quote. A decision without its reason on screen is an unexplained decision.
 */
export function ReasonNote({ by, at, children }: { by: string; at: string; children: ReactNode }) {
  return (
    <div className="border-border bg-muted/40 rounded-surface border px-4 py-3">
      <p className="text-foreground text-[13px] leading-relaxed">{children}</p>
      <p className="text-muted-foreground mt-1.5 text-[12px]">
        {by} · {at}
      </p>
    </div>
  );
}
