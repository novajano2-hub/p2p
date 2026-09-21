"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowsClockwise, CheckCircle, XCircle } from "@phosphor-icons/react";
import { notFound, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { LoadFailed } from "@/components/app/load-failed";
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
import { useSession } from "@/components/app/session-provider";
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
import {
  orderForm,
  orderPair,
  type AmountMode,
  type OrderBounds,
  type OrderForm,
} from "@/lib/market/forms";
import { ASSET, FIAT, PAYMENT_KINDS, averageMinutes } from "@/lib/market/labels";
import {
  amountForFiat,
  compareSantim,
  fiatForAmount,
  formatSantim,
  plainSantim,
} from "@/lib/market/money";
import { compareMicro, plainMicro } from "@/lib/money";
import { withNext } from "@/lib/next-path";
import { revealProblems } from "@/lib/reveal-problems";
import { toast, toastFailure } from "@/lib/toast";

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

  The ad can change under the person's feet, and two different things can
  happen to it. It can go away - taken offline, closed, its owner suspended -
  and then there is nothing to do but say so. Or its terms can move: a new
  price, new limits, new rails, a shorter window, different terms. The order
  carries the version of the ad it was placed against, so a moved ad is
  refused by the server rather than opened on terms nobody read. This screen
  looks again every ten seconds and whenever the tab comes back, lists what
  changed, and asks for one deliberate click before ordering at the new terms.

  The amount is checked as it is typed, against the ad as it is on screen
  (lib/market/forms.ts), and again when the ad moves under it.
*/

const MODES = [
  { value: "fiat", label: `By ${FIAT}` },
  { value: "usdt", label: `By ${ASSET}` },
] as const;

const RECHECK_MS = 10_000;
const GONE = "This ad is no longer available - its owner took it offline or closed it.";
const NO_METHODS: PaymentMethod[] = [];

/** What moved between the ad as accepted and the ad as it is now. */
function changesBetween(before: MarketOffer, after: MarketOffer): string[] {
  const lines: string[] = [];
  if (before.priceSantim !== after.priceSantim) {
    lines.push(
      `Price: ${formatSantim(before.priceSantim)} → ${formatSantim(after.priceSantim)} ${FIAT} per ${ASSET}`,
    );
  }
  if (before.minSantim !== after.minSantim || before.maxSantim !== after.maxSantim) {
    lines.push(
      `Limits: ${formatSantim(before.minSantim)} – ${formatSantim(before.maxSantim)} → ${formatSantim(after.minSantim)} – ${formatSantim(after.maxSantim)} ${FIAT}`,
    );
  }
  if (before.paymentWindowMinutes !== after.paymentWindowMinutes) {
    lines.push(
      `Time to pay: ${before.paymentWindowMinutes} → ${after.paymentWindowMinutes} minutes`,
    );
  }
  const railsOf = (offer: MarketOffer) =>
    offer.paymentKinds.map((kind) => PAYMENT_KINDS[kind].label).join(", ");
  if (railsOf(before) !== railsOf(after)) {
    lines.push(`Payment methods: now ${railsOf(after)}`);
  }
  if (before.terms !== after.terms) {
    lines.push("The advertiser's terms changed - read them again.");
  }
  if (
    before.requireVerified !== after.requireVerified ||
    before.minCompletedTrades !== after.minCompletedTrades
  ) {
    lines.push("Who may take this ad changed.");
  }
  // The version moved on something this screen does not draw: say so plainly
  // rather than show an empty list.
  return lines.length > 0 ? lines : ["The advertiser updated this ad."];
}

/** Said when the ad moves while the form is open, and when an order is refused because it did. */
function sayChanged(): void {
  toast.warning("The advertiser changed this ad", {
    id: "offer-changed",
    description: "Read what changed, beside the button, before you order.",
  });
}

type State =
  | { status: "loading" }
  /** Gone before the page could show it: the not-found page, not a sentence in a panel. */
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; offer: MarketOffer; methods: PaymentMethod[] };

