"use client";

import { ChatCircleDots, Handshake } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { LoadFailed } from "@/components/app/load-failed";
import { EmptyState, Panel } from "@/components/app/panel";
import { useRealtimeEvent } from "@/components/app/realtime-provider";
import { TradePill, birr, useCountdown, usdt } from "@/components/market/bits";
import { AppLink } from "@/components/ui/app-link";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { marketClient, type Trade } from "@/lib/market/client";
import { chatLink, rowAction } from "@/lib/market/orders";

/*
  Orders in progress: the ones where money is moving and a timer is running.

  This is the panel a customer checks most while an order is open, so it sits
  high on the page, and it speaks the orders list's language: the button says
  what is wanted of you - Pay now, Release, or View - and the chat carries
  what is unread. Fed by the same list the orders page reads, and told by the
  socket when something on it changed or somebody wrote.
*/

/** As many as Home shows; the rest are one press away. */
const SHOWN = 4;

export function ActiveTrades({ className }: { className?: string | undefined }) {
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [more, setMore] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    void marketClient.trades({ scope: "open" }).then((result) => {
      if (result.ok) {
        setTrades(result.trades.slice(0, SHOWN));
        setMore(result.trades.length > SHOWN || result.nextCursor !== null);
        setProblem(null);
      } else {
        setProblem(result.message);
      }
    });
  }, []);

  useEffect(load, [load]);
  useRealtimeEvent("trade", load);
  useRealtimeEvent("message", load);
  useRealtimeEvent("connected", load);

  return (
    <Panel
      title="Orders in progress"
      badge={trades && trades.length > 0 ? `${trades.length}${more ? "+" : ""}` : undefined}
      action={
        <AppLink
          href="/orders"
          className="text-primary hover:text-primary-hover font-medium underline-offset-4 hover:underline"
        >
          All orders
        </AppLink>
      }
      className={className}
    >
      {trades === null && problem ? (
        <LoadFailed
          message={problem}
          onRetry={() => {
            setProblem(null);
            load();
          }}
        />
      ) : trades === null ? (
        <p className="text-muted-foreground px-4 py-8 text-center text-[13px]">Loading…</p>
      ) : trades.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="Nothing in progress"
          description="When you buy or sell, the order, its countdown and what it wants from you show up here."
          action={
            <ButtonLink href="/trade" size="sm" variant="secondary" arrow={false}>
              Go to the market
            </ButtonLink>
          }
        />
      ) : (
        <ul className="divide-border -mb-1 divide-y">
          {trades.map((trade) => (
            <Row key={trade.id} trade={trade} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Row({ trade }: { trade: Trade }) {
  const waiting = trade.status === "AWAITING_FIAT_PAYMENT";
  const countdown = useCountdown(trade.paymentDeadline, waiting);
  const buying = trade.role === "BUYER";
  const action = rowAction(trade);
  const unread = trade.chat.unread;
  const other = trade.counterparty.username;

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-3.5 first:pt-1">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              "inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-semibold whitespace-nowrap",
              buying
                ? "bg-status-complete text-status-complete-fg"
                : "bg-status-attention text-status-attention-fg",
            )}
          >
            {buying ? "Buy" : "Sell"} USDT
          </span>
          <span className="text-foreground text-sm font-semibold tabular-nums">
            {usdt(trade.amount)}
          </span>
          <span className="text-muted-foreground text-[13px] tabular-nums">
            {birr(trade.fiatSantim)}
          </span>
        </p>
        <p className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
          <span>
            {buying ? "from" : "to"} {other}
          </span>
          <TradePill trade={trade} />
          {waiting ? (
            <span
              className={cn(
                "font-mono tabular-nums",
                countdown.secondsLeft < 300 ? "text-status-attention-fg" : "",
              )}
            >
              {countdown.expired ? "Time is up" : `${countdown.label} left`}
            </span>
          ) : null}
        </p>
      </div>

      <div className="flex items-center gap-2 max-sm:w-full">
        <AppLink
          href={chatLink(trade.id)}
          aria-label={unread > 0 ? `Chat with ${other}, ${unread} unread` : `Chat with ${other}`}
          className="rounded-control border-border bg-surface text-foreground hover:text-primary relative flex h-9 items-center justify-center gap-1.5 border px-3 text-[13px] font-semibold transition-colors duration-150 max-sm:flex-1"
        >
          <ChatCircleDots size={16} aria-hidden="true" />
          <span className="sm:sr-only">Chat</span>
          {unread > 0 ? (
            <span
              aria-hidden="true"
              className="bg-primary text-primary-foreground flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] leading-none font-bold tabular-nums"
            >
              {unread}
            </span>
          ) : null}
        </AppLink>
        <ButtonLink
          href={`/orders/${trade.id}`}
          variant={action.primary ? "primary" : "secondary"}
          size="sm"
          arrow={false}
          className="min-w-[5.5rem] max-sm:flex-1"
        >
          {action.label}
        </ButtonLink>
      </div>
    </li>
  );
}
