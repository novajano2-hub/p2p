"use client";

import { ArrowDown, Info, Megaphone, Plus, WarningCircle } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";

import { LoadFailed } from "@/components/app/load-failed";
import { EmptyState, PageHeader } from "@/components/app/panel";
import { useRealtimeEvent } from "@/components/app/realtime-provider";
import { FormError } from "@/components/auth/notices";
import {
  BackTo,
  ConfirmButton,
  ListNotice,
  PaymentKindChips,
  birr,
  dateTime,
  usdt,
} from "@/components/market/bits";
import { useMayPostAds, VerifyToPost } from "@/components/market/verify-to-post";
import { ButtonLink } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { walletRoutes } from "@/lib/app-nav";
import { cn } from "@/lib/cn";
import { type MyOffer, type OfferStatus, marketClient } from "@/lib/market/client";
import { ASSET, FIAT, untilLabel } from "@/lib/market/labels";
import { fiatForAmount, formatSantim } from "@/lib/market/money";
import { toast, toastFailure } from "@/lib/toast";
import { walletClient } from "@/lib/wallet/client";

/*
  The ads a person has posted, in the three states Binance keeps them in:
  online, offline, closed. Taking an ad offline hides it from the market
  without losing anything; closing it ends it for good, which is why closed
  ones live in their own tab rather than among the live ones. Neither touches
  an order already running - an order's price, escrow and terms are its own
  from the moment it opens.

  Posting an ad locks nothing, so each one also says what it can offer right
  now - its ad balance - and, when the market is not showing it, why: the
  seller's balance cannot cover its smallest order (red, with the time left
  before it goes offline by itself), or what is left of it is too little for
  one order (amber). The balance every sell ad draws on sits above them all.
*/

const TABS = [
  { id: "online", label: "Online", status: "ACTIVE" },
  { id: "offline", label: "Offline", status: "PAUSED" },
  { id: "closed", label: "Closed", status: "CLOSED" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** What taking an ad offline, putting it back or closing it did, said once it has. */
function done(action: "pause" | "resume" | "close", offer: MyOffer): [string, string] {
  if (action === "pause") {
    return ["Ad taken offline", "It is hidden from the market until you put it back online."];
  }
  if (action === "resume") return ["Ad back online", "It is listed in the market again."];
  const orders = offer.openOrders;
  return [
    "Ad closed",
    orders > 0
      ? `${orders} open order${orders === 1 ? "" : "s"} will finish normally. It is kept under Closed.`
      : "It is kept under Closed.",
  ];
}

const tabFor = (value: string | null): TabId =>
  TABS.find((tab) => tab.id === value)?.id ?? "online";

const posted = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; offers: MyOffer[] };

/** The time now, moved on every minute: enough for a countdown in hours and minutes. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function MyAds() {
  const mayPost = useMayPostAds();
  const router = useRouter();
  const tab = tabFor(useSearchParams().get("tab"));
  const [state, setState] = useState<State>({ status: "loading" });
  // Null until known; a balance that did not load is a dash, never a zero.
  const [available, setAvailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const now = useMinute();

  const refresh = useCallback(() => {
    void marketClient.myOffers().then((result) => {
      setState(
        result.ok
          ? { status: "ready", offers: result.offers }
          : { status: "error", message: result.message },
      );
    });
    void walletClient.balance().then((result) => {
      setAvailable(result.ok ? result.balance.available : null);
    });
  }, []);
  useEffect(refresh, [refresh]);

  /*
    The platform changes ads too: it hides one the seller's balance stops
    covering, and takes it offline after a day of that. Each time it tells the
    seller over the socket, and the list looks again - so the toast saying an
    ad went offline and the tab it sits under never disagree.
  */
  useRealtimeEvent("notification", (frame) => {
    const { type } = frame.notification;
    if (type === "OFFER_HIDDEN" || type === "OFFER_PAUSED") refresh();
  });

  const act = async (offer: MyOffer, action: "pause" | "resume" | "close") => {
    setError(null);
    setBusy(offer.id);
    const result = await marketClient.setOfferStatus(offer.id, action);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      toastFailure(result);
      // Closed from another device, taken offline in another tab: show what is true now.
      if (result.code === "CONFLICT") refresh();
      return;
    }
    const [title, description] = done(action, offer);
    toast.success(title, { description });
    refresh();
  };

  const offers = state.status === "ready" ? state.offers : [];
  const of = (status: OfferStatus) => offers.filter((offer) => offer.status === status);

  const items = TABS.map((entry) => {
    const list = of(entry.status);
    return {
      id: entry.id,
      // The count is worth having in the tab: an advertiser wants to know at a
      // glance whether anything of theirs is live at all.
      label: state.status === "ready" ? `${entry.label} (${list.length})` : entry.label,
      content:
        state.status === "loading" ? (
          <ListNotice>Loading…</ListNotice>
        ) : state.status === "error" ? (
          <LoadFailed
            message={state.message}
            onRetry={() => {
              setState({ status: "loading" });
              refresh();
            }}
          />
        ) : list.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title={
              entry.id === "online"
                ? "No ads online"
                : entry.id === "offline"
                  ? "No ads offline"
                  : "No closed ads"
            }
            description={
              entry.id === "online"
                ? "Post an ad to sell USDT at your price, or to buy it. Buyers and sellers find you in the marketplace."
                : entry.id === "offline"
                  ? "An ad you take offline waits here until you put it back online."
                  : "An ad you close ends for good and is kept here."
            }
            {...(entry.id === "online" && mayPost
              ? {
                  action: (
                    <ButtonLink href="/trade/ads/new" size="sm" variant="secondary" arrow={false}>
                      Post an ad
                    </ButtonLink>
                  ),
                }
              : {})}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((offer) => (
              <AdCard
                key={offer.id}
                offer={offer}
                now={now}
                busy={busy === offer.id}
                onAct={(action) => act(offer, action)}
              />
            ))}
          </ul>
        ),
    };
  });

  return (
    <>
      <BackTo href="/trade">P2P market</BackTo>
      <PageHeader
        title="My ads"
        description="What you have posted, what each one can offer right now, and why the market is not showing one."
      >
        <ButtonLink href="/trade/payment-methods" variant="secondary" size="sm" arrow={false}>
          Payment methods
        </ButtonLink>
        {mayPost ? (
          <ButtonLink href="/trade/ads/new" size="sm" arrow={false}>
            <Plus size={15} weight="bold" aria-hidden="true" />
            Post an ad
          </ButtonLink>
        ) : null}
      </PageHeader>

      <VerifyToPost className="mb-4" />

      <section
        aria-label="Your available balance"
        className="rounded-surface border-border bg-surface shadow-panel flex flex-wrap items-center gap-x-6 gap-y-3 border px-5 py-4 sm:px-6"
      >
        <div>
          <p className="text-muted-foreground text-[12px] font-medium">
            Available balance your sell ads draw on
          </p>
          <p className="text-foreground font-mono text-lg font-medium tabular-nums">
            {available === null ? `— ${ASSET}` : usdt(available)}
          </p>
        </div>
        <p className="text-muted-foreground min-w-0 flex-1 basis-64 text-[13px] leading-relaxed">
          Posting locks nothing. A sell ad offers what your balance covers, and hides while that is
          less than its smallest order.
        </p>
        <ButtonLink href={walletRoutes.deposit} variant="secondary" size="sm" arrow={false}>
          <ArrowDown size={15} weight="bold" aria-hidden="true" />
          Deposit USDT
        </ButtonLink>
      </section>

      <div className="mt-5">
        {error ? <FormError message={error} /> : null}
        <Tabs
          items={items}
          value={tab}
          onValueChange={(id) => router.replace(`/trade/ads?tab=${id}`, { scroll: false })}
          label="Ads by state"
        />
      </div>
    </>
  );
}

