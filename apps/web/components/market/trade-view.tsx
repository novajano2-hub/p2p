"use client";

import { ChatCircleDots } from "@phosphor-icons/react";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { LoadFailed } from "@/components/app/load-failed";
import { PageHeader, Panel } from "@/components/app/panel";
import { useRealtimeEvent, useTradeSubscription } from "@/components/app/realtime-provider";
import { useSession } from "@/components/app/session-provider";
import { BackTo, ListNotice, birr, useCountdown, usdt } from "@/components/market/bits";
import { ChatPanel } from "@/components/market/trade-chat";
import { DisputePanel } from "@/components/market/trade-dispute";
import { OrderDetails, PaymentPanel } from "@/components/market/trade-payment";
import { OrderStatus } from "@/components/market/trade-status";
import { Timeline } from "@/components/market/trade-timeline";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { marketClient, type Trade } from "@/lib/market/client";
import { ASSET, FIAT, TRADE_STATUS_NOW } from "@/lib/market/labels";
import { CHAT_BESIDE, chatAsked, chatLink } from "@/lib/market/orders";
import { formatSantim } from "@/lib/market/money";
import { toast, toastFailure, type Refusal } from "@/lib/toast";
import { useMediaQuery } from "@/lib/use-media-query";

/*
  One order, from the viewer's side of the table: the Binance order page.
  What to do now and how long is left sit on top; under them the part that
  asks for something - where to pay, or the release - then the dispute, the
  figures, the terms and the record. The chat is beside all of it on a desk,
  where a person keeps it open while they pay.

  On a phone the chat is a screen of its own, Binance's way: a Chat button
  on the order carries what is unread and opens it over everything, tab bar
  included, so the message box has the bottom of the screen. That it is open
  is in the address (?chat=open) - the Back button closes it, and the orders
  list can link straight into it. One chat, mounted once: it is moved, not
  made twice, so what it has loaded and what it has reported as read are the
  same on both sides of the breakpoint.

  The page is told when the order changes - by the socket, by its own
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
  const router = useRouter();
  const params = useSearchParams();
  const beside = useMediaQuery(CHAT_BESIDE);
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const asked = chatAsked(params);
  // Whether this page has shown the order without its chat. Then the chat was opened over
  // it - by the button here, or by a toast's "Open chat" - and Back is the way out of it.
  const orderShown = useRef(false);
  useEffect(() => {
    if (!asked) orderShown.current = true;
  }, [asked]);

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
  // A message changes what is unread, which the phone's Chat button shows.
  useRealtimeEvent("message", (frame) => {
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

  const fullscreen = asked && !beside && trade !== null;

  // The chat has the whole screen: the page under it does not scroll.
  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [fullscreen]);

  const openChat = () => router.push(chatLink(tradeId), { scroll: false });
  const closeChat = () => {
    if (orderShown.current) {
      router.back();
    } else {
      // Arrived straight into the chat, from the orders list or a link: the order is what is under it.
      router.replace(`/orders/${tradeId}`, { scroll: false });
    }
    // What was read in there is no longer unread out here.
    void refresh();
  };

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
            <ListNotice>Loading the order…</ListNotice>
          )}
        </Panel>
      </>
    );
  }

  const title = `${trade.role === "BUYER" ? "Buy" : "Sell"} ${usdt(trade.amount)}`;
  const description = `${trade.role === "BUYER" ? "from" : "to"} ${trade.counterparty.username} · ${birr(trade.fiatSantim)} at ${formatSantim(trade.priceSantim)} ${FIAT} per ${ASSET}`;
  const unread = trade.chat.unread;

  return (
    <>
      {/* Below lg the way into the chat is up here, beside the way back, with what is unread. */}
      <div className="mb-4 flex items-center justify-between gap-3 [&>a]:mb-0">
        <BackTo href="/orders">Orders</BackTo>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="relative lg:hidden"
          aria-label={unread > 0 ? `Chat, ${unread} unread` : "Chat"}
          onClick={openChat}
        >
          <ChatCircleDots size={17} aria-hidden="true" />
          Chat
          {unread > 0 ? (
            <span
              aria-hidden="true"
              className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] leading-none font-bold tabular-nums"
            >
              {unread}
            </span>
          ) : null}
        </Button>
      </div>
      <PageHeader title={title} description={description} />

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start lg:gap-6">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-7">
          <OrderStatus trade={trade} countdown={countdown} />
          <PaymentPanel
            trade={trade}
            expired={countdown.expired}
            onUpdated={setTrade}
            onConflict={(refusal) => onConflict(refusal, trade.status)}
          />
          <DisputePanel
            trade={trade}
            onUpdated={refresh}
            onConflict={(refusal) => onConflict(refusal, trade.status)}
          />
          <OrderDetails trade={trade} />
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
          <Timeline trade={trade} />
        </div>

        {/* One chat: beside the order from lg up, the whole screen on a phone when asked for, else out of sight. */}
        <div
          className={cn(
            "min-w-0 lg:sticky lg:top-24 lg:col-span-5",
            fullscreen ? "fixed inset-0 z-50 flex flex-col" : "max-lg:hidden",
          )}
        >
          <ChatPanel
            trade={trade}
            myUserId={user.id}
            visible={beside || fullscreen}
            fullscreen={fullscreen}
            onClose={closeChat}
          />
        </div>
      </div>

      {/* Room for the buttons pinned above the tab bar on a phone. */}
      {trade.actions.canMarkPaid ? <div aria-hidden="true" className="h-28 lg:hidden" /> : null}
    </>
  );

  function setTrade(next: Trade) {
    setState({ status: "ready", trade: next });
  }
}
