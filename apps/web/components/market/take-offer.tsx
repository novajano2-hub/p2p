"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { PageHeader, Panel } from "@/components/app/panel";
import { FormError } from "@/components/auth/notices";
import {
  AdvertiserLine,
  BackTo,
  ListNotice,
  PaymentKindChips,
  Segmented,
  birr,
  usdt,
} from "@/components/market/bits";
import { AppLink } from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Note, SummaryRow } from "@/components/wallet/shared";
import {
  marketClient,
  newClientId,
  type MarketOffer,
  type PaymentMethod,
  type PaymentMethodKind,
} from "@/lib/market/client";
import { ASSET, FIAT, PAYMENT_KINDS } from "@/lib/market/labels";
import {
  amountForFiat,
  compareSantim,
  fiatForAmount,
  formatSantim,
  plainSantim,
  toSantim,
} from "@/lib/market/money";
import { compareMicro, plainMicro, toMicro } from "@/lib/money";
import { withNext } from "@/lib/next-path";

/*
  Taking an offer: the Binance "I will pay / I will receive" screen. The
  person types either side of the pair and sees the other, at the offer's
  price, using the same arithmetic the server will use - so the trade that
  opens is the trade that was previewed, to the santim.

  What the rail question is depends on which way the trade goes. Buying
  from a SELL offer, the buyer picks which of the seller's rails they will
  pay through. Selling to a BUY offer, the taker is the seller and names
  one of their own payment methods, which must be of a kind the buyer said
  they can pay through. The escrow comes from whoever gives up USDT.

  The ad can change under the person's feet: its owner may pause or close
  it, change the price, or have most of it taken by somebody else while they
  are still typing. So the screen looks at the offer again every ten seconds
  while it is open, and whenever the tab comes back into view, and says what
  changed at once - rather than leaving the order button to find out, and
  then saying so at the top of a form the button is the bottom of.
*/

const MODES = [
  { value: "fiat", label: `By ${FIAT}` },
  { value: "usdt", label: `By ${ASSET}` },
] as const;
type Mode = (typeof MODES)[number]["value"];

const RECHECK_MS = 10_000;
const GONE = "This ad is no longer available - its owner paused or closed it.";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; offer: MarketOffer; methods: PaymentMethod[] };

