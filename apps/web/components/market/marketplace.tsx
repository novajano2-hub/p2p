"use client";

import { Storefront } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { EmptyState, PageHeader, Panel } from "@/components/app/panel";
import {
  AdvertiserLine,
  ListNotice,
  PaymentKindChips,
  Segmented,
  birr,
  usdt,
} from "@/components/market/bits";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import {
  marketClient,
  type MarketOffer,
  type OfferSide,
  type PaymentMethodKind,
} from "@/lib/market/client";
import { FIAT, PAYMENT_KINDS, PAYMENT_KIND_LIST } from "@/lib/market/labels";
import { formatSantim, toSantim } from "@/lib/market/money";

/*
  The marketplace, the way Binance lays it out and this audience already
  reads it: Buy or Sell first, then the amount and the rail as filters, then
  the advertisers - name and record, price, what is available and the
  limits, how they can be paid, and the one button.

  "Buy" lists SELL offers and "Sell" lists BUY offers: the toggle is what the
  viewer wants to do, not what the advertiser posted, because that is the
  question a person arrives with. Prices are best first: lowest when buying,
  highest when selling, which is the server's order.
*/

const SIDES = [
  { value: "BUY", label: "Buy USDT" },
  { value: "SELL", label: "Sell USDT" },
] as const;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; offers: MarketOffer[]; nextCursor: string | null };

