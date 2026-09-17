"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
import {
  marketClient,
  type MyOffer,
  type OfferDraft,
  type OfferSide,
  type PaymentMethod,
  type PaymentMethodKind,
} from "@/lib/market/client";
import {
  ASSET,
  FIAT,
  PAYMENT_KINDS,
  PAYMENT_KIND_LIST,
  PAYMENT_WINDOWS,
} from "@/lib/market/labels";
import { compareSantim, plainSantim, toSantim } from "@/lib/market/money";
import { plainMicro, toMicro } from "@/lib/money";
import { withNext } from "@/lib/next-path";

/*
  Posting an ad, or changing one. The Binance form in the order it asks:
  which way, at what price, how much in total, the limits a single trade
  may fall between, how long a buyer gets to pay, how you will be paid (or
  can pay), and the words a taker reads before they place the order.

  Nothing here locks any USDT. A sell ad is listed only while the account
  can fund it, and the escrow is taken from the balance at the moment a
  trade opens - so an ad for more than is in the wallet is allowed, and
  simply shows the smaller figure.
*/

const SIDES = [
  { value: "SELL", label: `I want to sell ${ASSET}` },
  { value: "BUY", label: `I want to buy ${ASSET}` },
] as const;

type Draft = {
  side: OfferSide;
  price: string;
  total: string;
  min: string;
  max: string;
  window: number;
  methodIds: string[];
  kinds: PaymentMethodKind[];
  terms: string;
  autoReply: string;
  requireVerified: boolean;
  minCompletedTrades: string;
};

type Errors = Partial<Record<keyof Draft, string>>;

