"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CreditCard, Plus } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { LoadFailed } from "@/components/app/load-failed";
import { EmptyState, PageHeader } from "@/components/app/panel";
import { FormError } from "@/components/auth/notices";
import { BackTo, ConfirmButton, ListNotice } from "@/components/market/bits";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import {
  marketClient,
  paymentMethodKind,
  type PaymentMethod,
  type PaymentMethodKind,
} from "@/lib/market/client";
import { BANK_KINDS, PAYMENT_KINDS, PAYMENT_KIND_LIST, WALLET_KINDS } from "@/lib/market/labels";
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

  One account for each type. An order names the type - "Telebirr" - and its
  buyer is shown the account behind it, so there can only be one; a type that
  has an account says "Added" in the picker, and a changed number is a
  replacement, which keeps the account's place on the ads that named it.

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
  // Which sheet is up: adding one, or replacing this one. Adding is open on
  // arrival when another screen sent the person here to add one.
  const [sheet, setSheet] = useState<"add" | PaymentMethod | null>(() =>
    isErrand(next) ? "add" : null,
  );

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
  // One account for each type: a type that has one can be replaced, not added again.
  const taken = active.map((method) => method.kind);
  const full = state.status === "ready" && taken.length >= PAYMENT_KIND_LIST.length;

  return (
    <>
      <BackTo href={next}>{placeName(next)}</BackTo>
      <PageHeader
        title="Payment methods"
        description="The accounts a buyer is told to pay you at, one for each type. Shown to a buyer only while a trade between you is open."
      >
        <Button
          type="button"
          size="sm"
          disabled={full}
          onClick={() => setSheet("add")}
          aria-expanded={sheet === "add"}
        >
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
              <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="text-[13px]"
                  aria-label={`Replace ${method.label}`}
                  onClick={() => setSheet(method)}
                >
                  Replace
                </Button>
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
        {full ? "You have an account for every type. " : null}
        One account for each type. To change an account&apos;s details, replace it: your ads that
        used the old one use the new one, and an order already open keeps the details it showed. An
        account an ad names cannot be removed; close or edit the ad first.
      </p>

      {sheet && state.status === "ready" && !(sheet === "add" && full) ? (
        <MethodSheet
          key={sheet === "add" ? "add" : sheet.id}
          taken={taken}
          replacing={sheet === "add" ? null : sheet}
          onClose={() => setSheet(null)}
          onDone={(method, replaced) => {
            // Said before leaving: the toaster outlives the page, so it is still there on the offer.
            toast.success(replaced ? "Payment method replaced" : "Payment method added", {
              description: method.label,
            });
            if (!replaced && isErrand(next)) {
              router.push(next);
              return;
            }
            setSheet(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

/*
  Adding one, or replacing one: a panel from the right on a desk, the sheet
  from the bottom on a phone. Adding picks the type from those that have no
  account yet - the rest say "Added", because there is one account for each
  type. Replacing keeps the type and takes new details: the old account is
  archived and the new one takes its place on the ads that named it.
*/
function MethodSheet({
  taken,
  replacing,
  onClose,
  onDone,
}: {
  taken: readonly PaymentMethodKind[];
  replacing: PaymentMethod | null;
  onClose: () => void;
  onDone: (method: PaymentMethod, replaced: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(formSchema),
    shouldFocusError: false,
    defaultValues: {
      kind:
        replacing?.kind ?? PAYMENT_KIND_LIST.find((kind) => !taken.includes(kind)) ?? "TELEBIRR",
      accountHolder: "",
      phone: "",
      accountNumber: "",
    },
  });
  const kind = useWatch({ control, name: "kind" });

  const submit = handleSubmit(
    async (values) => {
      setError(null);
      const details = isBank(values.kind)
        ? {
            kind: values.kind,
            accountHolder: values.accountHolder,
            accountNumber: values.accountNumber,
          }
        : {
            kind: values.kind as WalletKind,
            accountHolder: values.accountHolder,
            phone: values.phone,
          };
      const result = replacing
        ? await marketClient.replacePaymentMethod(replacing.id, details)
        : await marketClient.addPaymentMethod(details);
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
      onDone(result.paymentMethod, replacing !== null);
    },
    () => revealProblems(formElement),
  );

  return (
    <Sheet
      open
      title={
        replacing
          ? `Replace your ${PAYMENT_KINDS[replacing.kind].label} account`
          : "Add a payment method"
      }
      onClose={onClose}
      closeLabel="Close"
      desktop="panel"
      initialFocus={replacing ? "input" : "input:checked"}
      className="px-5 pb-5 sm:px-6 sm:pb-6"
    >
      <form ref={setFormElement} onSubmit={submit} noValidate className="flex flex-col gap-5">
        {replacing ? (
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            Replacing {replacing.label}. It will be archived, and your ads that used it will use the
            new account. An order already open keeps the details it showed.
          </p>
        ) : (
          <fieldset>
            <legend className="text-foreground mb-2 text-[13px] font-medium">Type</legend>
            <KindGroup
              label="Mobile money"
              kinds={WALLET_KINDS}
              taken={taken}
              register={register}
              value={kind}
            />
            <KindGroup
              label="Banks"
              kinds={BANK_KINDS}
              taken={taken}
              register={register}
              value={kind}
            />
            {taken.length > 0 ? (
              <p className="text-muted-foreground text-[12px] leading-relaxed">
                One account for each type. To change one you have, replace it.
              </p>
            ) : null}
          </fieldset>
        )}

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
          {replacing ? "Replace account" : "Add payment method"}
        </Button>
      </form>
    </Sheet>
  );
}

/** One row of the picker: every wallet, or every bank, as radio chips with their bars. */
function KindGroup({
  label,
  kinds,
  taken,
  register,
  value,
}: {
  label: string;
  kinds: readonly PaymentMethodKind[];
  /** The types that have an account already: shown, and not to be picked. */
  taken: readonly PaymentMethodKind[];
  register: ReturnType<typeof useForm<Form>>["register"];
  value: PaymentMethodKind;
}) {
  return (
    <div className="mb-3">
      <p className="text-muted-foreground mb-1.5 text-[12px] font-medium">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        {kinds.map((kind) => {
          const added = taken.includes(kind);
          return (
            <label
              key={kind}
              className={cn(
                "rounded-control flex h-11 items-center gap-2 border px-3 text-[13px] font-medium transition-colors duration-150",
                "has-focus-visible:outline-ring has-focus-visible:outline-2 has-focus-visible:outline-offset-2",
                value === kind
                  ? "border-primary bg-primary-soft text-primary-soft-foreground cursor-pointer"
                  : added
                    ? "border-border text-muted-foreground cursor-not-allowed opacity-60"
                    : "border-border text-foreground hover:border-primary/40 cursor-pointer",
              )}
            >
              <input
                type="radio"
                value={kind}
                disabled={added}
                {...register("kind")}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn("h-3.5 w-0.5 rounded-full", PAYMENT_KINDS[kind].bar)}
              />
              <span className="truncate">{PAYMENT_KINDS[kind].label}</span>
              {added ? (
                <span className="ml-auto shrink-0 text-[11px] font-normal">Added</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}
