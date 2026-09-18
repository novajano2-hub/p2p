"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Minus, Plus, WarningCircle } from "@phosphor-icons/react";
import { notFound, useRouter } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Controller, useForm, useWatch, type FieldErrors } from "react-hook-form";

import { LoadFailed } from "@/components/app/load-failed";
import { PageHeader, Panel } from "@/components/app/panel";
import { useSession } from "@/components/app/session-provider";
import { FormError } from "@/components/auth/notices";
import {
  Avatar,
  BackTo,
  ListNotice,
  PaymentKindChips,
  Segmented,
  birr,
  usdt,
} from "@/components/market/bits";
import { useMayPostAds, VerifyToPost } from "@/components/market/verify-to-post";
import { AppLink } from "@/components/ui/app-link";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { walletRoutes } from "@/lib/app-nav";
import { cn } from "@/lib/cn";
import { keepDraft, takeDraft, withAdded } from "@/lib/market/ad-draft";
import {
  marketClient,
  type MyOffer,
  type PaymentMethod,
  type PaymentMethodKind,
} from "@/lib/market/client";
import {
  adForm,
  AUTO_REPLY_MAX,
  RAILS_MAX,
  TERMS_MAX,
  toOfferDraft,
  type AdForm as AdDraft,
} from "@/lib/market/forms";
import {
  ASSET,
  FIAT,
  PAYMENT_KINDS,
  PAYMENT_KIND_LIST,
  PAYMENT_WINDOWS,
} from "@/lib/market/labels";
import {
  amountForFiat,
  compareSantim,
  formatSantim,
  plainSantim,
  toSantim,
} from "@/lib/market/money";
import { compareMicro, plainMicro, toMicro } from "@/lib/money";
import { withNext } from "@/lib/next-path";
import { revealProblems } from "@/lib/reveal-problems";
import { toast, toastFailure } from "@/lib/toast";
import { walletClient } from "@/lib/wallet/client";

/*
  Posting an ad, or changing one, in Binance's three steps: the type and the
  price; how much, the limits a single trade may fall between, how you will
  be paid (or can pay) and how long the other side has; then the words a
  taker reads, who may take it, and a last look before it goes up.

  Nothing here locks any USDT. A sell ad is listed only while the account can
  fund its smallest order, and the escrow is taken at the moment a trade opens
  - so an ad for more than is in the wallet is allowed, and the second step
  says so plainly, with the balance beside the total.

  Every rule is still the one set in lib/market/forms.ts. A step checks its
  own fields before moving on and goes to the first problem among them; the
  last step checks everything, and a problem left in an earlier step - an ad
  being edited, say - takes the person back to it.
*/

const SIDES = [
  { value: "SELL", label: `I want to sell ${ASSET}` },
  { value: "BUY", label: `I want to buy ${ASSET}` },
] as const;

const STEPS = [
  { title: "Type and price", fields: ["side", "price"] },
  {
    title: "Amount and payment",
    fields: ["total", "min", "max", "methodIds", "kinds", "window"],
  },
  {
    title: "Terms and review",
    fields: ["terms", "autoReply", "requireVerified", "minCompletedTrades"],
  },
] as const satisfies readonly { title: string; fields: readonly (keyof AdDraft)[] }[];
const LAST = STEPS.length - 1;

/** What one press of − or + moves the price by: five santim. */
const PRICE_STEP = 5n;

/** Why a saved ad is on but not on the market, and what brings it there. */
const HIDDEN_BECAUSE = {
  BALANCE: "Your balance cannot cover its smallest order. Deposit USDT and it shows on the market.",
  REMAINDER:
    "What it offers is less than one smallest order. Lower the minimum or raise the total.",
} as const;

const EMPTY: AdDraft = {
  side: "SELL",
  price: "",
  total: "",
  min: "",
  max: "",
  window: 30,
  methodIds: [],
  kinds: [],
  terms: "",
  autoReply: "",
  requireVerified: false,
  minCompletedTrades: "0",
};

type State =
  | { status: "loading" }
  /** An ad to edit that is not there, or not this person's: the not-found page. */
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; methods: PaymentMethod[]; editing: MyOffer | null };

