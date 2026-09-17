"use client";

import { Megaphone } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { EmptyState, PageHeader, Panel } from "@/components/app/panel";
import { FormError } from "@/components/auth/notices";
import {
  BackTo,
  ConfirmButton,
  ListNotice,
  PaymentKindChips,
  birr,
  usdt,
} from "@/components/market/bits";
import { useMayPostAds, VerifyToPost } from "@/components/market/verify-to-post";
import { Button, ButtonLink } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { type MyOffer, type OfferStatus, marketClient } from "@/lib/market/client";
import { ASSET, FIAT } from "@/lib/market/labels";
import { formatSantim } from "@/lib/market/money";

/*
  The ads a person has posted, in the three states Binance keeps them in:
  online, offline, closed. Taking an ad offline hides it from the market
  without losing anything; closing it ends it for good, which is why closed
  ones live in their own tab rather than among the live ones. Neither touches
  an order already running - an order's price, escrow and terms are its own
  from the moment it opens.
*/

const TABS = [
  { id: "online", label: "Online", status: "ACTIVE" },
  { id: "offline", label: "Offline", status: "PAUSED" },
  { id: "closed", label: "Closed", status: "CLOSED" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const tabFor = (value: string | null): TabId =>
  TABS.find((tab) => tab.id === value)?.id ?? "online";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; offers: MyOffer[] };

export function MyAds() {
  const mayPost = useMayPostAds();
  const router = useRouter();
  const tab = tabFor(useSearchParams().get("tab"));
  const [state, setState] = useState<State>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void marketClient.myOffers().then((result) => {
      setState(
        result.ok
          ? { status: "ready", offers: result.offers }
          : { status: "error", message: result.message },
      );
    });
  }, []);
  useEffect(refresh, [refresh]);

  const act = async (offer: MyOffer, action: "pause" | "resume" | "close") => {
    setError(null);
    setBusy(offer.id);
    const result = await marketClient.setOfferStatus(offer.id, action);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
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
          <ListNotice>{state.message}</ListNotice>
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
          <ul className="divide-border divide-y">
            {list.map((offer) => (
              <Row
                key={offer.id}
                offer={offer}
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
      <BackTo href="/trade">Marketplace</BackTo>
      <PageHeader title="My ads" description="What you have posted, and what is left on each.">
        {mayPost ? (
          <ButtonLink href="/trade/ads/new" size="sm" arrow={false}>
            Post an ad
          </ButtonLink>
        ) : null}
      </PageHeader>

      <VerifyToPost className="mb-4" />

      <Panel>
        {error ? <FormError message={error} /> : null}
        <Tabs
          items={items}
          value={tab}
          onValueChange={(id) => router.replace(`/trade/ads?tab=${id}`, { scroll: false })}
          label="Ads by state"
        />
      </Panel>
    </>
  );
}

function Row({
  offer,
  busy,
  onAct,
}: {
  offer: MyOffer;
  busy: boolean;
  onAct: (action: "pause" | "resume" | "close") => Promise<void>;
}) {
  const kinds = offer.paymentMethods.map((method) => method.kind);
  const orders =
    offer.openOrders > 0
      ? ` · ${offer.openOrders} open order${offer.openOrders === 1 ? "" : "s"}`
      : "";

  return (
    <li className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground text-[15px] font-semibold">
            {offer.side === "SELL" ? `Selling ${ASSET}` : `Buying ${ASSET}`}
          </span>
          <span className="text-foreground font-mono text-[15px] tabular-nums">
            at {formatSantim(offer.priceSantim)} {FIAT}
          </span>
        </div>
        <p className="text-muted-foreground mt-1 text-[13px] tabular-nums">
          {usdt(offer.remainingAmount)} of {usdt(offer.totalAmount)} left ·{" "}
          {formatSantim(offer.minSantim)} – {birr(offer.maxSantim)} a trade ·{" "}
          {offer.paymentWindowMinutes} min to pay
          {orders}
        </p>
        <PaymentKindChips kinds={[...new Set(kinds)]} className="mt-1.5" />
      </div>
      {offer.status === "CLOSED" ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ButtonLink
            href={`/trade/ads/${offer.id}/edit`}
            variant="secondary"
            size="sm"
            arrow={false}
          >
            Edit
          </ButtonLink>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => onAct(offer.status === "ACTIVE" ? "pause" : "resume")}
          >
            {offer.status === "ACTIVE" ? "Take offline" : "Put online"}
          </Button>
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
      )}
    </li>
  );
}
