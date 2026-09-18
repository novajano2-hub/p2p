"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { notFound, useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { LoadFailed } from "@/components/app/load-failed";
import { PageHeader, Panel } from "@/components/app/panel";
import { FormError } from "@/components/auth/notices";
import { BackTo, ListNotice, Segmented } from "@/components/market/bits";
import { useMayPostAds, VerifyToPost } from "@/components/market/verify-to-post";
import { AppLink } from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Note } from "@/components/wallet/shared";
import { cn } from "@/lib/cn";
import { marketClient, type MyOffer, type PaymentMethod } from "@/lib/market/client";
import {
  adForm,
  AUTO_REPLY_MAX,
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
import { formatSantim, plainSantim, toSantim } from "@/lib/market/money";
import { plainMicro } from "@/lib/money";
import { withNext } from "@/lib/next-path";
import { revealProblems } from "@/lib/reveal-problems";
import { toast, toastFailure } from "@/lib/toast";

/*
  Posting an ad, or changing one. The Binance form in the order it asks:
  which way, at what price, how much in total, the limits a single trade
  may fall between, how long a buyer gets to pay, how you will be paid (or
  can pay), and the words a taker reads before they place the order.

  Nothing here locks any USDT. A sell ad is listed only while the account
  can fund it, and the escrow is taken from the balance at the moment a
  trade opens - so an ad for more than is in the wallet is allowed, and
  simply shows the smaller figure.

  Every rule is checked before sending, all at once (lib/market/forms.ts);
  a submit with problems goes to the first of them rather than leaving the
  person at the button wondering why nothing happened.
*/

const SIDES = [
  { value: "SELL", label: `I want to sell ${ASSET}` },
  { value: "BUY", label: `I want to buy ${ASSET}` },
] as const;

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

export function AdForm({ offerId }: { offerId?: string | undefined }) {
  const mayPost = useMayPostAds();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);
  const railsErrorId = useId();

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<AdDraft>({
    resolver: zodResolver(adForm),
    defaultValues: EMPTY,
    // revealProblems() does it, in the page's order rather than the fields'.
    shouldFocusError: false,
  });
  // useWatch rather than watch(): the function watch() returns cannot be
  // memoized, so the React Compiler gives up on the whole component.
  const side = useWatch({ control, name: "side" });
  const paymentWindow = useWatch({ control, name: "window" });

  useEffect(() => {
    let live = true;
    void (async () => {
      const [methods, editing] = await Promise.all([
        marketClient.paymentMethods(),
        offerId ? marketClient.myOffer(offerId) : Promise.resolve(null),
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
      setState({
        status: "ready",
        methods: methods.paymentMethods.filter((method) => method.status === "ACTIVE"),
        editing: offer,
      });
      if (offer) reset(fromOffer(offer));
    })();
    return () => {
      live = false;
    };
  }, [offerId, reset, attempt]);

  if (state.status === "missing") notFound();
  const editing = state.status === "ready" ? state.editing : null;
  const methods = state.status === "ready" ? state.methods : [];

  const submit = handleSubmit(
    async (draft) => {
      setError(null);
      const body = toOfferDraft(draft);
      const result = editing
        ? await marketClient.updateOffer(editing.id, body)
        : await marketClient.createOffer({ ...body, side: draft.side });
      if (!result.ok) {
        setError(result.message);
        toastFailure(result);
        return;
      }
      const price = formatSantim(toSantim(draft.price) ?? "0");
      toast.success(editing ? "Changes saved" : "Your ad is online", {
        description: editing
          ? "Orders already open keep the terms they were placed on."
          : `${draft.side === "SELL" ? "Selling" : "Buying"} ${ASSET} at ${price} ${FIAT}.`,
      });
      router.push("/trade/ads");
    },
    () => revealProblems(formElement),
  );

  return (
    <>
      <BackTo href="/trade/ads">My ads</BackTo>
      <PageHeader
        title={editing ? "Edit ad" : "Post an ad"}
        description={
          editing
            ? "What has already been taken stays taken; the rest follows the new figures."
            : "Set your price and your limits. The ad is listed while your balance can fund it."
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
        <div className="grid gap-4 lg:grid-cols-5 lg:gap-6">
          <Panel className="lg:col-span-3">
            <form ref={setFormElement} noValidate onSubmit={submit} className="flex flex-col gap-5">
              {editing ? null : (
                <Segmented
                  value={side}
                  // Which way the ad goes decides which question about payment is asked:
                  // once a submit has shown the problems, the answer is checked again.
                  onChange={(next) => setValue("side", next, { shouldValidate: isSubmitted })}
                  options={SIDES}
                  label="Buy or sell"
                />
              )}

              <Field label={`Price, ${FIAT} per ${ASSET}`} error={errors.price?.message}>
                {(a11y) => (
                  <Input
                    {...a11y}
                    {...register("price")}
                    inputMode="decimal"
                    placeholder="158.50"
                    className="tabular-nums"
                  />
                )}
              </Field>

              <Field
                label={`Total amount, ${ASSET}`}
                hint={
                  side === "SELL"
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
                    className="tabular-nums"
                  />
                )}
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`Smallest trade, ${FIAT}`} error={errors.min?.message}>
                  {(a11y) => (
                    <Input
                      {...a11y}
                      {...register("min")}
                      inputMode="decimal"
                      placeholder="500"
                      className="tabular-nums"
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
                      className="tabular-nums"
                    />
                  )}
                </Field>
              </div>

              <fieldset>
                <legend className="text-foreground mb-2 text-sm font-medium">Time to pay</legend>
                <div className="flex flex-wrap gap-2">
                  {PAYMENT_WINDOWS.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      aria-pressed={paymentWindow === minutes}
                      onClick={() => setValue("window", minutes)}
                      className={cn(
                        "rounded-control h-9 border px-4 text-sm font-medium transition-colors duration-150",
                        paymentWindow === minutes
                          ? "border-primary bg-primary-soft text-primary-soft-foreground"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {minutes} min
                    </button>
                  ))}
                </div>
                <p className="text-muted-foreground mt-2 text-[13px]">
                  A trade the buyer has not marked as paid by then expires on its own.
                </p>
              </fieldset>

              {side === "SELL" ? (
                <Controller
                  control={control}
                  name="methodIds"
                  render={({ field }) => (
                    <fieldset
                      data-invalid={errors.methodIds ? true : undefined}
                      aria-describedby={errors.methodIds ? railsErrorId : undefined}
                    >
                      <legend className="text-foreground mb-2 text-sm font-medium">
                        Be paid through
                      </legend>
                      {methods.length === 0 ? (
                        <p className="text-muted-foreground text-[13px]">
                          You have no payment method yet.{" "}
                          <AppLink
                            href={withNext(
                              "/trade/payment-methods",
                              offerId ? `/trade/ads/${offerId}/edit` : "/trade/ads/new",
                            )}
                            className="text-primary font-medium underline-offset-4 hover:underline"
                          >
                            Add one
                          </AppLink>{" "}
                          to post a sell ad.
                        </p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {methods.map((method) => (
                            <Checkbox
                              key={method.id}
                              label={`${method.label} · ${PAYMENT_KINDS[method.kind].label}`}
                              checked={field.value.includes(method.id)}
                              onChange={() => field.onChange(toggled(field.value, method.id))}
                            />
                          ))}
                        </div>
                      )}
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
                      <div className="flex flex-col gap-2">
                        {PAYMENT_KIND_LIST.map((kind) => (
                          <Checkbox
                            key={kind}
                            label={PAYMENT_KINDS[kind].label}
                            checked={field.value.includes(kind)}
                            onChange={() => field.onChange(toggled(field.value, kind))}
                          />
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

              <Field
                label="Terms"
                hint="Shown to a taker before they place the order. Optional."
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
                hint="The first message in every trade's chat, from you. Optional."
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

              <div className="grid gap-4 sm:grid-cols-2">
                <Checkbox label="Verified accounts only" {...register("requireVerified")} />
                <Field label="Minimum completed trades" error={errors.minCompletedTrades?.message}>
                  {(a11y) => (
                    <Input
                      {...a11y}
                      {...register("minCompletedTrades")}
                      inputMode="numeric"
                      className="tabular-nums"
                    />
                  )}
                </Field>
              </div>

              {/* A refusal is answered where the button is, not at the top of a long form. */}
              <div>
                <FormError message={error} />
                <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
                  {editing ? "Save changes" : "Post ad"}
                </Button>
              </div>
            </form>
          </Panel>

          <div className="flex flex-col gap-4 lg:col-span-2">
            <Panel title="How ads work">
              <ul className="text-muted-foreground flex flex-col gap-2 text-[13px] leading-relaxed">
                <li>
                  A sell ad is listed only while your available balance can fund its smallest trade.
                  The escrow is taken when a trade opens, not when the ad is posted.
                </li>
                <li>
                  Buyers see your price, your limits, your record and your terms - never your
                  payment details until a trade between you is open.
                </li>
                <li>
                  You can take an ad offline any time. Orders already running are not affected.
                </li>
              </ul>
            </Panel>
            <Note>Verified accounts can post up to 5 live ads.</Note>
          </div>
        </div>
      )}
    </>
  );
}
