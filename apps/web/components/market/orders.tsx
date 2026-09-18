"use client";

import { ChatCircleDots, Receipt } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { LoadFailed } from "@/components/app/load-failed";
import { EmptyState, PageHeader, Panel } from "@/components/app/panel";
import { useRealtimeEvent } from "@/components/app/realtime-provider";
import { ListNotice, TradePill, birr, timeAgo, useCountdown, usdt } from "@/components/market/bits";
import { AppLink } from "@/components/ui/app-link";
import { ButtonLink } from "@/components/ui/button";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { marketClient, type Trade } from "@/lib/market/client";

/*
  Every trade the person is a party to: the open ones, where something may
  be wanted from them, and the finished ones. Re-read when the socket says
  a trade changed or a message arrived, and on reconnect, so the unread
  count and the status pills are never stale for long.
*/

export function Orders() {
  const items: TabItem[] = [
    { id: "open", label: "Open", content: <OrderList scope="open" /> },
    { id: "closed", label: "Closed", content: <OrderList scope="closed" /> },
  ];
  return (
    <>
      <PageHeader
        title="Orders"
        description="Every trade you have started or taken, open and finished."
      />
      <Panel>
        <Tabs items={items} label="Open or closed orders" />
      </Panel>
    </>
  );
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; trades: Trade[]; nextCursor: string | null };

function OrderList({ scope }: { scope: "open" | "closed" }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(() => {
    void marketClient.trades(scope).then((result) => {
      setState((current) => {
        if (result.ok) {
          return { status: "ready", trades: result.trades, nextCursor: result.nextCursor };
        }
        return current.status === "ready" ? current : { status: "error", message: result.message };
      });
    });
  }, [scope]);

  useEffect(load, [load]);

  useRealtimeEvent("trade", load);
  useRealtimeEvent("message", load);
  useRealtimeEvent("connected", load);

  if (state.status === "loading") return <ListNotice>Loading…</ListNotice>;
  if (state.status === "error") {
    return (
      <LoadFailed
        message={state.message}
        onRetry={() => {
          setState({ status: "loading" });
          load();
        }}
      />
    );
  }
  if (state.trades.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title={scope === "open" ? "No open orders" : "No finished orders yet"}
        description={
          scope === "open"
            ? "When you buy or sell, the trade and its escrow status appear here."
            : "Completed, cancelled and expired trades are kept here."
        }
        action={
          scope === "open" ? (
            <ButtonLink href="/trade" size="sm" variant="secondary" arrow={false}>
              Find an offer
            </ButtonLink>
          ) : undefined
        }
      />
    );
  }

  return (
    <ul className="divide-border -mx-1 divide-y">
      {state.trades.map((trade) => (
        <OrderRow key={trade.id} trade={trade} />
      ))}
    </ul>
  );
}

function OrderRow({ trade }: { trade: Trade }) {
  const waiting = trade.status === "AWAITING_FIAT_PAYMENT";
  const countdown = useCountdown(trade.paymentDeadline, waiting);
  return (
    <li>
      <AppLink
        href={`/orders/${trade.id}`}
        className="hover:bg-muted/60 rounded-control flex flex-col gap-2 px-3 py-4 transition-colors duration-150 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <p className="text-foreground text-[15px] font-semibold">
            {trade.role === "BUYER" ? "Buy" : "Sell"} {usdt(trade.amount)}
            <span className="text-muted-foreground font-normal"> · {birr(trade.fiatSantim)}</span>
          </p>
          <p className="text-muted-foreground mt-0.5 text-[13px]">
            {trade.role === "BUYER" ? "from" : "to"} {trade.counterparty.username} ·{" "}
            {timeAgo(trade.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {trade.chat.unread > 0 ? (
            <span className="bg-primary text-primary-foreground inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-semibold">
              <ChatCircleDots size={14} weight="fill" aria-hidden="true" />
              {trade.chat.unread}
              <span className="sr-only"> unread messages</span>
            </span>
          ) : null}
          {waiting ? (
            <span
              className={cn(
                "font-mono text-[13px] tabular-nums",
                countdown.secondsLeft < 300 ? "text-status-attention-fg" : "text-muted-foreground",
              )}
            >
              {countdown.expired ? "Time is up" : countdown.label}
            </span>
          ) : null}
          <TradePill trade={trade} />
        </div>
      </AppLink>
    </li>
  );
}
