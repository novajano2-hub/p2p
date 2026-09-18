"use client";

import { ArrowsClockwise, Clock, Funnel, Plus, Storefront, X } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { LoadFailed } from "@/components/app/load-failed";
import { EmptyState, PageHeader } from "@/components/app/panel";
import { AdvertiserLine, ListNotice, PaymentKindChips, birr, usdt } from "@/components/market/bits";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import {
  marketClient,
  type MarketOffer,
  type OfferSide,
  type PaymentMethodKind,
} from "@/lib/market/client";
import {
  ASSET,
  FIAT,
  PAYMENT_KINDS,
  PAYMENT_KIND_LIST,
  PAYMENT_WINDOWS,
} from "@/lib/market/labels";
import { formatSantim, toSantim } from "@/lib/market/money";
import { withNext } from "@/lib/next-path";
import { toastFailure } from "@/lib/toast";

/*
  The marketplace, laid out the way Binance lays it out and this audience
  already reads it: Buy or Sell first, then the amount, the rail and the
  filters, then the advertisers - who, and whether they are around; the
  price; what is available and the limits; how they can be paid; the one
  button.

  "Buy" lists SELL offers and "Sell" lists BUY offers: the toggle is what the
  viewer wants to do, not what the advertiser posted, because that is the
  question a person arrives with. Prices are best first: lowest when buying,
  highest when selling, which is the server's order.

  Every ad is one element, a row of the table on a desk and a card on a
  phone, so there is exactly one way to each offer on the page.
*/

/*
  Binance's filter puts a row of amounts under the field - $20, $100, $500,
  $1K on theirs - for the person who knows roughly what they want and would
  rather tap than type. The same five-fold steps, in birr, at the sizes
  trades here actually come in. Typing still works; a tapped amount can be
  edited or tapped again to clear.
*/
const QUICK_AMOUNTS = [1_000, 5_000, 10_000, 50_000] as const;
const grouped = new Intl.NumberFormat("en-GB");

type Filters = { window: number | null; takeable: boolean };
const NO_FILTERS: Filters = { window: null, takeable: false };

