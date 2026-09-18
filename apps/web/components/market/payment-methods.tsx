"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CreditCard, Plus, X } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { LoadFailed } from "@/components/app/load-failed";
import { EmptyState, PageHeader } from "@/components/app/panel";
import { FormError } from "@/components/auth/notices";
import { BackTo, ConfirmButton, ListNotice } from "@/components/market/bits";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
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
  to pay from, and how Binance lists them. The methods are cards; adding one
  opens a panel beside them on a desk and a sheet from the bottom on a
  phone, where the wallet or bank is picked from all seven at once.

  Reached from the middle of something as often as from the market: an offer
  that needs a method of a kind the buyer pays through, an ad being posted.
  Those links carry ?next= with their own address, the panel is open on
  arrival, and this page goes back there - from its Back link, and on its own
  the moment the method is added, since adding one was the whole errand.
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

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; methods: PaymentMethod[] };

/** What the Back link calls the place it goes to. */
function placeName(path: string): string {
  if (path.startsWith("/trade/offers/")) return "The offer";
  if (path.startsWith("/trade/ads/")) return "Your ad";
  return "P2P market";
}

/** An errand: sent here from a screen that is waiting for the method. */
const isErrand = (path: string) =>
  path.startsWith("/trade/offers/") || path.startsWith("/trade/ads/");

export function PaymentMethods() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"), "/trade");
  const [state, setState] = useState<State>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  // Open on arrival when another screen sent the person here to add one.
  const [adding, setAdding] = useState(() => isErrand(next));

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
      >
        <Button type="button" size="sm" onClick={() => setAdding(true)} aria-expanded={adding}>
          <Plus size={15} weight="bold" aria-hidden="true" />
          Add a payment method
        </Button>
      </PageHeader>

      {error ? <FormError message={error} /> : null}
      {state.status === "loading" ? (
        <ListNotice>Loading…</ListNotice>
      ) : state.status === "error" ? (
        <LoadFailed
          message={state.message}
          onRetry={() => {
            setState({ status: "loading" });
            refresh();
          }}
        />
      ) : active.length === 0 ? (
        <div className="rounded-surface border-border bg-surface shadow-panel border p-5">
          <EmptyState
            icon={CreditCard}
            title="No payment methods yet"
            description="Add the Telebirr, CBE Birr, M-Pesa or bank account you want to be paid at. You need one to post a sell ad or take a buy ad."
          />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {active.map((method) => (
            <li
              key={method.id}
              className="rounded-surface border-border bg-surface shadow-panel flex min-w-0 flex-col gap-3 border px-5 py-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={cn("h-9 w-1 shrink-0 rounded-full", PAYMENT_KINDS[method.kind].bar)}
                  />
                  <div className="min-w-0">
                    <p className="text-foreground truncate text-[15px] font-semibold">
                      {method.label}
                    </p>
                    <p className="text-muted-foreground truncate text-[12px]">
                      {PAYMENT_KINDS[method.kind].fullName}
                    </p>
                  </div>
                </div>
                <span className="bg-status-neutral text-status-neutral-fg shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-medium">
                  {isBank(method.kind) ? "Bank" : "Mobile money"}
                </span>
              </div>
              <div className="flex justify-end">
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
      <p className="text-muted-foreground mt-4 max-w-2xl text-[13px] leading-relaxed">
        An account an ad names cannot be removed; close or edit the ad first. Details are never
        edited in place: add the new one and remove the old, so an order that showed the old details
        keeps them.
      </p>

      {adding ? (
        <AddSheet
          onClose={() => setAdding(false)}
          onAdded={(method) => {
            // Said before leaving: the toaster outlives the page, so it is still there on the offer.
            toast.success("Payment method added", { description: method.label });
            if (isErrand(next)) {
              router.push(next);
              return;
            }
            setAdding(false);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

/*
  Adding one: a panel from the right on a desk, a sheet from the bottom on a
  phone, over a scrim that closes it, as Escape does. The first field takes
  the focus, so the keyboard starts where the work does.
*/
function AddSheet({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (method: PaymentMethod) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);
  const titleId = useId();
  const sheet = useRef<HTMLDivElement>(null);

  const {
    register,
    control,
    handleSubmit,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(formSchema),
    shouldFocusError: false,
    defaultValues: { kind: "TELEBIRR", accountHolder: "", phone: "", accountNumber: "" },
  });
  const kind = useWatch({ control, name: "kind" });

  useEffect(() => {
    sheet.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      onAdded(result.paymentMethod);
    },
    () => revealProblems(formElement),
  );

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="bg-foreground/40 fixed inset-0 z-50" />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "bg-surface shadow-panel fixed z-50 flex flex-col overflow-y-auto",
          "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-[20px] px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] motion-safe:animate-[sheet-up_220ms_ease-out] sm:motion-safe:animate-none",
          "sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-0 sm:max-h-none sm:w-[26rem] sm:rounded-none sm:px-6 sm:pt-6",
        )}
      >
        <span
          aria-hidden="true"
          className="bg-border mx-auto mb-3 h-1 w-10 rounded-full sm:hidden"
        />
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-foreground text-lg font-semibold">
            Add a payment method
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground flex size-9 items-center justify-center"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form ref={setFormElement} onSubmit={submit} noValidate className="flex flex-col gap-5">
          <fieldset>
            <legend className="text-foreground mb-2 text-[13px] font-medium">Type</legend>
            <KindGroup label="Mobile money" kinds={WALLET_KINDS} register={register} value={kind} />
            <KindGroup label="Banks" kinds={BANK_KINDS} register={register} value={kind} />
          </fieldset>

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

          <FormError message={error} />
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
            Add payment method
          </Button>
        </form>
      </div>
    </>
  );
}

/** One row of the picker: every wallet, or every bank, as radio chips with their bars. */
function KindGroup({
  label,
  kinds,
  register,
  value,
}: {
  label: string;
  kinds: readonly PaymentMethodKind[];
  register: ReturnType<typeof useForm<Form>>["register"];
  value: PaymentMethodKind;
}) {
  return (
    <div className="mb-3">
      <p className="text-muted-foreground mb-1.5 text-[12px] font-medium">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        {kinds.map((kind) => (
          <label
            key={kind}
            className={cn(
              "rounded-control flex h-11 cursor-pointer items-center gap-2 border px-3 text-[13px] font-medium transition-colors duration-150",
              "has-focus-visible:outline-ring has-focus-visible:outline-2 has-focus-visible:outline-offset-2",
              value === kind
                ? "border-primary bg-primary-soft text-primary-soft-foreground"
                : "border-border text-foreground hover:border-primary/40",
            )}
          >
            <input type="radio" value={kind} {...register("kind")} className="sr-only" />
            <span
              aria-hidden="true"
              className={cn("h-3.5 w-0.5 rounded-full", PAYMENT_KINDS[kind].bar)}
            />
            <span className="truncate">{PAYMENT_KINDS[kind].label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
