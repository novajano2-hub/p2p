"use client";

import { Handshake } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { LoadFailed } from "@/components/app/load-failed";
import { EmptyState, Panel } from "@/components/app/panel";
import { useRealtimeEvent } from "@/components/app/realtime-provider";
import { TradePill, birr, useCountdown, usdt } from "@/components/market/bits";
import { AppLink } from "@/components/ui/app-link";
import { ButtonLink } from "@/components/ui/button";
import { marketClient, type Trade } from "@/lib/market/client";

/*
  Trades in progress: the ones where money is moving and a timer is running.
  This is the panel a customer checks most while a trade is open, so it sits
  high on the page. Fed by the same list the orders page reads, and told by
  the socket when something on it changed.
*/
export function ActiveTrades({ className }: { className?: string | undefined }) {
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    void marketClient.trades("open").then((result) => {
      if (result.ok) {
        setTrades(result.trades.slice(0, 4));
        setProblem(null);
      } else {
        setProblem(result.message);
      }
    });
  }, []);
  useEffect(load, [load]);
  useRealtimeEvent("trade", load);
  useRealtimeEvent("connected", load);

  return (
    <Panel
      title="Active trades"
      description="Escrow status, payment windows and what to do next."
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
          title="No active trades"
          description="When you buy or sell, the escrow and the payment countdown show up here."
          action={
            <ButtonLink href="/trade" size="sm" variant="secondary" arrow={false}>
              Find an offer
            </ButtonLink>
          }
        />
      ) : (
        <ul className="divide-border divide-y">
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
  return (
    <li>
      <AppLink
        href={`/orders/${trade.id}`}
        className="hover:bg-muted/60 rounded-control -mx-2 flex items-center justify-between gap-3 px-2 py-3 transition-colors duration-150"
      >
        <span className="min-w-0">
          <span className="text-foreground block text-sm font-medium">
            {trade.role === "BUYER" ? "Buy" : "Sell"} {usdt(trade.amount)} ·{" "}
            {birr(trade.fiatSantim)}
          </span>
          <span className="text-muted-foreground block text-[12px]">
            {trade.role === "BUYER" ? "from" : "to"} {trade.counterparty.username}
            {waiting ? ` · ${countdown.expired ? "time is up" : `${countdown.label} to pay`}` : ""}
          </span>
        </span>
        <TradePill trade={trade} />
      </AppLink>
    </li>
  );
}