/*
  Time to pay is a floor. No ad gives less than the shortest window, so at
  least that is every ad - All - and the choices start above it.
*/
const SHORTEST = Math.min(...PAYMENT_WINDOWS);
const LONGEST = Math.max(...PAYMENT_WINDOWS);
const FLOORS = PAYMENT_WINDOWS.filter((minutes) => minutes > SHORTEST);

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
    marketplace.

    The side is always written out, including the default one: leaving ?want=BUY
    off the way a first page leaves off ?page=1 would give one view two
    addresses, and you would watch the link you arrived on rewrite itself the
    moment you touched the toggle. This is the axis of the whole screen rather
    than an incidental filter, so it says which side it is, always.

    Read loosely on the way in - a bare /trade and a typed ?want=sell are both
    understood - because an address a person types by hand should not have to
    guess at capitals.
  */
  const router = useRouter();
  const params = useSearchParams();
  const want: OfferSide = params.get("want")?.toUpperCase() === "SELL" ? "SELL" : "BUY";
  const setWant = (side: OfferSide) => {
    router.replace(`/trade?want=${side}`, { scroll: false });
  };
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<PaymentMethodKind | "">("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
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
        minPaymentWindowMinutes: filters.window ?? undefined,
        takeable: filters.takeable,
        cursor,
      });
      return result;
    },
    [want, amountSantim, kind, filters],
  );

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    // The filters changed, or the person asked again: start from the first page.
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
  }, [load, attempt]);

  const loadMore = async () => {
    if (state.status !== "ready" || !state.nextCursor) return;
    setMore(true);
    const result = await load(state.nextCursor);
    setMore(false);
    if (!result.ok) {
      // The offers already shown stay; the button is still there to press again.
      toastFailure(result);
      return;
    }
    setState({
      status: "ready",
      offers: [...state.offers, ...result.offers],
      nextCursor: result.nextCursor,
    });
  };

  const narrowed = amount !== "" || kind !== "" || filters.window !== null || filters.takeable;

  return (
    <>
      <PageHeader
        title="P2P market"
        description="Buy and sell USDT for birr with other people. Every trade is held in escrow until the seller confirms the birr arrived."
      >
        <ButtonLink
          href={withNext("/trade/payment-methods", `/trade?want=${want}`)}
          variant="secondary"
          size="sm"
          arrow={false}
        >
          Payment methods
        </ButtonLink>
        <ButtonLink href="/trade/ads" variant="secondary" size="sm" arrow={false}>
          My ads
        </ButtonLink>
        <ButtonLink href="/trade/ads/new" size="sm" arrow={false}>
          <Plus size={15} weight="bold" aria-hidden="true" />
          Post an ad
        </ButtonLink>
      </PageHeader>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="flex items-center gap-3">
          <SideToggle value={want} onChange={setWant} />
          <StatusPill status="neutral" className="hidden sm:inline-flex">
            {ASSET}
          </StatusPill>
        </div>
        <div className="hidden flex-1 lg:block" />
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
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
            <div className="order-last min-w-0 basis-full sm:order-none sm:w-56 sm:basis-auto">
              <Select
                aria-label="Payment method"
                value={kind}
                onChange={(value) => setKind(value as PaymentMethodKind | "")}
                options={[
                  { value: "", label: "All payment methods" },
                  ...PAYMENT_KIND_LIST.map((value) => ({
                    value,
                    label: PAYMENT_KINDS[value].label,
                    bar: PAYMENT_KINDS[value].bar,
                  })),
                ]}
              />
            </div>
            <FiltersControl want={want} value={filters} onChange={setFilters} />
            <button
              type="button"
              aria-label="Refresh the list"
              onClick={() => {
                setState({ status: "loading" });
                setAttempt((value) => value + 1);
              }}
              className="rounded-control border-border bg-surface text-foreground hover:text-primary flex size-10 shrink-0 items-center justify-center border transition-colors duration-150"
            >
              <ArrowsClockwise size={17} aria-hidden="true" />
            </button>
          </div>
          <div role="group" aria-label="Quick amounts" className="flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map((value) => {
              const pressed = amount.trim() === String(value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setAmount(pressed ? "" : String(value))}
                  className={cn(
                    "rounded-control h-8 border px-3.5 text-[13px] font-medium tabular-nums transition-colors duration-150",
                    pressed
                      ? "border-primary bg-primary-soft text-primary-soft-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {grouped.format(value)}
                </button>
              );
            })}
          </div>
          {amountProblem ? (
            <p role="alert" className="text-destructive text-[13px]">
              {amountProblem}
            </p>
          ) : null}
        </div>
      </div>

      <section
        aria-label="Ads"
        className="rounded-surface border-border bg-surface shadow-panel mt-5 min-w-0 border"
      >
        {state.status === "loading" ? (
          <ListNotice>Finding offers…</ListNotice>
        ) : state.status === "error" ? (
          <div className="p-5">
            <LoadFailed
              message={state.message}
              onRetry={() => {
                setState({ status: "loading" });
                setAttempt((value) => value + 1);
              }}
            />
          </div>
        ) : state.offers.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Storefront}
              title={want === "BUY" ? "Nobody is selling right now" : "Nobody is buying right now"}
              description={
                narrowed
                  ? "Try a different amount, payment method or filter, or post an ad of your own."
                  : "Post an ad and be the first offer on this side of the market."
              }
              action={
                <ButtonLink href="/trade/ads/new" size="sm" variant="secondary" arrow={false}>
                  Post an ad
                </ButtonLink>
              }
            />
          </div>
        ) : (
          <>
            <div
              aria-hidden="true"
              className="text-muted-foreground border-border hidden grid-cols-[minmax(0,2.3fr)_minmax(0,1.2fr)_minmax(0,1.7fr)_minmax(0,1.3fr)_9.5rem] gap-4 border-b px-6 py-3 text-[12px] font-medium lg:grid"
            >
              <span>Advertiser</span>
              <span>Price</span>
              <span>Available / order limit</span>
              <span>Payment</span>
              <span className="text-right">Trade</span>
            </div>
            <ul className="divide-border divide-y">
              {state.offers.map((offer) => (
                <OfferRow key={offer.id} offer={offer} want={want} />
              ))}
            </ul>
            {state.nextCursor ? (
              <div className="flex justify-center px-4 pt-2 pb-5">
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
      </section>
      <p className="text-muted-foreground mt-3 text-[12px] leading-relaxed">
        Prices are {FIAT} for 1 {ASSET}, best first. An ad shows only while its seller&apos;s
        balance covers its smallest order.
      </p>
    </>
  );
}

/* ---------------------------------------------------------------- pieces */

/** Buy or Sell, in the market's colours: green to buy, red to sell. */
function SideToggle({
  value,
  onChange,
}: {
  value: OfferSide;
  onChange: (side: OfferSide) => void;
}) {
  return (
    <div role="group" aria-label="Buy or sell" className="bg-muted rounded-control inline-flex p-1">
      {(["BUY", "SELL"] as const).map((side) => {
        const selected = side === value;
        return (
          <button
            key={side}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(side)}
            className={cn(
              "rounded-control h-9 min-w-20 px-4 text-sm font-semibold transition-[background-color,color,box-shadow] duration-150",
              selected
                ? side === "BUY"
                  ? "bg-primary text-primary-foreground shadow-raised-soft"
                  : "bg-destructive text-destructive-foreground shadow-raised-soft"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {side === "BUY" ? "Buy" : "Sell"}
          </button>
        );
      })}
    </div>
  );
}

/*
  Binance's filter popover, with the two that mean something here: the least
  time the buyer has to pay, and "only ads I can take" - which leaves out the
  viewer's own ads and those for verified or more experienced traders than
  they are yet. Chosen in a draft and applied at once, so the list does not
  refetch on every tap. A popover on a desk, a sheet on a phone.
*/
function FiltersControl({
  want,
  value,
  onChange,
}: {
  want: OfferSide;
  value: Filters;
  onChange: (next: Filters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(value);
  const container = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const takeableId = useId();
  const active = (value.window !== null ? 1 : 0) + (value.takeable ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setDraft(value);
          setOpen((current) => !current);
        }}
        className={cn(
          "rounded-control bg-surface flex h-10 items-center gap-2 border px-3.5 text-sm font-medium transition-colors duration-150",
          active > 0
            ? "border-primary text-primary"
            : "border-border text-foreground hover:text-primary",
        )}
      >
        <Funnel size={16} aria-hidden="true" />
        {active > 0 ? `Filters · ${active}` : "Filters"}
      </button>

      <div
        id={panelId}
        role="dialog"
        aria-label="Filters"
        hidden={!open}
        className="border-border bg-surface shadow-panel rounded-surface fixed inset-x-4 bottom-[5.5rem] z-50 border p-4 sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:bottom-auto sm:mt-2 sm:w-80"
      >
        <div className="flex items-center justify-between sm:hidden">
          <p className="text-foreground text-sm font-semibold">Filters</p>
          <button
            type="button"
            aria-label="Close the filters"
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground flex size-9 items-center justify-center"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <fieldset>
          <legend className="text-muted-foreground mb-2 text-[12px] font-medium">
            Time to pay
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {[null, ...FLOORS].map((minutes) => {
              const pressed = draft.window === minutes;
              return (
                <button
                  key={minutes ?? "all"}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setDraft({ ...draft, window: minutes })}
                  className={cn(
                    "rounded-control flex h-8 items-center gap-1 border px-3 text-[13px] font-medium tabular-nums transition-colors duration-150",
                    pressed
                      ? "border-primary bg-primary-soft text-primary-soft-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {minutes === null
                    ? "All"
                    : minutes === LONGEST
                      ? `${minutes} min`
                      : `${minutes}+ min`}
                </button>
              );
            })}
          </div>
          <p className="text-muted-foreground mt-2 text-[12px]">
            {want === "BUY"
              ? "Ads that give you at least this long to pay."
              : "Ads whose buyer has at least this long to pay you."}
          </p>
        </fieldset>
        <div className="bg-border my-4 h-px" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p id={takeableId} className="text-foreground text-sm font-medium">
              Only ads I can take
            </p>
            <p className="text-muted-foreground text-[12px] leading-relaxed">
              Leaves out your own ads, and ads for verified or more experienced traders when you are
              not one yet.
            </p>
          </div>
          <Switch
            checked={draft.takeable}
            onCheckedChange={(takeable) => setDraft({ ...draft, takeable })}
            aria-labelledby={takeableId}
          />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setDraft(NO_FILTERS);
              onChange(NO_FILTERS);
              setOpen(false);
            }}
          >
            Reset
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onChange(draft);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Why the viewer cannot take an ad, in the words its Limited button carries. */
function limitedReason(offer: MarketOffer): string | null {
  if (offer.blockedBecause === "VERIFICATION") return "Verified accounts only";
  if (offer.blockedBecause === "COMPLETED_TRADES")
    return `For traders with ${offer.minCompletedTrades}+ completed orders`;
  return null;
}

/*
  One ad: a row of the table from lg up, a card below it. The card is
  Binance's phone card - who, the price and limits on the left, the rails,
  the time to pay and the button on the right.
*/
function OfferRow({ offer, want }: { offer: MarketOffer; want: OfferSide }) {
  const reason = limitedReason(offer);
  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 px-4 py-4 sm:px-6",
        "lg:grid-cols-[minmax(0,2.3fr)_minmax(0,1.2fr)_minmax(0,1.7fr)_minmax(0,1.3fr)_9.5rem] lg:items-center",
        offer.isMine && "bg-muted/60",
      )}
    >
      <div className="col-span-2 lg:col-span-1">
        <AdvertiserLine advertiser={offer.advertiser} />
      </div>

      <div className="flex flex-col gap-1 lg:contents">
        <div>
          <span className="text-foreground font-mono text-xl font-medium tabular-nums">
            {formatSantim(offer.priceSantim)}
          </span>
          <span className="text-muted-foreground ml-1 text-[12px]">{FIAT}</span>
        </div>
        <dl className="flex flex-col gap-0.5 text-[13px] tabular-nums">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground lg:sr-only">
              {want === "BUY" ? "Available" : "Buying"}
            </dt>
            <dd className="text-foreground">{usdt(offer.available)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground lg:sr-only">Limit</dt>
            <dd className="text-muted-foreground">
              {formatSantim(offer.minSantim)} – {birr(offer.maxSantim)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-col items-end gap-1.5 lg:contents">
        <PaymentKindChips
          kinds={offer.paymentKinds}
          stacked
          className="items-end text-[12px] lg:items-start lg:text-[13px]"
        />
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-muted-foreground flex items-center gap-1 text-[12px] lg:hidden">
            <Clock size={13} aria-hidden="true" />
            {offer.paymentWindowMinutes} min
          </span>
          {offer.isMine ? (
            <ButtonLink
              href={`/trade/ads/${offer.id}/edit`}
              variant="ghost"
              size="sm"
              arrow={false}
              className="text-[13px]"
            >
              Your ad · Edit
            </ButtonLink>
          ) : reason ? (
            <>
              <Button type="button" variant="secondary" size="sm" disabled className="w-28">
                Limited
              </Button>
              <span className="bg-status-pending text-status-pending-fg rounded-control max-w-[9.5rem] px-2 py-0.5 text-right text-[11px] leading-snug font-medium">
                {reason}
              </span>
            </>
          ) : (
            <ButtonLink
              href={`/trade/offers/${offer.id}`}
              size="sm"
              variant={want === "BUY" ? "primary" : "sell"}
              arrow={false}
              className="w-28"
            >
              {want === "BUY" ? `Buy ${ASSET}` : `Sell ${ASSET}`}
            </ButtonLink>
          )}
        </div>
      </div>
    </li>
  );
}
