"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CreditCard } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { EmptyState, PageHeader, Panel } from "@/components/app/panel";
import { FormError } from "@/components/auth/notices";
import { BackTo, ConfirmButton, ListNotice } from "@/components/market/bits";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Note } from "@/components/wallet/shared";
import { cn } from "@/lib/cn";
import { marketClient, type PaymentMethod, type PaymentMethodKind } from "@/lib/market/client";
import { BANKS, PAYMENT_KINDS, PAYMENT_KIND_LIST } from "@/lib/market/labels";

/*
  Where a seller is paid. A payment method is the account a buyer will be
  told to send birr to, so the rules here are the rules a buyer needs to be
  able to trust: the name on it is the name on the account, the number is
  checked to the digit before it is stored, and a method that is wrong is
  archived and replaced rather than edited - the trades that showed the old
  details still say what they said.
*/

const ethiopianPhone = z
  .string()
  .trim()
  .regex(/^(\+?251|0)?[79]\d{8}$/, { error: "Enter an Ethiopian mobile number, like 0912345678." });

const formSchema = z
  .object({
    kind: z.enum(["TELEBIRR", "CBE_BIRR", "MPESA", "BANK_TRANSFER"]),
    accountHolder: z
      .string()
      .trim()
      .min(2, { error: "Enter the name on the account." })
      .max(120, { error: "That name is too long." }),
    phone: z.string(),
    bankCode: z.string(),
    accountNumber: z.string().trim(),
    branch: z.string().trim().max(120, { error: "That is too long." }),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "BANK_TRANSFER") {
      if (!value.bankCode) {
        ctx.addIssue({ code: "custom", path: ["bankCode"], message: "Choose the bank." });
      }
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

export function PaymentMethods() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

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
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      kind: "TELEBIRR",
      accountHolder: "",
      phone: "",
      bankCode: "",
      accountNumber: "",
      branch: "",
    },
  });
  const kind = useWatch({ control, name: "kind" });

  const submit = handleSubmit(async (values) => {
    setError(null);
    setSaved(null);
    const result = await marketClient.addPaymentMethod(
      values.kind === "BANK_TRANSFER"
        ? {
            kind: "BANK_TRANSFER",
            accountHolder: values.accountHolder,
            bankCode: values.bankCode,
            accountNumber: values.accountNumber,
            ...(values.branch ? { branch: values.branch } : {}),
          }
        : { kind: values.kind, accountHolder: values.accountHolder, phone: values.phone },
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaved(result.paymentMethod.label);
    reset();
    refresh();
  });

  const archive = async (method: PaymentMethod) => {
    setError(null);
    const result = await marketClient.archivePaymentMethod(method.id);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    refresh();
  };

  const active = state.status === "ready" ? state.methods.filter((m) => m.status === "ACTIVE") : [];

  return (
    <>
      <BackTo href="/trade">Marketplace</BackTo>
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
                <li key={method.id} className="flex items-center justify-between gap-4 py-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={cn("h-8 w-1 shrink-0 rounded-full", PAYMENT_KINDS[method.kind].bar)}
                    />
                    <div className="min-w-0">
                      <p className="text-foreground truncate text-[15px] font-medium">{method.label}</p>
                      <p className="text-muted-foreground text-[12px]">
                        {PAYMENT_KINDS[method.kind].label}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusPill status="complete">Active</StatusPill>
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
          {saved ? (
            <p role="status" className="text-status-complete-fg mb-4 text-[13px] font-medium">
              Added {saved}.
            </p>
          ) : null}
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <Field label="Type" error={errors.kind?.message}>
              {(control) => (
                <Select {...control} {...register("kind")}>
                  {PAYMENT_KIND_LIST.map((value) => (
                    <option key={value} value={value}>
                      {PAYMENT_KINDS[value].label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="Name on the account"
              hint="Must be your own name. A payment from a different name is grounds for a dispute."
              error={errors.accountHolder?.message}
            >
              {(control) => (
                <Input {...control} {...register("accountHolder")} autoComplete="name" placeholder="Abebe Bikila" />
              )}
            </Field>

            {kind === "BANK_TRANSFER" ? (
              <>
                <Field label="Bank" error={errors.bankCode?.message}>
                  {(control) => (
                    <Select {...control} {...register("bankCode")}>
                      <option value="">Choose a bank</option>
                      {BANKS.map((bank) => (
                        <option key={bank.code} value={bank.code}>
                          {bank.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Account number" error={errors.accountNumber?.message}>
                  {(control) => (
                    <Input {...control} {...register("accountNumber")} inputMode="numeric" autoComplete="off" />
                  )}
                </Field>
                <Field label="Branch" hint="Optional." error={errors.branch?.message}>
                  {(control) => <Input {...control} {...register("branch")} autoComplete="off" />}
                </Field>
              </>
            ) : (
              <Field
                label={PAYMENT_KINDS[kind as PaymentMethodKind].numberLabel}
                error={errors.phone?.message}
              >
                {(control) => (
                  <Input {...control} {...register("phone")} inputMode="tel" autoComplete="tel" placeholder="0912345678" />
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
