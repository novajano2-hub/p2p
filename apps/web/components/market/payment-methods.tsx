"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CreditCard } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { EmptyState, PageHeader, Panel } from "@/components/app/panel";
import { FormError } from "@/components/auth/notices";
import { BackTo, ConfirmButton, ListNotice } from "@/components/market/bits";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Note } from "@/components/wallet/shared";
import { cn } from "@/lib/cn";
import {
  marketClient,
  paymentMethodKind,
  type PaymentMethod,
  type PaymentMethodKind,
} from "@/lib/market/client";
import { BANK_KINDS, PAYMENT_KINDS, WALLET_KINDS } from "@/lib/market/labels";
import { safeNext } from "@/lib/next-path";
import { placeOnField, revealProblems } from "@/lib/reveal-problems";
import { toast, toastFailure } from "@/lib/toast";

/*
  Where a seller is paid. A payment method is the account a buyer will be
  told to send birr to, so the rules here are the rules a buyer needs to be
  able to trust: the name on it is the name on the account, the number is
  checked to the digit before it is stored, and a method that is wrong is
  archived and replaced rather than edited - the trades that showed the old
  details still say what they said.

  A bank is a method of its own - "Awash Bank", not "bank transfer" with a
  bank chosen underneath - because that is how a buyer thinks about where
  to pay from, and how Binance lists them.

  Reached from the middle of something as often as from the market: an offer
  that needs a method of a kind the buyer pays through, an ad being posted.
  Those links carry ?next= with their own address, and this page goes back
  there - from its Back link, and on its own the moment the method is added,
  since adding one was the whole errand.
*/

const ethiopianPhone = z
  .string()
  .trim()
  .regex(/^(\+?251|0)?[79]\d{8}$/, { error: "Enter an Ethiopian mobile number, like 0912345678." });

type BankKind = (typeof BANK_KINDS)[number];
type WalletKind = (typeof WALLET_KINDS)[number];
const isBank = (kind: PaymentMethodKind): kind is BankKind =>
  (BANK_KINDS as readonly string[]).includes(kind);

const formSchema = z
  .object({
    kind: paymentMethodKind,
    accountHolder: z
      .string()
      .trim()
      .min(2, { error: "Enter the name on the account." })
      .max(120, { error: "That name is too long." }),
    phone: z.string(),
    accountNumber: z.string().trim(),
  })
  .superRefine((value, ctx) => {
    if (isBank(value.kind)) {
      if (!/^\d{6,24}$/.test(value.accountNumber)) {
        ctx.addIssue({
          code: "custom",
          path: ["accountNumber"],
          message: "Enter the account number, digits only.",
        });
      }
    } else if (!ethiopianPhone.safeParse(value.phone).success) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Enter an Ethiopian mobile number, like 0912345678.",
      });
    }
  });
type Form = z.infer<typeof formSchema>;

/** The wallets first, then the banks, each with its bar. Names only, the way Binance's picker reads. */
const KIND_OPTIONS = [...WALLET_KINDS, ...BANK_KINDS].map((kind) => ({
  value: kind,
  label: PAYMENT_KINDS[kind].label,
  bar: PAYMENT_KINDS[kind].bar,
}));

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; methods: PaymentMethod[] };

/** What the Back link calls the place it goes to. */
function placeName(path: string): string {
  if (path.startsWith("/trade/offers/")) return "The offer";
  if (path.startsWith("/trade/ads/")) return "Your ad";
  return "Marketplace";
}

/** An errand: sent here from a screen that is waiting for the method. */
const isErrand = (path: string) =>
  path.startsWith("/trade/offers/") || path.startsWith("/trade/ads/");