const EMPTY: Draft = {
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
  | { status: "error"; message: string }
  | { status: "ready"; methods: PaymentMethod[]; editing: MyOffer | null };

function fromOffer(offer: MyOffer): Draft {
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

/** What the API needs, or the field that stops it. */
function toRequest(draft: Draft): { ok: true; body: OfferDraft } | { ok: false; errors: Errors } {
  const errors: Errors = {};
  const price = toSantim(draft.price);
  const total = toMicro(draft.total);
  const min = toSantim(draft.min);
  const max = toSantim(draft.max);
  if (!price || price === "0") errors.price = `Enter the price in ${FIAT} per ${ASSET}.`;
  if (!total || total === "0") errors.total = `Enter how much ${ASSET} the ad is for.`;
  if (!min || min === "0") errors.min = `Enter the smallest trade, in ${FIAT}.`;
  if (!max || max === "0") errors.max = `Enter the largest trade, in ${FIAT}.`;
  if (min && max && compareSantim(min, max) > 0)
    errors.max = "The maximum must be at least the minimum.";
  if (draft.side === "SELL" && draft.methodIds.length === 0) {
    errors.methodIds = "Choose at least one way to be paid.";
  }
  if (draft.side === "BUY" && draft.kinds.length === 0) {
    errors.kinds = "Choose at least one way you will pay.";
  }
  const minTrades = Number(draft.minCompletedTrades || "0");
  if (!Number.isInteger(minTrades) || minTrades < 0 || minTrades > 10_000) {
    errors.minCompletedTrades = "Enter a whole number.";
  }
  if (Object.keys(errors).length > 0 || !price || !total || !min || !max)
    return { ok: false, errors };
  return {
    ok: true,
    body: {
      priceSantim: price,
      totalAmount: total,
      minSantim: min,
      maxSantim: max,
      paymentWindowMinutes: draft.window,
      ...(draft.side === "SELL"
        ? { paymentMethodIds: draft.methodIds }
        : { paymentKinds: draft.kinds }),
      terms: draft.terms.trim(),
      autoReply: draft.autoReply.trim(),
      requireVerified: draft.requireVerified,
      minCompletedTrades: minTrades,
    },
  };
}

export function AdForm({ offerId }: { offerId?: string | undefined }) {
  const mayPost = useMayPostAds();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        setState({ status: "error", message: editing.message });
        return;
      }
      const offer = editing?.ok ? editing.offer : null;
      setState({
        status: "ready",
        methods: methods.paymentMethods.filter((method) => method.status === "ACTIVE"),
        editing: offer,
      });
      if (offer) setDraft(fromOffer(offer));
    })();
    return () => {
      live = false;
    };
  }, [offerId]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const toggle = (key: "methodIds" | "kinds", value: string) => {
    setDraft((current) => {
      const list = current[key] as string[];
      const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
      return { ...current, [key]: next };
    });
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async () => {
    setError(null);
    const request = toRequest(draft);
    if (!request.ok) {
      setErrors(request.errors);
      return;
    }
    setSubmitting(true);
    const result =
      state.status === "ready" && state.editing
        ? await marketClient.updateOffer(state.editing.id, request.body)
        : await marketClient.createOffer({ ...request.body, side: draft.side });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.push("/trade/ads");
  };

  const editing = state.status === "ready" ? state.editing : null;
  const methods = state.status === "ready" ? state.methods : [];

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
          <ListNotice>{state.message}</ListNotice>
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5 lg:gap-6">
          <Panel className="lg:col-span-3">
            <FormError message={error} />
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
              className="flex flex-col gap-5"
            >
              {editing ? null : (
                <Segmented
                  value={draft.side}
                  onChange={(side) => set("side", side)}
                  options={SIDES}
                  label="Buy or sell"
                />
              )}

              <Field label={`Price, ${FIAT} per ${ASSET}`} error={errors.price}>
                {(control) => (
                  <Input
                    {...control}
                    value={draft.price}
                    onChange={(e) => set("price", e.target.value)}
                    inputMode="decimal"
                    placeholder="158.50"
                    className="tabular-nums"
                  />
                )}
              </Field>

              <Field
                label={`Total amount, ${ASSET}`}
                hint={
                  draft.side === "SELL"
                    ? "How much you are offering across all trades on this ad. Nothing is locked until a trade opens."
                    : "How much you want to buy across all trades on this ad."
                }
                error={errors.total}
              >
                {(control) => (
                  <Input
                    {...control}
                    value={draft.total}
                    onChange={(e) => set("total", e.target.value)}
                    inputMode="decimal"
                    placeholder="100"
                    className="tabular-nums"
                  />
                )}
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`Smallest trade, ${FIAT}`} error={errors.min}>
                  {(control) => (
                    <Input
                      {...control}
                      value={draft.min}
                      onChange={(e) => set("min", e.target.value)}
                      inputMode="decimal"
                      placeholder="500"
                      className="tabular-nums"
                    />
                  )}
                </Field>
                <Field label={`Largest trade, ${FIAT}`} error={errors.max}>
                  {(control) => (
                    <Input
                      {...control}
                      value={draft.max}
                      onChange={(e) => set("max", e.target.value)}
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
                      aria-pressed={draft.window === minutes}
                      onClick={() => set("window", minutes)}
                      className={cn(
                        "rounded-control h-9 border px-4 text-sm font-medium transition-colors duration-150",
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
                  A trade the buyer has not marked as paid by then expires on its own.
                </p>
              </fieldset>

              {draft.side === "SELL" ? (
                <fieldset>
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
                          checked={draft.methodIds.includes(method.id)}
                          onChange={() => toggle("methodIds", method.id)}
                        />
                      ))}
                    </div>
                  )}
                  {errors.methodIds ? (
                    <p role="alert" className="text-destructive mt-2 text-[13px]">
                      {errors.methodIds}
                    </p>
                  ) : null}
                </fieldset>
              ) : (
                <fieldset>
                  <legend className="text-foreground mb-2 text-sm font-medium">
                    I can pay through
                  </legend>
                  <div className="flex flex-col gap-2">
                    {PAYMENT_KIND_LIST.map((kind) => (
                      <Checkbox
                        key={kind}
                        label={PAYMENT_KINDS[kind].label}
                        checked={draft.kinds.includes(kind)}
                        onChange={() => toggle("kinds", kind)}
                      />
                    ))}
                  </div>
                  {errors.kinds ? (
                    <p role="alert" className="text-destructive mt-2 text-[13px]">
                      {errors.kinds}
                    </p>
                  ) : null}
                </fieldset>
              )}

              <Field
                label="Terms"
                hint="Shown to a taker before they place the order. Optional."
                error={errors.terms}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    value={draft.terms}
                    onChange={(e) => set("terms", e.target.value)}
                    maxLength={1000}
                    placeholder="Pay from an account in your own name. No third-party payments."
                  />
                )}
              </Field>

              <Field
                label="Auto-reply"
                hint="The first message in every trade's chat, from you. Optional."
                error={errors.autoReply}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    value={draft.autoReply}
                    onChange={(e) => set("autoReply", e.target.value)}
                    maxLength={500}
                    rows={2}
                    placeholder="Thanks! Send the money and press I have paid; I release within a few minutes."
                  />
                )}
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Checkbox
                  label="Verified accounts only"
                  checked={draft.requireVerified}
                  onChange={(e) => set("requireVerified", e.target.checked)}
                />
                <Field label="Minimum completed trades" error={errors.minCompletedTrades}>
                  {(control) => (
                    <Input
                      {...control}
                      value={draft.minCompletedTrades}
                      onChange={(e) => set("minCompletedTrades", e.target.value)}
                      inputMode="numeric"
                      className="tabular-nums"
                    />
                  )}
                </Field>
              </div>

              <Button type="submit" size="lg" className="w-full" loading={submitting}>
                {editing ? "Save changes" : "Post ad"}
              </Button>
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
                <li>You can pause an ad any time. Trades already running are not affected.</li>
              </ul>
            </Panel>
            <Note>Verified accounts can post up to 5 live ads.</Note>
          </div>
        </div>
      )}
    </>
  );
}