function AdCard({
  offer,
  now,
  busy,
  onAct,
}: {
  offer: MyOffer;
  now: number;
  busy: boolean;
  onAct: (action: "pause" | "resume" | "close") => Promise<void>;
}) {
  const kinds = offer.paymentMethods.map((method) => method.kind);
  const switchLabel = useId();
  const closed = offer.status === "CLOSED";
  const live = offer.status === "ACTIVE";
  const hidden = offer.hiddenBecause;
  const orders =
    offer.openOrders > 0
      ? `${offer.openOrders} open order${offer.openOrders === 1 ? "" : "s"}`
      : null;

  return (
    <li className="rounded-surface border-border bg-surface shadow-panel min-w-0 border px-5 py-4 sm:px-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1.5fr)_auto] lg:items-start">
        <div className="flex flex-col gap-1">
          <span
            className={cn(
              "self-start rounded-full px-2.5 py-0.5 text-[12px] font-semibold",
              offer.side === "SELL"
                ? "bg-status-attention text-status-attention-fg"
                : "bg-status-complete text-status-complete-fg",
            )}
          >
            {offer.side === "SELL" ? `Selling ${ASSET}` : `Buying ${ASSET}`}
          </span>
          <span>
            <span className="text-foreground font-mono text-xl font-medium tabular-nums">
              {formatSantim(offer.priceSantim)}
            </span>{" "}
            <span className="text-muted-foreground text-[12px]">{FIAT}</span>
          </span>
          <span className="text-muted-foreground text-[12px]">
            Posted {posted.format(new Date(offer.createdAt))}
          </span>
        </div>

        <div className="flex flex-col gap-1 text-[13px] tabular-nums">
          <span>
            <span className="text-muted-foreground">Left</span> {usdt(offer.remainingAmount)}{" "}
            <span className="text-muted-foreground">of</span> {usdt(offer.totalAmount)}
          </span>
          <span>
            <span className="text-muted-foreground">Limits</span> {formatSantim(offer.minSantim)} –{" "}
            {birr(offer.maxSantim)}
          </span>
          <span>
            <span className="text-muted-foreground">
              {offer.side === "SELL" ? "Buyers pay within" : "You pay within"}
            </span>{" "}
            {offer.paymentWindowMinutes} min
          </span>
          <PaymentKindChips kinds={[...new Set(kinds)]} className="mt-1" />
        </div>

        {closed ? (
          <div className="text-muted-foreground text-[13px]">Closed for good.</div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-[12px] font-medium">Ad balance</span>
            <span
              className={cn(
                "font-mono text-lg font-semibold tabular-nums",
                hidden === "BALANCE"
                  ? "text-status-attention-fg"
                  : hidden === "REMAINDER"
                    ? "text-status-pending-fg"
                    : "text-foreground",
              )}
            >
              {usdt(offer.adBalance)}
            </span>
            <span className="text-muted-foreground text-[12px]">
              {hidden === "BALANCE"
                ? `Worth ${birr(fiatForAmount(offer.adBalance, offer.priceSantim))}, below the ${formatSantim(offer.minSantim)} minimum`
                : hidden === "REMAINDER"
                  ? `Only ${usdt(offer.remainingAmount)} left in the ad`
                  : live
                    ? ["In the market now", orders].filter(Boolean).join(" · ")
                    : "Shows again when you switch it on"}
            </span>
          </div>
        )}

        {closed ? null : (
          <div className="flex flex-wrap items-center gap-3 lg:flex-col lg:items-end">
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <span id={switchLabel}>Online</span>
              <Switch
                checked={live}
                disabled={busy}
                onCheckedChange={(on) => void onAct(on ? "resume" : "pause")}
                aria-labelledby={switchLabel}
              />
            </span>
            <div className="flex items-center gap-2">
              <ButtonLink
                href={`/trade/ads/${offer.id}/edit`}
                variant="secondary"
                size="sm"
                arrow={false}
              >
                Edit
              </ButtonLink>
              <ConfirmButton
                question={
                  offer.openOrders > 0
                    ? `Close it? ${offer.openOrders} open order${offer.openOrders === 1 ? "" : "s"} will finish normally.`
                    : "Close it? A closed ad cannot be reopened."
                }
                confirmLabel="Close it"
                variant="ghost"
                onConfirm={() => onAct("close")}
              >
                Close
              </ConfirmButton>
            </div>
          </div>
        )}
      </div>

      {live && hidden === "BALANCE" ? (
        <div className="rounded-control bg-status-attention text-status-attention-fg mt-4 flex flex-col gap-3 px-4 py-3 text-[13px] leading-relaxed sm:flex-row sm:items-center">
          <WarningCircle
            size={20}
            weight="fill"
            aria-hidden="true"
            className="hidden shrink-0 sm:block"
          />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              Hidden from the market: your balance cannot cover the smallest order.
            </p>
            <p>
              {offer.pausesAt
                ? `Add USDT within ${untilLabel(Date.parse(offer.pausesAt) - now)}, or it goes offline on ${dateTime(offer.pausesAt)}.`
                : "Add USDT, or it goes offline after a day of this."}{" "}
              Lowering the minimum also brings it back.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <ButtonLink href={walletRoutes.deposit} size="sm" arrow={false}>
              Deposit USDT
            </ButtonLink>
            <ButtonLink
              href={`/trade/ads/${offer.id}/edit`}
              variant="secondary"
              size="sm"
              arrow={false}
            >
              Lower the minimum
            </ButtonLink>
          </div>
        </div>
      ) : hidden === "REMAINDER" && !closed ? (
        <div className="rounded-control bg-status-pending text-status-pending-fg mt-4 flex flex-col gap-3 px-4 py-3 text-[13px] leading-relaxed sm:flex-row sm:items-center">
          <Info size={20} weight="fill" aria-hidden="true" className="hidden shrink-0 sm:block" />
          <p className="min-w-0 flex-1">
            <span className="font-semibold">
              Hidden: what is left of this ad is less than one smallest order.
            </span>{" "}
            Raise the total or lower the minimum, or close it.
          </p>
          <ButtonLink
            href={`/trade/ads/${offer.id}/edit`}
            variant="secondary"
            size="sm"
            arrow={false}
            className="shrink-0 self-start sm:self-auto"
          >
            Edit ad
          </ButtonLink>
        </div>
      ) : !live && !closed && hidden === "BALANCE" ? (
        <p className="rounded-control bg-muted text-muted-foreground mt-4 px-4 py-3 text-[13px] leading-relaxed">
          Switched back on, it stays hidden until your balance covers its smallest order of{" "}
          {birr(offer.minSantim)}.
        </p>
      ) : null}
    </li>
  );
}