export function PaymentMethods() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"), "/trade");
  const [state, setState] = useState<State>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);

  const refresh = useCallback(() => {
    void marketClient.paymentMethods().then((result) => {
      setState(
        result.ok
          ? { status: "ready", methods: result.paymentMethods }
          : { status: "error", message: result.message },
      );
    });
  }, []);
  useEffect(refresh, [refresh]);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(formSchema),
    shouldFocusError: false,
    defaultValues: {
      kind: "TELEBIRR",
      accountHolder: "",
      phone: "",
      accountNumber: "",
    },
  });
  const kind = useWatch({ control, name: "kind" });

  const submit = handleSubmit(
    async (values) => {
      setError(null);
      const result = await marketClient.addPaymentMethod(
        isBank(values.kind)
          ? {
              kind: values.kind,
              accountHolder: values.accountHolder,
              accountNumber: values.accountNumber,
            }
          : {
              kind: values.kind as WalletKind,
              accountHolder: values.accountHolder,
              phone: values.phone,
            },
      );
      if (!result.ok) {
        const fields = {
          accountHolder: "accountHolder",
          phone: "phone",
          accountNumber: "accountNumber",
        } as const;
        if (!placeOnField(result, fields, setFieldError, formElement)) {
          setError(result.message);
          toastFailure(result);
        }
        return;
      }
      // Said before leaving: the toaster outlives the page, so it is still there on the offer.
      toast.success("Payment method added", { description: result.paymentMethod.label });
      if (isErrand(next)) {
        router.push(next);
        return;
      }
      reset();
      refresh();
    },
    () => revealProblems(formElement),
  );

  const archive = async (method: PaymentMethod) => {
    setError(null);
    const result = await marketClient.archivePaymentMethod(method.id);
    if (!result.ok) {
      setError(result.message);
      toastFailure(result);
      return;
    }
    toast.success("Payment method removed", { description: method.label });
    refresh();
  };

  const active = state.status === "ready" ? state.methods.filter((m) => m.status === "ACTIVE") : [];

  return (
    <>
      <BackTo href={next}>{placeName(next)}</BackTo>
      <PageHeader
        title="Payment methods"
        description="The accounts a buyer is told to pay you at. Shown to a buyer only while a trade between you is open."
      />

      <div className="grid gap-4 lg:grid-cols-5 lg:gap-6">
        <Panel title="Your methods" className="lg:col-span-3">
          {error ? <FormError message={error} /> : null}
          {state.status === "loading" ? (
            <ListNotice>Loading…</ListNotice>
          ) : state.status === "error" ? (
            <ListNotice>{state.message}</ListNotice>
          ) : active.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title="No payment methods yet"
              description="Add the Telebirr, CBE Birr, M-Pesa or bank account you want to be paid at. You need one to post a sell ad or take a buy ad."
            />
          ) : (
            <ul className="divide-border divide-y">
              {active.map((method) => (
                <li
                  key={method.id}
                  className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-8 w-1 shrink-0 rounded-full",
                        PAYMENT_KINDS[method.kind].bar,
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-foreground truncate text-[15px] font-medium">
                        {method.label}
                      </p>
                      <p className="text-muted-foreground text-[12px]">
                        {PAYMENT_KINDS[method.kind].fullName}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-4 sm:shrink-0 sm:pl-0">
                    <ConfirmButton
                      question="Remove it?"
                      confirmLabel="Remove"
                      variant="ghost"
                      onConfirm={() => archive(method)}
                    >
                      Remove
                    </ConfirmButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <Note>
              A method named by a live ad cannot be removed; close or edit the ad first. Removing
              one never changes a trade that already showed it.
            </Note>
          </div>
        </Panel>

        <Panel title="Add a payment method" className="lg:col-span-2">
          <form ref={setFormElement} onSubmit={submit} noValidate className="flex flex-col gap-4">
            <Field label="Type" error={errors.kind?.message}>
              {(a11y) => (
                <Controller
                  control={control}
                  name="kind"
                  render={({ field }) => (
                    <Select
                      {...a11y}
                      ref={field.ref}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      options={KIND_OPTIONS}
                    />
                  )}
                />
              )}
            </Field>

            <Field
              label="Name on the account"
              hint="Must be your own name. A payment from a different name is grounds for a dispute."
              error={errors.accountHolder?.message}
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  {...register("accountHolder")}
                  autoComplete="name"
                  placeholder="Abebe Bikila"
                />
              )}
            </Field>

            {isBank(kind) ? (
              <Field
                label={PAYMENT_KINDS[kind].numberLabel}
                hint={`Your account at ${PAYMENT_KINDS[kind].fullName}.`}
                error={errors.accountNumber?.message}
              >
                {(a11y) => (
                  <Input
                    {...a11y}
                    {...register("accountNumber")}
                    inputMode="numeric"
                    autoComplete="off"
                  />
                )}
              </Field>
            ) : (
              <Field label={PAYMENT_KINDS[kind].numberLabel} error={errors.phone?.message}>
                {(a11y) => (
                  <Input
                    {...a11y}
                    {...register("phone")}
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="0912345678"
                  />
                )}
              </Field>
            )}

            <Button type="submit" size="lg" className="mt-2 w-full" loading={isSubmitting}>
              Add payment method
            </Button>
          </form>
        </Panel>
      </div>
    </>
  );
}