export function Marketplace() {
  /*
    Which side is being browsed lives in the address rather than in state, so
    that a link to it means something: /trade?want=SELL opens on Sell, and
    flipping the toggle puts the side back into the address, which makes what
    you are looking at shareable. Replaced rather than pushed, so that flicking
    the toggle does not fill the history with entries and Back still leaves the
    marketplace. Read loosely: a typed ?want=sell is the same request.
  */
  const router = useRouter();
  const params = useSearchParams();
  const want: OfferSide = params.get("want")?.toUpperCase() === "SELL" ? "SELL" : "BUY";
  const setWant = (side: OfferSide) => {
    router.replace(side === "SELL" ? "/trade?want=SELL" : "/trade", { scroll: false });
  };
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<PaymentMethodKind | "">("");
  const [state, setState] = useState<State>({ status: "loading" });
  const [more, setMore] = useState(false);

  const amountSantim = toSantim(amount) ?? undefined;
  const amountProblem =
    amount !== "" && amountSantim === undefined ? "Enter an amount in birr." : null;

  const load = useCallback(
    async (cursor?: string) => {
      const result = await marketClient.marketplace({
        want,
        amountSantim,
        paymentKind: kind || undefined,
        cursor,
      });
      return result;
    },
    [want, amountSantim, kind],
  );

  useEffect(() => {
    let live = true;
    // The filters changed: start again from the first page.
    void load().then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? { status: "ready", offers: result.offers, nextCursor: result.nextCursor }
          : { status: "error", message: result.message },
      );
    });
    return () => {
      live = false;
    };
  }, [load]);

  const loadMore = async () => {
    if (state.status !== "ready" || !state.nextCursor) return;
    setMore(true);
    const result = await load(state.nextCursor);
    setMore(false);
    if (result.ok) {
      setState({
        status: "ready",
        offers: [...state.offers, ...result.offers],
        nextCursor: result.nextCursor,
      });
    }
  };

  return (
    <>
      <PageHeader
        title="Trade"
        description="Buy and sell USDT for birr with other customers. Every trade is held in escrow until the seller confirms the birr arrived."
      >
        <ButtonLink href="/trade/payment-methods" variant="secondary" size="sm" arrow={false}>
          Payment methods
        </ButtonLink>
        <ButtonLink href="/trade/ads" variant="secondary" size="sm" arrow={false}>
          My ads
        </ButtonLink>
        <ButtonLink href="/trade/ads/new" size="sm" arrow={false}>
          Post an ad
        </ButtonLink>
      </PageHeader>

      <Panel>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Segmented value={want} onChange={setWant} options={SIDES} label="Buy or sell" />
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <div className="relative">
              <Input
                aria-label={`Amount in ${FIAT}`}
                aria-invalid={amountProblem ? true : undefined}
                inputMode="decimal"
                placeholder="Amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="pr-14"
              />
              <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[13px] font-medium">
                {FIAT}
              </span>
            </div>
            <Select
              aria-label="Payment method"
              value={kind}
              onChange={(event) => setKind(event.target.value as PaymentMethodKind | "")}
            >
              <option value="">All payment methods</option>
              {PAYMENT_KIND_LIST.map((value) => (
                <option key={value} value={value}>
                  {PAYMENT_KINDS[value].label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {amountProblem ? (
          <p role="alert" className="text-destructive mt-2 text-[13px]">
            {amountProblem}
          </p>
        ) : null}

        <div className="mt-5">
          {state.status === "loading" ? (
            <ListNotice>Finding offers…</ListNotice>
          ) : state.status === "error" ? (
            <ListNotice>{state.message}</ListNotice>
          ) : state.offers.length === 0 ? (
            <EmptyState
              icon={Storefront}
              title={want === "BUY" ? "Nobody is selling right now" : "Nobody is buying right now"}
              description={
                amount || kind
                  ? "Try a different amount or payment method, or post an ad of your own."
                  : "Post an ad and be the first offer on this side of the market."
              }
              action={
                <ButtonLink href="/trade/ads/new" size="sm" variant="secondary" arrow={false}>
                  Post an ad
                </ButtonLink>
              }
            />
          ) : (
            <>
              <div
                aria-hidden="true"
                className="text-muted-foreground hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1.4fr)_auto] gap-4 px-2 pb-2 text-[12px] font-medium lg:grid"
              >
                <span>Advertiser</span>
                <span>Price</span>
                <span>Available / limits</span>
                <span>Payment</span>
                <span className="w-28" />
              </div>
              <ul className="divide-border divide-y">
                {state.offers.map((offer) => (
                  <OfferRow key={offer.id} offer={offer} want={want} />
                ))}
              </ul>
              {state.nextCursor ? (
                <div className="mt-4 flex justify-center">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={more}
                    onClick={loadMore}
                  >
                    Show more
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </Panel>
    </>
  );
}

function OfferRow({ offer, want }: { offer: MarketOffer; want: OfferSide }) {
  const action = want === "BUY" ? "Buy USDT" : "Sell USDT";
  return (
    <li className="grid gap-3 px-2 py-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1.4fr)_auto] lg:items-center lg:gap-4">
      <AdvertiserLine advertiser={offer.advertiser} />

      <div>
        <span className="text-foreground font-mono text-lg font-medium tabular-nums">
          {formatSantim(offer.priceSantim)}
        </span>
        <span className="text-muted-foreground ml-1 text-[12px]">{FIAT}</span>
      </div>

      <dl className="text-[13px]">
        <div className="flex gap-2 lg:block">
          <dt className="text-muted-foreground lg:hidden">Available</dt>
          <dd className="text-foreground tabular-nums">{usdt(offer.available)}</dd>
        </div>
        <div className="flex gap-2 lg:block">
          <dt className="text-muted-foreground lg:hidden">Limits</dt>
          <dd className="text-muted-foreground tabular-nums">
            {formatSantim(offer.minSantim)} – {birr(offer.maxSantim)}
          </dd>
        </div>
      </dl>

      <PaymentKindChips kinds={offer.paymentKinds} />

      <div className="lg:w-28 lg:text-right">
        {offer.isMine ? (
          <span className="text-muted-foreground text-[13px]">Your ad</span>
        ) : (
          <ButtonLink
            href={`/trade/offers/${offer.id}`}
            size="sm"
            variant={want === "BUY" ? "primary" : "secondary"}
            arrow={false}
            className={cn("w-full lg:w-auto")}
          >
            {action}
          </ButtonLink>
        )}
      </div>
    </li>
  );
}
