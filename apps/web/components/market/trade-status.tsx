"use client";

import { Check, Warning } from "@phosphor-icons/react";
import { Fragment } from "react";

import { birr, clockTime } from "@/components/market/bits";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { Trade } from "@/lib/market/client";
import { PAYMENT_KINDS } from "@/lib/market/labels";
import { orderProgress, type StepState } from "@/lib/market/orders";

/*
  The top of an order: what to do now, how long is left to do it, and where
  the order is in its three steps - Binance's order header. The sentence
  under it is the server's own word for where things stand, plus, for a
  seller, what the buyer has said: how much, to which account, when, and the
  reference they gave.

  Three steps in a row where there is room; on a phone, "Step 1 of 3" and a
  bar, as the ad form does it.
*/

type Countdown = { label: string; expired: boolean; secondsLeft: number };

export function OrderStatus({ trade, countdown }: { trade: Trade; countdown: Countdown }) {
  const progress = orderProgress(trade.status, trade.role);
  const waiting = trade.status === "AWAITING_FIAT_PAYMENT";
  const buying = trade.role === "BUYER";
  const done = trade.status === "COMPLETED";
  const disputed = trade.status === "DISPUTED";

  return (
    <section
      aria-label="Where this order stands"
      className="rounded-surface border-border bg-surface shadow-panel flex min-w-0 flex-col gap-4 border px-5 py-5 sm:px-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {done || disputed ? (
            <span
              aria-hidden="true"
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-full",
                done
                  ? "bg-status-complete text-status-complete-fg"
                  : "bg-status-attention text-status-attention-fg",
              )}
            >
              {done ? <Check size={22} weight="bold" /> : <Warning size={20} weight="bold" />}
            </span>
          ) : null}
          <div className="min-w-0">
            {progress.step !== null && !done && !disputed ? (
              <p className="text-muted-foreground text-[12px] font-medium">
                Step {progress.step} of 3
              </p>
            ) : null}
            <h2 className="font-display text-foreground text-xl leading-tight sm:text-[1.375rem]">
              {progress.title}
            </h2>
          </div>
        </div>
        {waiting ? (
          <div className="flex shrink-0 flex-col items-end" aria-live="off">
            <span
              className={cn(
                "font-mono text-2xl leading-none font-medium tabular-nums sm:text-[1.75rem]",
                countdown.secondsLeft < 300 ? "text-status-attention-fg" : "text-foreground",
              )}
            >
              {countdown.expired ? "Time is up" : countdown.label}
            </span>
            {countdown.expired ? null : (
              <span className="text-muted-foreground mt-1 text-[12px]">
                {buying ? "left to pay" : "left for the buyer to pay"}
              </span>
            )}
          </div>
        ) : null}
        {done && buying ? (
          <ButtonLink
            href="/wallet"
            variant="secondary"
            size="sm"
            arrow={false}
            className="shrink-0"
          >
            Go to wallet
          </ButtonLink>
        ) : null}
      </div>

      {progress.states ? (
        <>
          <StepRow labels={progress.labels} states={progress.states} />
          <div className="grid grid-cols-3 gap-1 sm:hidden" aria-hidden="true">
            {progress.states.map((state, index) => (
              <span
                key={index}
                className={cn(
                  "h-1 rounded-full",
                  state === "warn"
                    ? "bg-status-attention-fg"
                    : state === "todo"
                      ? "bg-border"
                      : "bg-primary",
                )}
              />
            ))}
          </div>
        </>
      ) : null}

      <StatusNote trade={trade} />
    </section>
  );
}

function StepRow({
  labels,
  states,
}: {
  labels: readonly [string, string, string];
  states: readonly [StepState, StepState, StepState];
}) {
  return (
    <ol className="hidden items-center gap-3 sm:flex">
      {labels.map((label, index) => {
        const state = states[index] ?? "todo";
        return (
          <Fragment key={label}>
            <li
              aria-current={state === "on" || state === "warn" ? "step" : undefined}
              className={cn(
                "flex items-center gap-2.5 text-sm whitespace-nowrap",
                state === "on" && "text-foreground font-semibold",
                state === "warn" && "text-status-attention-fg font-semibold",
                (state === "todo" || state === "done") && "text-muted-foreground font-medium",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-[26px] shrink-0 items-center justify-center rounded-full border text-[13px] tabular-nums",
                  state === "done" &&
                    "bg-primary-soft text-primary-soft-foreground border-transparent",
                  state === "on" && "border-primary bg-primary text-primary-foreground",
                  state === "warn" &&
                    "border-status-attention-fg bg-status-attention-fg text-surface",
                  state === "todo" && "border-border",
                )}
              >
                {state === "done" ? <Check size={13} weight="bold" /> : index + 1}
              </span>
              {label}
              {state === "done" ? <span className="sr-only"> (done)</span> : null}
            </li>
            {index < 2 ? <li aria-hidden="true" className="bg-border h-px min-w-4 flex-1" /> : null}
          </Fragment>
        );
      })}
    </ol>
  );
}

/** The sentence under the steps: the server's own, and what the other side has said or been shown. */
function StatusNote({ trade }: { trade: Trade }) {
  const other = trade.counterparty.username;
  const selling = trade.role === "SELLER";

  // What the buyer said, for the seller who is about to check their account.
  if (selling && trade.status === "BUYER_MARKED_PAID") {
    return (
      <p className="bg-status-pending text-status-pending-fg rounded-control px-4 py-3 text-[13px] leading-relaxed">
        {other} says they sent <strong className="font-semibold">{birr(trade.fiatSantim)}</strong>{" "}
        to your {trade.payment.label}
        {trade.paidAt ? ` at ${clockTime(trade.paidAt)}` : ""}.
        {trade.payment.reference ? (
          <>
            {" "}
            Transfer reference:{" "}
            <span className="font-mono tabular-nums">{trade.payment.reference}</span>
          </>
        ) : null}
      </p>
    );
  }

  if (selling && trade.status === "AWAITING_FIAT_PAYMENT") {
    return (
      <p className="bg-primary-soft text-primary-soft-foreground rounded-control px-4 py-3 text-[13px] leading-relaxed">
        {other} has been shown your {PAYMENT_KINDS[trade.payment.kind].label} details (
        {trade.payment.label}) and has until the timer runs out to send {birr(trade.fiatSantim)}.
        Nothing to do until they say they have paid.
      </p>
    );
  }

  if (!trade.message) return null;
  const open = trade.status === "AWAITING_FIAT_PAYMENT" || trade.status === "BUYER_MARKED_PAID";
  return (
    <p
      className={cn(
        "rounded-control px-4 py-3 text-[13px] leading-relaxed",
        open
          ? "bg-primary-soft text-primary-soft-foreground"
          : "bg-muted text-foreground [overflow-wrap:anywhere]",
      )}
    >
      {trade.message}
    </p>
  );
}
