"use client";

import { ArrowLeft, SealCheck } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";

import { AppLink } from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/cn";
import {
  ASSET,
  FIAT,
  PAYMENT_KINDS,
  releaseHint,
  tradeStatusPill,
  traderRecord,
} from "@/lib/market/labels";
import type { Advertiser, PaymentMethodKind, Trade } from "@/lib/market/client";
import { formatSantim } from "@/lib/market/money";
import { presenceLabel } from "@/lib/market/presence";
import { formatMicro } from "@/lib/money";

/* The pieces the marketplace and the orders share. */

export const usdt = (micro: string): string => `${formatMicro(micro)} ${ASSET}`;
export const birr = (santim: string): string => `${formatSantim(santim)} ${FIAT}`;

/** Rails as Binance draws them: a coloured bar and the name. */
export function PaymentKindChips({
  kinds,
  stacked = false,
  className,
}: {
  kinds: readonly PaymentMethodKind[];
  /** One under another, as the market's Payment column has them. */
  stacked?: boolean;
  className?: string | undefined;
}) {
  return (
    <ul
      className={cn(stacked ? "flex flex-col gap-1" : "flex flex-wrap gap-x-3 gap-y-1", className)}
    >
      {kinds.map((kind) => (
        <li key={kind} className="flex items-center gap-1.5 text-[13px]">
          <span
            aria-hidden="true"
            className={cn("h-3.5 w-0.5 rounded-full", PAYMENT_KINDS[kind].bar)}
          />
          {PAYMENT_KINDS[kind].label}
        </li>
      ))}
    </ul>
  );
}

/**
 * A name's initial in a circle, with the dot that says whether they are
 * around. Decoration only: the words beside it say the same for a reader.
 */
export function Avatar({
  name,
  online,
  size = "md",
}: {
  name: string;
  online: boolean;
  size?: "md" | "lg";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-primary-soft text-primary-soft-foreground relative flex shrink-0 items-center justify-center rounded-full font-semibold uppercase",
        size === "lg" ? "size-11 text-base" : "size-9 text-sm",
      )}
    >
      {name.slice(0, 1)}
      <span
        className={cn(
          "border-surface absolute -right-px -bottom-px rounded-full border-2",
          size === "lg" ? "size-3.5" : "size-3",
          online ? "bg-online" : "bg-sage",
        )}
      />
    </span>
  );
}

/** Whether they are around, and how fast they release, in one quiet line. */
export function PresenceLine({
  advertiser,
  className,
}: {
  advertiser: Advertiser;
  className?: string | undefined;
}) {
  const presence = presenceLabel(advertiser);
  const release = releaseHint(advertiser);
  if (!presence && !release) return null;
  return (
    <span className={cn("block text-[12px]", className)}>
      {presence ? (
        <span className={advertiser.online ? "text-online font-medium" : "text-muted-foreground"}>
          {presence}
        </span>
      ) : null}
      {presence && release ? <span className="text-muted-foreground"> · </span> : null}
      {release ? <span className="text-muted-foreground">{release}</span> : null}
    </span>
  );
}

/** A counterparty: the initial and its dot, name, the verified mark, their record, and whether they are around. */
export function AdvertiserLine({
  advertiser,
  compact = false,
  size = "md",
}: {
  advertiser: Advertiser;
  compact?: boolean;
  size?: "md" | "lg";
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={advertiser.username} online={advertiser.online} size={size} />
      <span className="min-w-0">
        <span className="text-foreground flex items-center gap-1.5 text-[15px] font-medium">
          <span className="truncate">{advertiser.username}</span>
          {advertiser.verified ? (
            <SealCheck
              size={16}
              weight="fill"
              aria-label="Verified"
              className="text-primary shrink-0"
            />
          ) : null}
        </span>
        {!compact ? (
          <>
            <span className="text-muted-foreground block text-[12px] tabular-nums">
              {traderRecord(advertiser)}
            </span>
            <PresenceLine advertiser={advertiser} />
          </>
        ) : null}
      </span>
    </div>
  );
}

/** The trade's status as a pill, from the viewer's side of the table. */
export function TradePill({ trade, className }: { trade: Trade; className?: string | undefined }) {
  const pill = tradeStatusPill(trade.status, trade.role);
  return (
    <StatusPill status={pill.tone} className={className}>
      {pill.label}
    </StatusPill>
  );
}

/**
 * The seconds left until a deadline, ticking. Stops at zero and says so; a
 * deadline that has passed is the server's to act on, and the screen that
 * shows it refetches rather than guesses.
 */
export function useCountdown(
  deadline: string | null,
  active: boolean,
): {
  label: string;
  expired: boolean;
  secondsLeft: number;
} {
  const target = deadline ? new Date(deadline).getTime() : 0;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || !deadline) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, deadline]);

  const secondsLeft = Math.max(0, Math.floor((target - now) / 1_000));
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  return {
    label: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
    expired: active && secondsLeft === 0,
    secondsLeft,
  };
}

/** Buy | Sell, and the like: one choice out of a few, as a segmented control. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="bg-muted rounded-control inline-flex p-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-control h-9 px-4 text-sm font-medium transition-[background-color,color,box-shadow] duration-150",
              selected
                ? "bg-surface text-foreground shadow-raised-soft"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A button that asks once before doing something that cannot be undone.
 * Inline rather than a dialog: the question sits where the answer goes.
 */
export function ConfirmButton({
  children,
  question,
  confirmLabel = "Yes",
  onConfirm,
  variant = "secondary",
  size = "sm",
  disabled,
}: {
  children: ReactNode;
  question: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  variant?: "secondary" | "destructive" | "ghost" | "primary";
  size?: "sm" | "md" | "lg";
  disabled?: boolean | undefined;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!asking) {
    return (
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        {children}
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-foreground text-[13px]">{question}</span>
      <Button
        type="button"
        variant={variant === "ghost" ? "secondary" : variant}
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {confirmLabel}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(false)}>
        No
      </Button>
    </span>
  );
}

/** The way back from a sub-page, above its heading. */
export function BackTo({ href, children }: { href: string; children: ReactNode }) {
  return (
    <AppLink
      href={href}
      className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium transition-colors duration-150"
    >
      <ArrowLeft size={15} weight="bold" aria-hidden="true" />
      {children}
    </AppLink>
  );
}

/** A quiet centred line for a list that is loading or failed, never a spinner. */
export function ListNotice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="text-muted-foreground px-4 py-8 text-center text-[13px]">
      {children}
    </p>
  );
}

const relative = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const full = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function timeAgo(iso: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

export const clockTime = (iso: string): string => clock.format(new Date(iso));
export const dateTime = (iso: string): string => full.format(new Date(iso));