function fromOffer(offer: MyOffer): AdDraft {
  return {
    side: offer.side,
    price: plainSantim(offer.priceSantim),
    total: plainMicro(offer.totalAmount),
    min: plainSantim(offer.minSantim),
    max: plainSantim(offer.maxSantim),
    window: offer.paymentWindowMinutes,
    methodIds: offer.paymentMethods.flatMap((m) => (m.paymentMethodId ? [m.paymentMethodId] : [])),
    kinds: [...new Set(offer.paymentMethods.map((m) => m.kind))],
    terms: offer.terms ?? "",
    autoReply: offer.autoReply ?? "",
    requireVerified: offer.requireVerified,
    minCompletedTrades: String(offer.minCompletedTrades),
  };
}

/** A list with one value in it or out of it. */
function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** Back to the top of the page for a new step, gently unless motion is unwelcome. */
function toTop(): void {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
}

/** "0.38% above it", "0.12% below it", or "the same as it". */
function besideBest(price: string, best: string): string {
  const difference = compareSantim(price, best);
  if (difference === 0) return "the same as it";
  const percent = (Math.abs(Number(BigInt(price) - BigInt(best))) / Number(BigInt(best))) * 100;
  return `${percent.toFixed(2)}% ${difference > 0 ? "above" : "below"} it`;
}

