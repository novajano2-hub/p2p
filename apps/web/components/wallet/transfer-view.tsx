"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Lightning } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { PageHeader, Panel } from "@/components/app/panel";
import { FormError } from "@/components/auth/notices";
import { useSession } from "@/components/app/session-provider";
import {
  AmountField,
  Amount,
  BackLink,
  Note,
  NotOpenNotice,
  SummaryRow,
} from "@/components/wallet/shared";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { formatMicro, toMicro } from "@/lib/money";
import { ASSET, transferForm, type TransferForm } from "@/lib/wallet";
import { walletClient } from "@/lib/wallet/client";

/*
  Moving USDT to another BIRQ account by its ID.

  This never touches a chain: both balances are ours, so it is a single
  ledger entry rather than a transaction, which is what makes it instant and
  free. The screen says that plainly, because someone who has only ever sent
  crypto on-chain will otherwise assume a fee and a wait.

  The recipient is a BIRQ ID rather than an email address on purpose. An ID
  is public, it is the thing already shown at the top of the account page,
  and it does not tell the sender anything about the person behind it.
*/

export function TransferView() {
  const { user } = useSession();
  const [notice, setNotice] = useState<string | null>(null);
  /*
    The balance is real even though the button is not. The figure beside an
    amount field is a statement about somebody's money, and there is no
    version of showing a wrong one that is better than showing none.
  */
  const [available, setAvailable] = useState("0");

  useEffect(() => {
    let live = true;
    void walletClient.balance().then((result) => {
      if (live && result.ok) setAvailable(result.balance.available);
    });
    return () => {
      live = false;
    };
  }, []);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<TransferForm>({
    resolver: zodResolver(transferForm),
    defaultValues: { recipient: "", amount: "", note: "" },
  });

  // useWatch rather than watch(): the function watch() returns cannot be
  // memoized, so the React Compiler gives up on the whole component.
  const typed = toMicro(useWatch({ control, name: "amount" }) ?? "") ?? "0";

  return (
    <>
      <BackLink />
      <PageHeader
        title="Transfer"
        description={`Send ${ASSET.symbol} to another BIRQ account, instantly and free.`}
      />

      <NotOpenNotice what="Transfers" />

      <form
        onSubmit={handleSubmit((values) => {
          // The one rule this screen can enforce on its own, and the mistake
          // worth catching before a server round trip.
          if (values.recipient === user.platformId) {
            setError("recipient", { message: "That is your own BIRQ ID." });
            return;
          }
          setNotice(
            "Transfers open once the ledger is in place. Everything you entered is valid; there is simply nothing behind the button yet.",
          );
        })}
        noValidate
        className="grid gap-4 lg:grid-cols-3 lg:gap-6"
      >
        <div className="flex flex-col gap-4 lg:col-span-2 lg:gap-6">
          <Panel title="Who it goes to">
            <Field
              label="BIRQ ID"
              error={errors.recipient?.message}
              hint="The BQ- number on their account. Ask them for it; it is safe to share."
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  {...register("recipient")}
                  placeholder="BQ-12345678"
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="font-mono tracking-wide tabular-nums"
                />
              )}
            </Field>

            <p className="text-muted-foreground mt-4 text-[12px] leading-relaxed">
              Yours is <span className="text-foreground font-mono">{user.platformId}</span>. Give
              that to someone who wants to send to you.
            </p>
          </Panel>

          <Panel title="Amount">
            <Field
              label={`How much ${ASSET.symbol}`}
              error={errors.amount?.message}
              hint={`Available: ${formatMicro(available)} ${ASSET.symbol}`}
            >
              {(a11y) => (
                <Controller
                  control={control}
                  name="amount"
                  render={({ field }) => (
                    <AmountField
                      id={a11y.id}
                      describedBy={a11y["aria-describedby"]}
                      invalid={a11y["aria-invalid"]}
                      value={field.value}
                      onChange={field.onChange}
                      available={available}
                    />
                  )}
                />
              )}
            </Field>

            <Field
              label="Note (optional)"
              error={errors.note?.message}
              hint="Only the two of you see this. It is not sent anywhere else."
              className="mt-5"
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  {...register("note")}
                  placeholder="What this is for"
                  maxLength={140}
                />
              )}
            </Field>
          </Panel>
        </div>

        <div className="flex flex-col gap-4 lg:gap-6">
          <Panel title="Summary">
            <FormError message={notice} />

            <div className="rounded-control bg-primary-soft text-primary-soft-foreground mb-4 flex items-start gap-2.5 px-3.5 py-3 text-[13px] leading-relaxed">
              <Lightning size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
              <p>
                Instant and free. Both accounts are here, so nothing goes on-chain and no network
                fee applies.
              </p>
            </div>

            <dl className="divide-border divide-y">
              <SummaryRow label="Amount">
                <Amount value={typed} />
              </SummaryRow>
              <SummaryRow label="Fee">None</SummaryRow>
              <SummaryRow label="They receive" strong>
                <Amount value={typed} />
              </SummaryRow>
            </dl>

            <Button type="submit" size="lg" className="mt-5 w-full">
              Transfer
            </Button>

            <p className="text-muted-foreground mt-3 text-[12px] leading-relaxed">
              Check the ID before you send. A transfer to the wrong account is between you and
              whoever received it.
            </p>
          </Panel>

          <Panel title="Sending off BIRQ?">
            <Note>
              Use Withdraw for an address on a chain. It takes a network fee and a few
              confirmations, where this takes neither.
            </Note>
          </Panel>
        </div>
      </form>
    </>
  );
}
