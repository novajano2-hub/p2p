"use client";

import { Timer } from "@phosphor-icons/react";
import { notFound } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { LoadFailed } from "@/components/app/load-failed";
import { PageHeader, Panel } from "@/components/app/panel";
import { useRealtimeEvent, useTradeSubscription } from "@/components/app/realtime-provider";
import { useSession } from "@/components/app/session-provider";
import { BackTo, ListNotice, TradePill, birr, useCountdown, usdt } from "@/components/market/bits";
import { ChatPanel } from "@/components/market/trade-chat";
import { DisputePanel } from "@/components/market/trade-dispute";
import { PaymentPanel } from "@/components/market/trade-payment";
import { Timeline } from "@/components/market/trade-timeline";
import { cn } from "@/lib/cn";
import { marketClient, type Trade } from "@/lib/market/client";
import { ASSET, FIAT, TRADE_STATUS_NOW } from "@/lib/market/labels";
import { formatSantim } from "@/lib/market/money";
import { toast, toastFailure, type Refusal } from "@/lib/toast";

/*
  One trade, from the viewer's side of the table: the Binance order page.
  What to do sits at the top left, the chat on the right where a person
  keeps it open while they pay, and the record of what happened underneath.

  The page is told when the trade changes - by the socket, by its own
  actions, or by the countdown reaching zero - and refetches. It never
  works out a status for itself: the server's `actions` say what the
  viewer may do, and the buttons follow them exactly.

  An order that does not exist, or is somebody else's, is the app's
  not-found page: the API answers both the same way, on purpose. An action
  refused because the order moved on while the page was open - it expired,
  the other side cancelled or released - is answered by looking again and
  saying what it is now, not by the refusal's own sentence.
*/

type State =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; trade: Trade };

export function TradeView({ tradeId }: { tradeId: string }) {
  const { user } = useSession();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const refresh = useCallback(async () => {
    const result = await marketClient.trade(tradeId);
    setState((current) => {
      if (result.ok) return { status: "ready", trade: result.trade };
      return current.status === "ready" ? current : { status: "error", message: result.message };
    });
  }, [tradeId]);

  useEffect(() => {
    let live = true;
    void marketClient.trade(tradeId).then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? { status: "ready", trade: result.trade }
          : result.code === "NOT_FOUND"
            ? { status: "missing" }
            : { status: "error", message: result.message },
      );
    });
    return () => {
      live = false;
    };
  }, [tradeId, attempt]);

  useTradeSubscription(tradeId);
  useRealtimeEvent("trade", (frame) => {
    if (frame.tradeId === tradeId) void refresh();
  });
  useRealtimeEvent("connected", () => void refresh());

  const trade = state.status === "ready" ? state.trade : null;
  const waiting = trade?.status === "AWAITING_FIAT_PAYMENT";
  const countdown = useCountdown(trade?.paymentDeadline ?? null, waiting);

  // The deadline passed: the expirer acts within seconds, so look again until it has.
  useEffect(() => {
    if (!countdown.expired) return;
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [countdown.expired, refresh]);

  /*
    An action on this order was refused as out of date. Look again: if the
    order has moved on, that is the news, said in its own words, and the page
    now shows it; if it has not, the refusal was about something else, and
    its own sentence stands.
  */
  const onConflict = useCallback(
    async (refusal: Refusal, before: Trade["status"]) => {
      const result = await marketClient.trade(tradeId);
      if (!result.ok) {
        toastFailure(refusal);
        return;
      }
      setState({ status: "ready", trade: result.trade });
      if (result.trade.status === before) {
        toastFailure(refusal);
        return;
      }
      toast.warning("This order moved on while you were looking", {
        id: `order-moved:${tradeId}`,
        description: `It is ${TRADE_STATUS_NOW[result.trade.status]} now. The page shows where it stands.`,
      });
    },
    [tradeId],
  );

  if (state.status === "missing") notFound();

  if (!trade) {
    return (
      <>
        <BackTo href="/orders">Orders</BackTo>
        <Panel>
          {state.status === "error" ? (
            <LoadFailed
              message={state.message}
              onRetry={() => {
                setState({ status: "loading" });
                setAttempt((value) => value + 1);
              }}
            />
          ) : (
            <ListNotice>Loading the trade…</ListNotice>
          )}
        </Panel>
      </>
    );
  }

  const title = `${trade.role === "BUYER" ? "Buy" : "Sell"} ${usdt(trade.amount)}`;
  const description = `${trade.role === "BUYER" ? "from" : "to"} ${trade.counterparty.username} · ${birr(trade.fiatSantim)} at ${formatSantim(trade.priceSantim)} ${FIAT} per ${ASSET}`;

  return (
    <>
      <BackTo href="/orders">Orders</BackTo>
      <PageHeader title={title} description={description}>
        {waiting ? (
          <span
            className={cn(
              "rounded-control inline-flex h-9 items-center gap-1.5 px-3 font-mono text-[15px] font-medium tabular-nums",
              countdown.secondsLeft < 300
                ? "bg-status-attention text-status-attention-fg"
                : "bg-muted text-foreground",
            )}
            aria-live="off"
          >
            <Timer size={16} weight="fill" aria-hidden="true" />
            {countdown.expired ? "Time is up" : countdown.label}
          </span>
        ) : null}
        <TradePill trade={trade} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-5 lg:gap-6">
        <div className="flex flex-col gap-4 lg:col-span-3">
          <PaymentPanel
            trade={trade}
            expired={countdown.expired}
            onUpdated={setTrade}
            onConflict={(refusal) => onConflict(refusal, trade.status)}
          />
          {trade.terms ? (
            <Panel
              title="The advertiser's terms"
              description="As they stood when this order opened. Editing the ad since has not changed them."
            >
              <p className="text-foreground text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-line">
                {trade.terms}
              </p>
            </Panel>
          ) : null}
          <DisputePanel
            trade={trade}
            onUpdated={refresh}
            onConflict={(refusal) => onConflict(refusal, trade.status)}
          />
          <Timeline trade={trade} />
        </div>
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-24">
            <ChatPanel trade={trade} myUserId={user.id} />
          </div>
        </div>
      </div>
    </>
  );

  function setTrade(next: Trade) {
    setState({ status: "ready", trade: next });
  }
}