export function TakeOffer({ offerId }: { offerId: string }) {
  const router = useRouter();
  const verified = useSession().user.kycStatus === "APPROVED";
  const [state, setState] = useState<State>({ status: "loading" });
  const [mode, setMode] = useState<AmountMode>("fiat");
  const [error, setError] = useState<string | null>(null);
  // One key per intent (ADR-0007): kept across a retry the network failed,
  // replaced once the server has answered either way.
  const [intentKey, setIntentKey] = useState<string | null>(null);
  // Found gone, by a look or by a refused order. There is no way back from it.
  const [gone, setGone] = useState(false);
  // What is left of the ad, when somebody else has taken some of it.
  const [notice, setNotice] = useState<string | null>(null);
  /*
    The ad as this person accepted it. An order is placed against its version,
    so while it trails the ad on screen there are changes to read first.
  */
  const [accepted, setAccepted] = useState<MarketOffer | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Pressed "check again", and not answered yet.
  const [checking, setChecking] = useState(false);
  // What a look is comparing against, without making every look a new effect.
  const view = useRef<{ offer: MarketOffer; methods: PaymentMethod[] } | null>(null);
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);

  const offer = state.status === "ready" ? state.offer : null;
  const methods = state.status === "ready" ? state.methods : NO_METHODS;
  // The viewer buys from a SELL offer and sells to a BUY offer.
  const buying = offer?.side === "SELL";
  // The rails on offer, and whether the person has a choice to make. A single
  // choice is chosen already, as Binance has it: a question with one answer
  // is not a question.
  const usableMethods = offer
    ? methods.filter((method) => offer.paymentKinds.includes(method.kind))
    : NO_METHODS;
  const soleMethod = usableMethods.length === 1 ? (usableMethods[0] ?? null) : null;

  const bounds: OrderBounds = {
    mode,
    priceSantim: offer?.priceSantim ?? "0",
    minSantim: offer?.minSantim ?? "0",
    maxSantim: offer?.maxSantim ?? "0",
    available: offer?.available ?? "0",
    railMissing: !offer
      ? null
      : buying
        ? offer.paymentKinds.length > 1
          ? "Choose how you will pay."
          : null
        : usableMethods.length === 0
          ? "Add a payment method of a kind this buyer pays through."
          : usableMethods.length > 1
            ? "Choose where you will be paid."
            : null,
  };

  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<OrderForm>({
    resolver: zodResolver(orderForm(bounds)),
    // Checked as it is typed: a limit is worth knowing before the button.
    mode: "onChange",
    // revealProblems() does it, in the page's order rather than the fields'.
    shouldFocusError: false,
    defaultValues: { amount: "", rail: "" },
  });
  // useWatch rather than watch(): the function watch() returns cannot be
  // memoized, so the React Compiler gives up on the whole component.
  const typed = useWatch({ control, name: "amount" }) ?? "";

  useEffect(() => {
    let live = true;
    void (async () => {
      const found = await marketClient.offer(offerId);
      if (!live) return;
      if (!found.ok) {
        setState(
          found.code === "NOT_FOUND"
            ? { status: "missing" }
            : { status: "error", message: found.message },
        );
        return;
      }
      // Selling to a BUY offer needs the taker's own methods to choose from.
      let mine: PaymentMethod[] = [];
      if (found.offer.side === "BUY") {
        const listed = await marketClient.paymentMethods();
        if (!live) return;
        if (listed.ok) mine = listed.paymentMethods.filter((method) => method.status === "ACTIVE");
      }
      setState({ status: "ready", offer: found.offer, methods: mine });
      setAccepted(found.offer);
    })();
    return () => {
      live = false;
    };
  }, [offerId, attempt]);

  useEffect(() => {
    view.current = state.status === "ready" ? { offer: state.offer, methods: state.methods } : null;
  }, [state]);

  /** Another look at the ad, and a word about anything that moved. */
  const recheck = useCallback(async () => {
    const before = view.current;
    if (!before) return;
    const found = await marketClient.offer(before.offer.id);
    if (!found.ok) {
      // Only a definite answer counts: a network blip is not an ad taken offline.
      if (found.code === "NOT_FOUND") setGone(true);
      return;
    }
    const next = found.offer;
    if (compareMicro(next.available, before.offer.available) < 0) {
      setNotice(`Only ${usdt(next.available)} is left on this ad now.`);
    }
    setState((current) => (current.status === "ready" ? { ...current, offer: next } : current));
    // A payment choice the ad no longer offers is not a choice.
    const chosen = getValues("rail");
    if (chosen !== "") {
      const offered =
        next.side === "SELL"
          ? next.paymentKinds.includes(chosen as PaymentMethodKind)
          : before.methods.some(
              (method) => method.id === chosen && next.paymentKinds.includes(method.kind),
            );
      if (!offered) setValue("rail", "");
    }
  }, [getValues, setValue]);

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

  // The limits an amount is held to moved - the ad changed, or the unit did:
  // what was typed is checked again against the new ones.
  const limits = `${mode} ${bounds.priceSantim} ${bounds.minSantim} ${bounds.maxSantim} ${bounds.available}`;
  useEffect(() => {
    if (getValues("amount") !== "") void trigger("amount");
  }, [limits, getValues, trigger]);

  // Said once when it happens, wherever on the page the person is.
  useEffect(() => {
    if (gone)
      toast.error("This ad is no longer available", { id: "offer-gone", description: GONE });
  }, [gone]);
  const movedTo = accepted && offer && accepted.revision !== offer.revision ? offer.revision : null;
  useEffect(() => {
    if (movedTo !== null) sayChanged();
  }, [movedTo]);

  if (state.status === "loading") {
    return (
      <>
        <BackTo href="/trade">P2P market</BackTo>
        <Panel>
          <ListNotice>Loading the offer…</ListNotice>
        </Panel>
      </>
    );
  }
  if (state.status === "missing") notFound();
  if (state.status === "error" || !offer) {
    return (
      <>
        <BackTo href="/trade">P2P market</BackTo>
        <Panel>
          <LoadFailed
            message={state.status === "error" ? state.message : "The ad did not load."}
            onRetry={() => {
              setState({ status: "loading" });
              setAttempt((value) => value + 1);
            }}
          />
        </Panel>
      </>
    );
  }

  const price = offer.priceSantim;
  // The side of the market this offer was found on, which is where Back goes.
  const market = `/trade?want=${buying ? "BUY" : "SELL"}`;
  const changes =
    accepted && accepted.revision !== offer.revision ? changesBetween(accepted, offer) : [];

  // Both sides of the pair, from whichever the person typed.
  const pair = orderPair(typed, mode, price);
  const micro = pair?.micro ?? null;
  const santim = pair?.santim ?? null;

  /** "I have read what changed": the ad on screen becomes the ad being ordered. */
  const acceptChanges = () => {
    setAccepted(offer);
    setError(null);
    toast.dismiss("offer-changed");
  };

  const place = async (values: OrderForm) => {
    const order = orderPair(values.amount, mode, price);
    if (!accepted || !order) return;
    setError(null);
    const key = intentKey ?? newClientId();
    setIntentKey(key);
    const rail = buying
      ? values.rail || offer.paymentKinds[0] || ""
      : values.rail || soleMethod?.id || "";
    const result = await marketClient.createTrade(
      {
        offerId: offer.id,
        offerRevision: accepted.revision,
        ...(mode === "fiat" ? { fiatSantim: order.santim } : { amount: order.micro }),
        ...(buying ? { paymentKind: rail as PaymentMethodKind } : { paymentMethodId: rail }),
      },
      key,
    );
    if (result.ok) {
      toast.success("Order placed", {
        description: buying
          ? `Pay ${birr(result.trade.fiatSantim)} within ${offer.paymentWindowMinutes} minutes, then mark it paid.`
          : `The buyer has ${offer.paymentWindowMinutes} minutes to pay you ${birr(result.trade.fiatSantim)}.`,
      });
      router.push(`/orders/${result.trade.id}`);
      return;
    }
    if (result.code !== "NETWORK") setIntentKey(null);
    if (result.code === "NOT_FOUND") {
      // Taken offline, closed, or its owner's account is no longer active: the
      // same answer a look gets, shown the same way.
      setGone(true);
      return;
    }
    if (result.code === "OFFER_CHANGED") {
      // The ad moved between the last look and this click. Fetch it again: the
      // list of what changed is the answer, and it needs one more click.
      sayChanged();
      await recheck();
      return;
    }
    setError(result.message);
    toastFailure(result);
    // "No longer has enough", "the seller cannot fund this": the numbers on
    // screen are stale, so look again now rather than in ten seconds.
    if (result.code === "CONFLICT" || result.code === "INSUFFICIENT_FUNDS") void recheck();
  };

  /** Enter in the amount field, while there are changes to read, is not an order. */
  const order = async (values: OrderForm) => {
    if (changes.length > 0) {
      sayChanged();
      return;
    }
    await place(values);
  };

  const title = buying
    ? `Buy ${ASSET} from ${offer.advertiser.username}`
    : `Sell ${ASSET} to ${offer.advertiser.username}`;

  /*
    What the server would refuse, said before the button rather than after it:
    the advertiser trades with verified accounts only, or with traders who
    have completed more orders than this one has.
  */
  const limited =
    offer.blockedBecause === "VERIFICATION"
      ? "This advertiser trades with verified accounts only. Verify your identity to take this ad."
      : offer.blockedBecause === "COMPLETED_TRADES"
        ? `This advertiser trades with accounts that have completed at least ${offer.minCompletedTrades} orders.`
        : null;

  const checkAgain = async () => {
    setChecking(true);
    await recheck();
    setChecking(false);
  };

  return (
    <>
      <BackTo href={market}>P2P market</BackTo>
      <PageHeader title={title}>
        <button
          type="button"
          onClick={() => void checkAgain()}
          disabled={checking || gone}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-[13px] font-medium transition-colors duration-150 disabled:opacity-60"
        >
          <ArrowsClockwise
            size={14}
            aria-hidden="true"
            className={checking ? "animate-spin motion-reduce:animate-none" : undefined}
          />
          {checking ? "Checking the ad…" : "Checked every 10 seconds · check now"}
        </button>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
        <Panel className="lg:col-span-7">
          {gone ? (
            <FormError>
              {GONE}{" "}
              <AppLink href={market} className="font-medium underline underline-offset-4">
                Back to the market
              </AppLink>
            </FormError>
          ) : null}

          <form
            ref={setFormElement}
            noValidate
            // Built in the event, not during render: placing an order looks at the ad again.
            onSubmit={(event) => void handleSubmit(order, () => revealProblems(formElement))(event)}
          >
            <div className="mb-5 flex items-baseline gap-2.5">
              <span className="text-foreground font-mono text-3xl font-medium tabular-nums">
                {formatSantim(price)}
              </span>
              <span className="text-muted-foreground text-sm">
                {FIAT} per {ASSET}
              </span>
            </div>

            <Segmented
              value={mode}
              onChange={setMode}
              options={MODES}
              label="Enter the amount in"
            />

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
              hint={`Between ${formatSantim(offer.minSantim)} and ${birr(offer.maxSantim)} a trade · ${usdt(offer.available)} available.`}
              error={errors.amount?.message}
              className="mt-4"
            >
              {(a11y) => (
                <div className="relative">
                  <Input
                    {...a11y}
                    {...register("amount", { onChange: () => setNotice(null) })}
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
                        setValue(
                          "amount",
                          mode === "fiat"
                            ? plainSantim(max)
                            : plainMicro(amountForFiat(max, price)),
                          { shouldValidate: true, shouldDirty: true },
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
                <Field
                  label="Pay with"
                  hint="One of the ways this seller accepts payment."
                  error={errors.rail?.message}
                >
                  {(a11y) =>
                    offer.paymentKinds.length === 1 ? (
                      <PaymentKindChips kinds={offer.paymentKinds} className="py-2" />
                    ) : (
                      <Controller
                        control={control}
                        name="rail"
                        render={({ field }) => (
                          <Select
                            {...a11y}
                            ref={field.ref}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            placeholder="Choose a payment method"
                            options={offer.paymentKinds.map((kind) => ({
                              value: kind,
                              label: PAYMENT_KINDS[kind].label,
                              bar: PAYMENT_KINDS[kind].bar,
                            }))}
                          />
                        )}
                      />
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
                  error={errors.rail?.message}
                >
                  {(a11y) =>
                    usableMethods.length === 0 ? (
                      <AppLink
                        href={withNext("/trade/payment-methods", `/trade/offers/${offer.id}`)}
                        aria-describedby={a11y["aria-describedby"]}
                        data-invalid={a11y["aria-invalid"]}
                        className="text-primary hover:text-primary-hover text-sm font-medium underline-offset-4 hover:underline"
                      >
                        Add a payment method
                      </AppLink>
                    ) : (
                      <Controller
                        control={control}
                        name="rail"
                        render={({ field }) => (
                          <Select
                            {...a11y}
                            ref={field.ref}
                            value={field.value || soleMethod?.id || ""}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            placeholder="Choose a payment method"
                            options={usableMethods.map((method) => ({
                              value: method.id,
                              label: method.label,
                              bar: PAYMENT_KINDS[method.kind].bar,
                            }))}
                          />
                        )}
                      />
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

            {/*
              What changed, and any refusal, are answered where the button is -
              and on a phone that place stays on screen, above the tab bar, the
              way Binance keeps its order button in reach.
            */}
            <div className="max-lg:border-border max-lg:bg-surface max-lg:above-tab-bar mt-6 max-lg:fixed max-lg:inset-x-0 max-lg:z-30 max-lg:mt-0 max-lg:border-t max-lg:px-4 max-lg:py-3">
              {changes.length > 0 ? (
                <div
                  role="status"
                  className="rounded-control bg-status-pending text-status-pending-fg mb-4 px-3.5 py-3 text-[13px] leading-relaxed"
                >
                  <p className="font-medium">The advertiser changed this ad</p>
                  <ul className="mt-1 list-disc pl-4">
                    {changes.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : notice ? (
                <p
                  role="status"
                  className="rounded-control bg-status-pending text-status-pending-fg mb-4 px-3.5 py-3 text-[13px] leading-relaxed"
                >
                  {notice}
                </p>
              ) : null}
              {limited && !gone ? (
                <p
                  role="status"
                  className="rounded-control bg-status-pending text-status-pending-fg mb-4 px-3.5 py-3 text-[13px] leading-relaxed"
                >
                  {limited}
                  {offer.blockedBecause === "VERIFICATION" ? (
                    <>
                      {" "}
                      <AppLink href="/verify" className="font-medium underline underline-offset-4">
                        Verify now
                      </AppLink>
                    </>
                  ) : null}
                </p>
              ) : null}
              <FormError message={error} />
              {/*
                Two buttons, not one that changes its type: the same element
                turned into a submit button during its own click would submit
                the form, placing the order the person was only accepting.
              */}
              {changes.length > 0 ? (
                <Button
                  key="accept"
                  type="button"
                  size="lg"
                  className="w-full"
                  onClick={acceptChanges}
                  disabled={offer.isMine || gone || limited !== null}
                >
                  Accept the changes
                </Button>
              ) : (
                <Button
                  key="order"
                  type="submit"
                  size="lg"
                  variant={buying ? "primary" : "sell"}
                  className="w-full"
                  loading={isSubmitting}
                  disabled={offer.isMine || gone || limited !== null}
                >
                  {gone
                    ? "No longer available"
                    : offer.isMine
                      ? "This is your own ad"
                      : limited
                        ? "Limited"
                        : buying
                          ? `Buy ${ASSET}`
                          : `Sell ${ASSET}`}
                </Button>
              )}
            </div>
          </form>
        </Panel>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <Panel title="Advertiser">
            <AdvertiserLine advertiser={offer.advertiser} size="lg" />
            <dl className="mt-4 grid grid-cols-2 gap-2.5">
              <Stat label="Orders">{offer.advertiser.tradesTotal}</Stat>
              <Stat label="Completion">
                {offer.advertiser.completionRate === null
                  ? "—"
                  : `${offer.advertiser.completionRate}%`}
              </Stat>
              <Stat label="Average release">
                {averageMinutes(offer.advertiser.avgReleaseSeconds)}
              </Stat>
              <Stat label="Average pay">{averageMinutes(offer.advertiser.avgPaySeconds)}</Stat>
            </dl>
            <dl className="divide-border mt-3 divide-y">
              <SummaryRow label="Pays through">
                <PaymentKindChips kinds={offer.paymentKinds} className="justify-end" />
              </SummaryRow>
            </dl>
          </Panel>
          {offer.terms ? (
            <Panel title="Advertiser's terms">
              <p className="text-foreground text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-line">
                {offer.terms}
              </p>
            </Panel>
          ) : null}
          {offer.requireVerified || offer.minCompletedTrades > 0 ? (
            <Panel title="Who may take this ad">
              <ul className="flex flex-col gap-2 text-sm">
                {offer.requireVerified ? (
                  <Requirement met={offer.blockedBecause !== "VERIFICATION"}>
                    Verified accounts
                    <span className="text-muted-foreground">
                      {offer.blockedBecause === "VERIFICATION"
                        ? " · you are not verified yet"
                        : verified
                          ? " · you are verified"
                          : ""}
                    </span>
                  </Requirement>
                ) : null}
                {offer.minCompletedTrades > 0 ? (
                  <Requirement
                    met={
                      offer.blockedBecause === "COMPLETED_TRADES"
                        ? false
                        : offer.blockedBecause === null
                          ? true
                          : null
                    }
                  >
                    {offer.minCompletedTrades} or more completed orders
                    {offer.blockedBecause === "COMPLETED_TRADES" ? (
                      <span className="text-muted-foreground"> · you have fewer so far</span>
                    ) : null}
                  </Requirement>
                ) : null}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
      {/* Room at the end of the page for the action pinned above the tab bar on a phone. */}
      <div aria-hidden="true" className="h-40 lg:hidden" />
    </>
  );
}

/** One figure from the advertiser's record, in a quiet tile. */
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-muted rounded-control px-3 py-2.5">
      <dt className="text-muted-foreground text-[12px] font-medium">{label}</dt>
      <dd className="text-foreground text-base font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/** A condition the ad sets, with whether this viewer meets it: yes, no, or not known yet. */
function Requirement({ met, children }: { met: boolean | null; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {met === false ? (
        <XCircle
          size={17}
          weight="fill"
          aria-label="Not met"
          className="text-destructive mt-0.5 shrink-0"
        />
      ) : met ? (
        <CheckCircle
          size={17}
          weight="fill"
          aria-label="Met"
          className="text-online mt-0.5 shrink-0"
        />
      ) : (
        <span aria-hidden="true" className="bg-sage mt-2 size-1.5 shrink-0 rounded-full" />
      )}
      <span>{children}</span>
    </li>
  );
}