export function AdForm({ offerId }: { offerId?: string | undefined }) {
  const mayPost = useMayPostAds();
  const router = useRouter();
  const { user } = useSession();
  const [state, setState] = useState<State>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState(0);
  // Null until known: a balance that did not load is never shown as zero.
  const [available, setAvailable] = useState<string | null>(null);
  // The best price on the ad's own side of the market right now, to price against.
  const [best, setBest] = useState<string | null>(null);
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);
  const railsErrorId = useId();
  const verifiedLabelId = useId();

  const {
    register,
    control,
    getValues,
    handleSubmit,
    reset,
    setValue,
    trigger,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<AdDraft>({
    resolver: zodResolver(adForm),
    defaultValues: EMPTY,
    // revealProblems() does it, in the page's order rather than the fields'.
    shouldFocusError: false,
  });
  // useWatch rather than watch(): the function watch() returns cannot be
  // memoized, so the React Compiler gives up on the whole component.
  const draft = useWatch({ control }) as AdDraft;
  const side = draft.side;

  useEffect(() => {
    let live = true;
    void (async () => {
      const [methods, editing, balance] = await Promise.all([
        marketClient.paymentMethods(),
        offerId ? marketClient.myOffer(offerId) : Promise.resolve(null),
        walletClient.balance(),
      ]);
      if (!live) return;
      if (!methods.ok) {
        setState({ status: "error", message: methods.message });
        return;
      }
      if (editing && !editing.ok) {
        setState(
          editing.code === "NOT_FOUND"
            ? { status: "missing" }
            : { status: "error", message: editing.message },
        );
        return;
      }
      const offer = editing?.ok ? editing.offer : null;
      const active = methods.paymentMethods.filter((method) => method.status === "ACTIVE");
      setAvailable(balance.ok ? balance.balance.available : null);
      setState({ status: "ready", methods: active, editing: offer });
      if (offer) reset(fromOffer(offer));
      // Back from adding a payment method: the ad as it was left, with the new method in it.
      const kept = takeDraft(offerId ?? "new");
      if (kept) {
        const ids = active.map((method) => method.id);
        reset(
          {
            ...kept.values,
            methodIds:
              kept.values.side === "SELL" ? withAdded(kept, ids, RAILS_MAX) : kept.values.methodIds,
          },
          { keepDefaultValues: true },
        );
        setStep(Math.min(kept.step, LAST));
      }
    })();
    return () => {
      live = false;
    };
  }, [offerId, reset, attempt]);

  // The competition on the ad's own side: the lowest sell price, or the highest buy price.
  useEffect(() => {
    let live = true;
    void marketClient
      .marketplace({ want: side === "SELL" ? "BUY" : "SELL", limit: 1 })
      .then((result) => {
        if (live) setBest(result.ok ? (result.offers[0]?.priceSantim ?? null) : null);
      });
    return () => {
      live = false;
    };
  }, [side]);

  if (state.status === "missing") notFound();
  const editing = state.status === "ready" ? state.editing : null;
  const methods = state.status === "ready" ? state.methods : [];

  // The numbers as they stand, for the hints and the preview.
  const price = toSantim(draft.price ?? "");
  const total = toMicro(draft.total ?? "");
  const min = toSantim(draft.min ?? "");
  const max = toSantim(draft.max ?? "");
  const aboveBalance =
    side === "SELL" && total !== null && available !== null && compareMicro(total, available) > 0;

  const current = STEPS[step] ?? STEPS[0];

  const next = async () => {
    const ok = await trigger([...current.fields]);
    if (!ok) {
      revealProblems(formElement);
      return;
    }
    setStep((current) => Math.min(LAST, current + 1));
    toTop();
  };

  const back = () => {
    setStep((current) => Math.max(0, current - 1));
    toTop();
  };

  const nudge = (delta: bigint) => {
    const from = BigInt(price ?? best ?? "0");
    const moved = from + delta;
    if (moved <= 0n) return;
    setValue("price", plainSantim(moved.toString()), {
      shouldDirty: true,
      shouldValidate: isSubmitted || errors.price !== undefined,
    });
  };

  const submit = handleSubmit(
    async (values) => {
      setError(null);
      const body = toOfferDraft(values);
      const result = editing
        ? await marketClient.updateOffer(editing.id, body)
        : await marketClient.createOffer({ ...body, side: values.side });
      if (!result.ok) {
        setError(result.message);
        toastFailure(result);
        return;
      }
      // On but hidden: "online" would be the one thing it is not.
      const hidden = result.offer.status === "ACTIVE" ? result.offer.hiddenBecause : null;
      if (hidden) {
        toast.warning(
          editing ? "Saved, but hidden from the market" : "Posted, but hidden from the market",
          { description: HIDDEN_BECAUSE[hidden] },
        );
      } else {
        const shown = formatSantim(toSantim(values.price) ?? "0");
        toast.success(editing ? "Changes saved" : "Your ad is online", {
          description: editing
            ? "Orders already open keep the terms they were placed on."
            : `${values.side === "SELL" ? "Selling" : "Buying"} ${ASSET} at ${shown} ${FIAT}.`,
        });
      }
      router.push("/trade/ads");
    },
    (problems: FieldErrors<AdDraft>) => {
      // A problem left in an earlier step - an ad being edited, say - is shown where it is.
      const at = STEPS.findIndex((entry) => entry.fields.some((field) => problems[field]));
      if (at >= 0 && at !== step) setStep(at);
      revealProblems(formElement);
    },
  );

  const selling = side === "SELL";
  const submitLabel = editing ? "Save changes" : "Post ad";

  return (
    <>
      <BackTo href="/trade/ads">My ads</BackTo>
      <PageHeader
        title={editing ? "Edit ad" : "Post an ad"}
        description={
          editing
            ? "What has already been taken stays taken; the rest follows the new figures."
            : "Three steps: the price, then the amount and how you are paid, then your terms."
        }
      />

      {/* Editing an ad needs no verification: the account that posted it was
          verified at the time, and the API only asks on create. */}
      {!editing && !mayPost ? (
        <VerifyToPost />
      ) : state.status === "loading" ? (
        <Panel>
          <ListNotice>Loading…</ListNotice>
        </Panel>
      ) : state.status === "error" ? (
        <Panel>
          <LoadFailed
            message={state.message}
            onRetry={() => {
              setState({ status: "loading" });
              setAttempt((value) => value + 1);
            }}
          />
        </Panel>
      ) : editing?.status === "CLOSED" ? (
        <Panel>
          <ListNotice>
            This ad is closed, and a closed ad cannot be changed. Post a new one instead.
          </ListNotice>
        </Panel>
      ) : (
        <>
          <Steps step={step} onGo={(index) => setStep(index)} />

          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Panel>
              <form
                ref={setFormElement}
                noValidate
                // Built in the event: Enter on the first steps is Next, on the last it posts.
                onSubmit={(event) => {
                  if (step < LAST) {
                    event.preventDefault();
                    void next();
                    return;
                  }
                  void submit(event);
                }}
                className="flex flex-col gap-6"
              >
                <h2 className="sr-only">{current.title}</h2>

                {step === 0 ? (
                  <>
                    {editing ? (
                      <p className="text-foreground text-sm font-semibold">
                        {selling ? `Selling ${ASSET}` : `Buying ${ASSET}`}
                      </p>
                    ) : (
                      <Segmented
                        value={side}
                        // Which way the ad goes decides which question about payment is asked:
                        // once a submit has shown the problems, the answer is checked again.
                        onChange={(value) =>
                          setValue("side", value, { shouldValidate: isSubmitted })
                        }
                        options={SIDES}
                        label="Buy or sell"
                      />
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Fixed label="Asset" value={ASSET} note="BNB Smart Chain" />
                      <Fixed label="For" value="ETB" note="Ethiopian birr" />
                    </div>

                    <Field label={`Price, ${FIAT} per ${ASSET}`} error={errors.price?.message}>
                      {(a11y) => (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            aria-label={`Lower the price by ${formatSantim(PRICE_STEP.toString())} ${FIAT}`}
                            onClick={() => nudge(-PRICE_STEP)}
                            className="rounded-control border-border bg-surface text-foreground hover:text-primary flex size-11 shrink-0 items-center justify-center border transition-colors duration-150"
                          >
                            <Minus size={16} weight="bold" aria-hidden="true" />
                          </button>
                          <Input
                            {...a11y}
                            {...register("price")}
                            inputMode="decimal"
                            placeholder={best ? plainSantim(best) : "158.50"}
                            className="text-center font-mono text-lg tabular-nums"
                          />
                          <button
                            type="button"
                            aria-label={`Raise the price by ${formatSantim(PRICE_STEP.toString())} ${FIAT}`}
                            onClick={() => nudge(PRICE_STEP)}
                            className="rounded-control border-border bg-surface text-foreground hover:text-primary flex size-11 shrink-0 items-center justify-center border transition-colors duration-150"
                          >
                            <Plus size={16} weight="bold" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </Field>
                    {best ? (
                      <p className="text-muted-foreground -mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] tabular-nums">
                        <span>
                          Best {selling ? "sell" : "buy"} price in the market now:{" "}
                          <span className="text-foreground font-semibold">{birr(best)}</span>
                        </span>
                        {price ? (
                          <span className="bg-status-pending text-status-pending-fg rounded-full px-2 py-0.5 text-[12px] font-medium">
                            {besideBest(price, best)}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                    <p className="rounded-control bg-primary-soft text-primary-soft-foreground px-3.5 py-3 text-[13px] leading-relaxed">
                      A price is fixed: {FIAT} has no reference rate for it to follow. You can
                      change it at any time; an order already open keeps the price it was placed at.
                    </p>
                  </>
                ) : null}

                {step === 1 ? (
                  <>
                    <Field
                      label={`Total amount, ${ASSET}`}
                      hint={
                        selling
                          ? "How much you are offering across all trades on this ad. Nothing is locked until a trade opens."
                          : "How much you want to buy across all trades on this ad."
                      }
                      error={errors.total?.message}
                    >
                      {(a11y) => (
                        <Input
                          {...a11y}
                          {...register("total")}
                          inputMode="decimal"
                          placeholder="100"
                          className="font-mono tabular-nums"
                        />
                      )}
                    </Field>
                    {selling ? (
                      <div className="-mt-3 flex flex-col gap-3">
                        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-[13px] tabular-nums">
                          Available{" "}
                          <span className="text-foreground font-semibold">
                            {available === null ? `— ${ASSET}` : usdt(available)}
                          </span>
                          {available !== null && compareMicro(available, "0") > 0 ? (
                            <button
                              type="button"
                              onClick={() =>
                                setValue("total", plainMicro(available), {
                                  shouldDirty: true,
                                  shouldValidate: errors.total !== undefined,
                                })
                              }
                              className="text-primary hover:text-primary-hover font-semibold"
                            >
                              Use all
                            </button>
                          ) : null}
                        </p>
                        {aboveBalance ? (
                          <div
                            role="status"
                            className="rounded-control bg-status-pending text-status-pending-fg flex gap-2.5 px-3.5 py-3 text-[13px] leading-relaxed"
                          >
                            <WarningCircle
                              size={18}
                              weight="fill"
                              aria-hidden="true"
                              className="mt-0.5 shrink-0"
                            />
                            <span>
                              <span className="font-semibold">
                                Your balance covers {usdt(available ?? "0")} of these{" "}
                                {usdt(total ?? "0")}.
                              </span>{" "}
                              You can still post it. The ad offers what your balance covers, and
                              stays hidden while that is less than one smallest order. After 24
                              hours of that it goes offline.{" "}
                              <AppLink
                                href={walletRoutes.deposit}
                                className="font-semibold underline underline-offset-4"
                              >
                                Deposit USDT
                              </AppLink>
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label={`Smallest trade, ${FIAT}`} error={errors.min?.message}>
                          {(a11y) => (
                            <Input
                              {...a11y}
                              {...register("min")}
                              inputMode="decimal"
                              placeholder="500"
                              className="font-mono tabular-nums"
                            />
                          )}
                        </Field>
                        <Field label={`Largest trade, ${FIAT}`} error={errors.max?.message}>
                          {(a11y) => (
                            <Input
                              {...a11y}
                              {...register("max")}
                              inputMode="decimal"
                              placeholder="20000"
                              className="font-mono tabular-nums"
                            />
                          )}
                        </Field>
                      </div>
                      {price && min && max && compareSantim(min, max) <= 0 ? (
                        <p className="text-muted-foreground mt-2 text-[13px] tabular-nums">
                          ≈ {usdt(amountForFiat(min, price))} – {usdt(amountForFiat(max, price))}{" "}
                          per order
                        </p>
                      ) : null}
                    </div>

                    {selling ? (
                      <Controller
                        control={control}
                        name="methodIds"
                        render={({ field }) => (
                          <fieldset
                            data-invalid={errors.methodIds ? true : undefined}
                            aria-describedby={errors.methodIds ? railsErrorId : undefined}
                          >
                            <legend className="text-foreground mb-2 text-sm font-medium">
                              Where buyers pay you{" "}
                              <span className="text-muted-foreground font-normal">
                                · up to {RAILS_MAX}
                              </span>
                            </legend>
                            <div className="flex flex-wrap gap-2">
                              {methods.map((method) => (
                                <Chip
                                  key={method.id}
                                  checked={field.value.includes(method.id)}
                                  onChange={() => field.onChange(toggled(field.value, method.id))}
                                  bar={PAYMENT_KINDS[method.kind].bar}
                                >
                                  {method.label}
                                </Chip>
                              ))}
                              <AppLink
                                href={withNext(
                                  "/trade/payment-methods",
                                  offerId ? `/trade/ads/${offerId}/edit` : "/trade/ads/new",
                                )}
                                onClick={() =>
                                  keepDraft({
                                    ad: offerId ?? "new",
                                    step,
                                    values: getValues(),
                                    methodIds: methods.map((method) => method.id),
                                  })
                                }
                                className="rounded-control border-border text-primary hover:border-primary/40 flex h-10 items-center gap-1.5 border border-dashed px-3.5 text-[13px] font-semibold"
                              >
                                <Plus size={14} weight="bold" aria-hidden="true" />
                                {methods.length === 0 ? "Add a payment method" : "Add another"}
                              </AppLink>
                            </div>
                            {errors.methodIds ? (
                              <p
                                id={railsErrorId}
                                role="alert"
                                className="text-destructive mt-2 text-[13px]"
                              >
                                {errors.methodIds.message}
                              </p>
                            ) : null}
                          </fieldset>
                        )}
                      />
                    ) : (
                      <Controller
                        control={control}
                        name="kinds"
                        render={({ field }) => (
                          <fieldset
                            data-invalid={errors.kinds ? true : undefined}
                            aria-describedby={errors.kinds ? railsErrorId : undefined}
                          >
                            <legend className="text-foreground mb-2 text-sm font-medium">
                              I can pay through
                            </legend>
                            <div className="flex flex-wrap gap-2">
                              {PAYMENT_KIND_LIST.map((kind) => (
                                <Chip
                                  key={kind}
                                  checked={field.value.includes(kind)}
                                  onChange={() => field.onChange(toggled(field.value, kind))}
                                  bar={PAYMENT_KINDS[kind].bar}
                                >
                                  {PAYMENT_KINDS[kind].label}
                                </Chip>
                              ))}
                            </div>
                            {errors.kinds ? (
                              <p
                                id={railsErrorId}
                                role="alert"
                                className="text-destructive mt-2 text-[13px]"
                              >
                                {errors.kinds.message}
                              </p>
                            ) : null}
                          </fieldset>
                        )}
                      />
                    )}

                    <fieldset>
                      <legend className="text-foreground mb-2 text-sm font-medium">
                        {selling ? "Buyers must pay within" : "You must pay within"}
                      </legend>
                      <div className="flex flex-wrap gap-2">
                        {PAYMENT_WINDOWS.map((minutes) => (
                          <button
                            key={minutes}
                            type="button"
                            aria-pressed={draft.window === minutes}
                            onClick={() => setValue("window", minutes)}
                            className={cn(
                              "rounded-control h-10 border px-4 text-sm font-medium transition-colors duration-150",
                              draft.window === minutes
                                ? "border-primary bg-primary-soft text-primary-soft-foreground"
                                : "border-border text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {minutes} min
                          </button>
                        ))}
                      </div>
                      <p className="text-muted-foreground mt-2 text-[13px]">
                        A trade not marked as paid by then expires on its own.
                      </p>
                    </fieldset>
                  </>
                ) : null}

                {step === 2 ? (
                  <>
                    <Field
                      label="Terms"
                      hint={`Shown to a taker before they place the order. Optional. ${(draft.terms ?? "").length} / ${TERMS_MAX.toLocaleString("en-GB")}`}
                      error={errors.terms?.message}
                    >
                      {(a11y) => (
                        <Textarea
                          {...a11y}
                          {...register("terms")}
                          maxLength={TERMS_MAX}
                          placeholder="Pay from an account in your own name. No third-party payments."
                        />
                      )}
                    </Field>

                    <Field
                      label="Auto-reply"
                      hint={`The first message in every trade's chat, from you. Optional. ${(draft.autoReply ?? "").length} / ${AUTO_REPLY_MAX}`}
                      error={errors.autoReply?.message}
                    >
                      {(a11y) => (
                        <Textarea
                          {...a11y}
                          {...register("autoReply")}
                          maxLength={AUTO_REPLY_MAX}
                          rows={2}
                          placeholder="Thanks! Send the money and press I have paid; I release within a few minutes."
                        />
                      )}
                    </Field>

                    <fieldset className="flex flex-col gap-3">
                      <legend className="text-foreground mb-2 text-sm font-medium">
                        Who may take it
                      </legend>
                      <div className="rounded-control border-border flex items-center justify-between gap-3 border px-3.5 py-3">
                        <div>
                          <p id={verifiedLabelId} className="text-foreground text-sm font-medium">
                            Verified accounts only
                          </p>
                          <p className="text-muted-foreground text-[12px]">
                            Traders who have not verified their identity see the ad as Limited.
                          </p>
                        </div>
                        <Controller
                          control={control}
                          name="requireVerified"
                          render={({ field }) => (
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              aria-labelledby={verifiedLabelId}
                            />
                          )}
                        />
                      </div>
                      <Field
                        label="Minimum completed trades"
                        hint="0 lets anyone take it."
                        error={errors.minCompletedTrades?.message}
                      >
                        {(a11y) => (
                          <Input
                            {...a11y}
                            {...register("minCompletedTrades")}
                            inputMode="numeric"
                            className="font-mono tabular-nums sm:max-w-40"
                          />
                        )}
                      </Field>
                    </fieldset>

                    <section
                      aria-label="Review"
                      className="rounded-surface bg-muted flex flex-col gap-2 px-4 py-4 text-sm"
                    >
                      <p className="text-muted-foreground text-[12px] font-medium">Review</p>
                      <Row label={selling ? "You sell" : "You buy"}>
                        {total ? usdt(total) : "—"} at {price ? birr(price) : "—"}
                      </Row>
                      <Row label="Order limit">
                        {min && max ? `${formatSantim(min)} – ${birr(max)}` : "—"}
                      </Row>
                      <Row label={selling ? "Buyers pay to" : "You pay through"}>
                        {selling
                          ? methods
                              .filter((method) => (draft.methodIds ?? []).includes(method.id))
                              .map((method) => method.label)
                              .join(", ") || "—"
                          : (draft.kinds ?? [])
                              .map((kind) => PAYMENT_KINDS[kind].label)
                              .join(", ") || "—"}
                      </Row>
                      <Row label={selling ? "Buyers must pay within" : "You must pay within"}>
                        {draft.window} minutes
                      </Row>
                      {selling && aboveBalance ? (
                        <Row label="Ad balance now">
                          <span className="text-status-attention-fg font-semibold">
                            {usdt(available ?? "0")} · shows as your balance allows
                          </span>
                        </Row>
                      ) : null}
                    </section>
                  </>
                ) : null}

                {/*
                  The way on, and any refusal, sit together; on a phone they stay
                  on screen above the tab bar, the way the order button does.
                */}
                <div className="max-lg:border-border max-lg:bg-surface flex flex-col gap-3 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[calc(4rem+env(safe-area-inset-bottom))] max-lg:z-30 max-lg:border-t max-lg:px-4 max-lg:py-3">
                  <FormError message={error} />
                  <div className="grid grid-cols-[1fr_2fr] gap-3 sm:flex sm:justify-between">
                    {step === 0 ? (
                      <ButtonLink href="/trade/ads" variant="secondary" size="lg" arrow={false}>
                        Cancel
                      </ButtonLink>
                    ) : (
                      <Button type="button" variant="secondary" size="lg" onClick={back}>
                        Back
                      </Button>
                    )}
                    {step < LAST ? (
                      <Button key="next" type="submit" size="lg" className="sm:min-w-40">
                        Next
                      </Button>
                    ) : (
                      <Button
                        key="post"
                        type="submit"
                        size="lg"
                        variant={selling ? "sell" : "primary"}
                        className="sm:min-w-44"
                        loading={isSubmitting}
                      >
                        {submitLabel}
                      </Button>
                    )}
                  </div>
                </div>
              </form>
            </Panel>

            <aside aria-label="How takers will see it" className="hidden flex-col gap-2.5 lg:flex">
              <p className="text-muted-foreground text-[12px] font-medium">
                How {selling ? "buyers" : "sellers"} will see it
              </p>
              <div className="rounded-surface border-border bg-surface shadow-panel flex flex-col gap-3 border p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={user.username} online />
                  <span className="text-foreground truncate font-semibold">{user.username}</span>
                </div>
                <p>
                  <span className="text-foreground font-mono text-2xl font-medium tabular-nums">
                    {price ? formatSantim(price) : "—"}
                  </span>{" "}
                  <span className="text-muted-foreground text-[12px]">{FIAT}</span>
                </p>
                {step >= 1 ? (
                  <>
                    <p className="text-[13px] tabular-nums">
                      <span className="text-muted-foreground">Limit</span>{" "}
                      {min && max ? `${formatSantim(min)} – ${birr(max)}` : "—"}
                    </p>
                    <PaymentKindChips
                      kinds={
                        selling
                          ? [
                              ...new Set(
                                methods
                                  .filter((method) => (draft.methodIds ?? []).includes(method.id))
                                  .map((method) => method.kind),
                              ),
                            ]
                          : ((draft.kinds ?? []) as PaymentMethodKind[])
                      }
                    />
                  </>
                ) : (
                  <p className="text-muted-foreground text-[12px]">
                    Amount, limits and payment come next.
                  </p>
                )}
                {step === 2 && draft.terms ? (
                  <p className="text-muted-foreground border-border border-t pt-3 text-[13px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-line">
                    {draft.terms}
                  </p>
                ) : null}
              </div>
              {aboveBalance ? (
                <p className="bg-status-attention text-status-attention-fg rounded-control px-3 py-2 text-[12px] font-medium">
                  Hidden until your balance covers one smallest order
                </p>
              ) : null}
            </aside>
          </div>
          {/* Room at the end of the page for the buttons pinned above the tab bar on a phone. */}
          <div aria-hidden="true" className="h-36 lg:hidden" />
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- pieces */

/** Where the person is among the three steps; the steps behind them can be gone back to. */
function Steps({ step, onGo }: { step: number; onGo: (index: number) => void }) {
  return (
    <>
      <p className="text-muted-foreground text-[13px] font-medium lg:hidden">
        Step {step + 1} of {STEPS.length} · {(STEPS[step] ?? STEPS[0]).title}
      </p>
      <div aria-hidden="true" className="bg-border mt-2 h-1 overflow-hidden rounded-full lg:hidden">
        <div
          className="bg-primary h-full transition-[width] duration-200"
          style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
        />
      </div>
      <ol aria-label="Steps" className="hidden max-w-3xl items-center gap-3 lg:flex">
        {STEPS.map((entry, index) => {
          const done = index < step;
          const current = index === step;
          const mark = (
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold",
                current
                  ? "border-primary bg-primary text-primary-foreground"
                  : done
                    ? "bg-primary-soft text-primary-soft-foreground border-transparent"
                    : "border-border text-muted-foreground",
              )}
            >
              {done ? <Check size={14} weight="bold" aria-hidden="true" /> : index + 1}
            </span>
          );
          return (
            <li key={entry.title} className="flex flex-1 items-center gap-3 last:flex-none">
              {done ? (
                <button
                  type="button"
                  onClick={() => onGo(index)}
                  className="text-muted-foreground hover:text-foreground flex items-center gap-2.5 text-sm font-medium whitespace-nowrap"
                >
                  {mark}
                  {entry.title}
                </button>
              ) : (
                <span
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 text-sm whitespace-nowrap",
                    current ? "text-foreground font-semibold" : "text-muted-foreground font-medium",
                  )}
                >
                  {mark}
                  {entry.title}
                </span>
              )}
              {index < STEPS.length - 1 ? (
                <span aria-hidden="true" className="bg-border h-px flex-1" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** A choice that is not a choice here: the asset and the fiat, shown for what they are. */
function Fixed({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <p className="text-foreground mb-1.5 text-sm font-medium">{label}</p>
      <p className="rounded-control bg-muted flex h-11 items-center gap-2 px-3.5">
        <span className="text-foreground text-sm font-semibold">{value}</span>
        <span className="text-muted-foreground text-[12px]">{note}</span>
      </p>
    </div>
  );
}

/** A rail that is in the ad or out of it: a checkbox drawn as a chip, with its bar. */
function Chip({
  checked,
  onChange,
  bar,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  bar: string;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "rounded-control flex h-10 cursor-pointer items-center gap-2 border px-3.5 text-[13px] font-medium transition-colors duration-150",
        "has-focus-visible:outline-ring has-focus-visible:outline-2 has-focus-visible:outline-offset-2",
        checked
          ? "border-primary bg-primary-soft text-primary-soft-foreground"
          : "border-border text-foreground hover:border-primary/40",
      )}
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      <span aria-hidden="true" className={cn("h-3.5 w-0.5 rounded-full", bar)} />
      {children}
      {checked ? <Check size={14} weight="bold" aria-hidden="true" /> : null}
    </label>
  );
}

/** One line of the review: what, and the answer. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="flex justify-between gap-4 tabular-nums">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground text-right">{children}</span>
    </p>
  );
}