export function TakeOffer({ offerId }: { offerId: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [mode, setMode] = useState<Mode>("fiat");
  const [typed, setTyped] = useState("");
  const [rail, setRail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One key per intent (ADR-0007): kept across a retry the network failed,
  // replaced once the server has answered either way.
  const [intentKey, setIntentKey] = useState<string | null>(null);
  // Found gone, by a look or by a refused order. There is no way back from it.
  const [gone, setGone] = useState(false);
  // Something about the ad changed since it was loaded; cleared by typing.
  const [notice, setNotice] = useState<string | null>(null);
  // The offer as last shown, for a look to compare against.
  const shown = useRef<MarketOffer | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const found = await marketClient.offer(offerId);
      if (!live) return;
      if (!found.ok) {
        setState({ status: "error", message: found.message });
        return;
      }
      // Selling to a BUY offer needs the taker's own methods to choose from.
      let methods: PaymentMethod[] = [];
      if (found.offer.side === "BUY") {
        const mine = await marketClient.paymentMethods();
        if (!live) return;
        if (mine.ok) methods = mine.paymentMethods.filter((method) => method.status === "ACTIVE");
      }
      setState({ status: "ready", offer: found.offer, methods });
    })();
    return () => {
      live = false;
    };
  }, [offerId]);

  useEffect(() => {
    shown.current = state.status === "ready" ? state.offer : null;
  }, [state]);

  /** Another look at the offer, and a word about anything that changed. */
  const recheck = useCallback(async () => {
    const before = shown.current;
    if (!before) return;
    const found = await marketClient.offer(before.id);
    if (!found.ok) {
      // Only a definite answer counts: a network blip is not a paused ad.
      if (found.code === "NOT_FOUND") setGone(true);
      return;
    }
    if (found.offer.priceSantim !== before.priceSantim) {
      setNotice(
        `The price changed to ${formatSantim(found.offer.priceSantim)} ${FIAT} per ${ASSET} while you were here. Check the amounts before you continue.`,
      );
    } else if (compareMicro(found.offer.available, before.available) < 0) {
      setNotice(`Only ${usdt(found.offer.available)} is left on this ad now.`);
    }
    setState((current) =>
      current.status === "ready" ? { ...current, offer: found.offer } : current,
    );
  }, []);

  const ready = state.status === "ready";
  useEffect(() => {
    if (!ready || gone) return;
    const timer = window.setInterval(() => void recheck(), RECHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void recheck();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, gone, recheck]);

  if (state.status === "loading") {
    return (
      <>
        <BackTo href="/trade">Marketplace</BackTo>
        <Panel>
          <ListNotice>Loading the offer…</ListNotice>
        </Panel>
      </>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <BackTo href="/trade">Marketplace</BackTo>
        <Panel>
          <ListNotice>{state.message}</ListNotice>
        </Panel>
      </>
    );
  }

  const { offer, methods } = state;
  // The viewer buys from a SELL offer and sells to a BUY offer.
  const buying = offer.side === "SELL";
  const price = offer.priceSantim;
  // The side of the market this offer was found on, which is where Back goes.
  const market = `/trade?want=${buying ? "BUY" : "SELL"}`;

  // Both sides of the pair, from whichever the person typed.
  const typedSantim = mode === "fiat" ? toSantim(typed) : null;
  const typedMicro = mode === "usdt" ? toMicro(typed) : null;
  const micro =
    mode === "fiat" ? (typedSantim ? amountForFiat(typedSantim, price) : null) : typedMicro;
  const santim = mode === "fiat" ? typedSantim : micro ? fiatForAmount(micro, price) : null;
  const empty = typed.trim() === "";

  const problem = empty
    ? null
    : !micro || !santim
      ? "Enter an amount."
      : compareSantim(santim, offer.minSantim) < 0
        ? `The smallest trade on this offer is ${birr(offer.minSantim)}.`
        : compareSantim(santim, offer.maxSantim) > 0
          ? `The largest trade on this offer is ${birr(offer.maxSantim)}.`
          : compareMicro(micro, offer.available) > 0
            ? `Only ${usdt(offer.available)} is available right now.`
            : null;

  // The rails on offer, and whether the person has chosen one.
  const usableMethods = methods.filter((method) => offer.paymentKinds.includes(method.kind));
  const railChosen = buying ? rail !== "" || offer.paymentKinds.length === 1 : rail !== "";
  const railValue = buying ? rail || offer.paymentKinds[0] || "" : rail;

  const place = async () => {
    if (!micro || !santim || problem || !railChosen) {
      setError(
        problem ?? (railChosen ? "Enter an amount." : "Choose how the payment will be made."),
      );
      return;
    }
    setError(null);
    setSubmitting(true);
    const key = intentKey ?? newClientId();
    setIntentKey(key);
    const result = await marketClient.createTrade(
      {
        offerId: offer.id,
        ...(mode === "fiat" ? { fiatSantim: santim } : { amount: micro }),
        ...(buying
          ? { paymentKind: railValue as PaymentMethodKind }
          : { paymentMethodId: railValue }),
      },
      key,
    );
    setSubmitting(false);
    if (result.ok) {
      router.push(`/orders/${result.trade.id}`);
      return;
    }
    if (result.code !== "NETWORK") setIntentKey(null);
    if (result.code === "NOT_FOUND") {
      // Paused, closed, or its owner's account is no longer active: the same
      // answer a look gets, shown the same way.
      setGone(true);
      return;
    }
    setError(result.message);
    // "No longer has enough", "the seller cannot fund this": the numbers on
    // screen are stale, so look again now rather than in ten seconds.
    if (result.code === "CONFLICT" || result.code === "INSUFFICIENT_FUNDS") void recheck();
  };

  const title = buying
    ? `Buy ${ASSET} from ${offer.advertiser.username}`
    : `Sell ${ASSET} to ${offer.advertiser.username}`;

  return (
    <>
      <BackTo href={market}>Marketplace</BackTo>
      <PageHeader title={title} />

      <div className="grid gap-4 lg:grid-cols-5 lg:gap-6">
        <Panel className="lg:col-span-3">
          {gone ? (
            <FormError>
              {GONE}{" "}
              <AppLink href={market} className="font-medium underline underline-offset-4">
                Back to the market
              </AppLink>
            </FormError>
          ) : notice ? (
            <p
              role="status"
              className="rounded-control bg-status-pending text-status-pending-fg mb-5 px-3.5 py-3 text-[13px] leading-relaxed"
            >
              {notice}
            </p>
          ) : null}

          <div className="mb-5 flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground text-[13px]">Price</span>
            <span className="text-foreground font-mono text-lg font-medium tabular-nums">
              {formatSantim(price)}{" "}
              <span className="text-muted-foreground text-[12px]">
                {FIAT} per {ASSET}
              </span>
            </span>
          </div>

          <Segmented value={mode} onChange={setMode} options={MODES} label="Enter the amount in" />

          <Field
            label={
              mode === "fiat"
                ? buying
                  ? "I will pay"
                  : "I will receive"
                : buying
                  ? "I want to buy"
                  : "I want to sell"
            }
            hint={`Between ${formatSantim(offer.minSantim)} and ${birr(offer.maxSantim)} a trade.`}
            error={problem ?? undefined}
            className="mt-4"
          >
            {(control) => (
              <div className="relative">
                <Input
                  {...control}
                  value={typed}
                  onChange={(event) => {
                    setTyped(event.target.value);
                    setNotice(null);
                  }}
                  inputMode="decimal"
                  placeholder="0.00"
                  autoComplete="off"
                  className="pr-24 font-medium tabular-nums"
                />
                <div className="absolute inset-y-0 right-3.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      // The most this offer allows: its own maximum, or what is left, whichever is less.
                      const maxByAvailable = fiatForAmount(offer.available, price);
                      const max =
                        compareSantim(maxByAvailable, offer.maxSantim) < 0
                          ? maxByAvailable
                          : offer.maxSantim;
                      setTyped(
                        mode === "fiat" ? plainSantim(max) : plainMicro(amountForFiat(max, price)),
                      );
                      setNotice(null);
                    }}
                    className="text-primary hover:text-primary-hover text-[13px] font-semibold"
                  >
                    Max
                  </button>
                  <span aria-hidden="true" className="bg-border h-4 w-px" />
                  <span className="text-muted-foreground text-[13px] font-medium">
                    {mode === "fiat" ? FIAT : ASSET}
                  </span>
                </div>
              </div>
            )}
          </Field>

          <dl className="divide-border mt-4 divide-y">
            <SummaryRow label={buying ? "You receive" : "You give"} strong>
              {micro ? usdt(micro) : `— ${ASSET}`}
            </SummaryRow>
            <SummaryRow label={buying ? "You pay" : "You receive"} strong>
              {santim ? birr(santim) : `— ${FIAT}`}
            </SummaryRow>
            <SummaryRow label="Time to pay">{offer.paymentWindowMinutes} minutes</SummaryRow>
          </dl>

          <div className="mt-5">
            {buying ? (
              <Field label="Pay with" hint="One of the ways this seller accepts payment.">
                {(control) =>
                  offer.paymentKinds.length === 1 ? (
                    <PaymentKindChips kinds={offer.paymentKinds} className="py-2" />
                  ) : (
                    <Select
                      {...control}
                      value={rail}
                      onChange={(event) => setRail(event.target.value)}
                    >
                      <option value="">Choose a payment method</option>
                      {offer.paymentKinds.map((kind) => (
                        <option key={kind} value={kind}>
                          {PAYMENT_KINDS[kind].label}
                        </option>
                      ))}
                    </Select>
                  )
                }
              </Field>
            ) : (
              <Field
                label="Receive the payment to"
                hint={
                  usableMethods.length === 0
                    ? "You have no payment method of a kind this buyer pays through."
                    : "The buyer is shown these details once the trade opens."
                }
              >
                {(control) =>
                  usableMethods.length === 0 ? (
                    <AppLink
                      href={withNext("/trade/payment-methods", `/trade/offers/${offer.id}`)}
                      className="text-primary hover:text-primary-hover text-sm font-medium underline-offset-4 hover:underline"
                    >
                      Add a payment method
                    </AppLink>
                  ) : (
                    <Select
                      {...control}
                      value={rail}
                      onChange={(event) => setRail(event.target.value)}
                    >
                      <option value="">Choose a payment method</option>
                      {usableMethods.map((method) => (
                        <option key={method.id} value={method.id}>
                          {method.label}
                        </option>
                      ))}
                    </Select>
                  )
                }
              </Field>
            )}
          </div>

          <div className="mt-6">
            <Note>
              {buying
                ? `The seller's ${usdt(micro ?? "0")} is locked in escrow the moment you place the order. Pay the exact amount from an account in your own name, then mark the trade as paid.`
                : `Your ${ASSET} is locked in escrow the moment you place the order and released to the buyer only when you confirm the ${FIAT} arrived. Never release before it has.`}
            </Note>
          </div>

          {/* A refusal is answered where the button is, which is where the person is looking. */}
          <div className="mt-6">
            <FormError message={error} />
            <Button
              type="button"
              size="lg"
              className="w-full"
              loading={submitting}
              onClick={place}
              disabled={offer.isMine || gone}
            >
              {gone
                ? "No longer available"
                : offer.isMine
                  ? "This is your own ad"
                  : buying
                    ? `Buy ${ASSET}`
                    : `Sell ${ASSET}`}
            </Button>
          </div>
        </Panel>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel title="Advertiser">
            <AdvertiserLine advertiser={offer.advertiser} />
            <dl className="divide-border mt-3 divide-y">
              <SummaryRow label="Completed trades">{offer.advertiser.tradesCompleted}</SummaryRow>
              <SummaryRow label="Completion rate">
                {offer.advertiser.completionRate === null
                  ? "—"
                  : `${offer.advertiser.completionRate}%`}
              </SummaryRow>
              <SummaryRow label="Available">{usdt(offer.available)}</SummaryRow>
              <SummaryRow label="Pays through">
                <PaymentKindChips kinds={offer.paymentKinds} className="justify-end" />
              </SummaryRow>
            </dl>
          </Panel>
          {offer.terms ? (
            <Panel title="Advertiser's terms">
              <p className="text-foreground text-sm leading-relaxed whitespace-pre-line">
                {offer.terms}
              </p>
            </Panel>
          ) : null}
          {offer.requireVerified || offer.minCompletedTrades > 0 ? (
            <Panel title="Who may take this offer">
              <ul className="text-muted-foreground list-disc pl-5 text-[13px] leading-relaxed">
                {offer.requireVerified ? <li>Verified accounts only.</li> : null}
                {offer.minCompletedTrades > 0 ? (
                  <li>Accounts with at least {offer.minCompletedTrades} completed trades.</li>
                ) : null}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
