"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Warning } from "@phosphor-icons/react";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { PageHeader, Panel } from "@/components/app/panel";
import { FormError } from "@/components/auth/notices";
import {
  AmountField,
  Amount,
  BackLink,
  NetworkPicker,
  Note,
  NotOpenNotice,
  SummaryRow,
} from "@/components/wallet/shared";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  ASSET,
  DEFAULT_NETWORK,
  formatAmount,
  networkById,
  networkLabel,
  withdrawForm,
  type WithdrawForm,
} from "@/lib/wallet";

/*
  Sending USDT out to a chain address.

  The order is the one an exchange uses and it is not arbitrary: address,
  then network, then amount. The address is what a person pastes from
  somewhere else and is the thing most worth checking twice; the network has
  to agree with wherever that address came from; and the amount is last
  because the fee it is quoted against depends on the network above it.

  The fee and the arrival figures are placeholders until custody is chosen
  (see lib/wallet.ts).
*/

const AVAILABLE = 0;

export function WithdrawView() {
  const [networkId, setNetworkId] = useState(DEFAULT_NETWORK);
  const [notice, setNotice] = useState<string | null>(null);
  const network = networkById(networkId);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<WithdrawForm>({
    resolver: zodResolver(withdrawForm),
    defaultValues: { address: "", amount: "" },
  });

  // useWatch rather than watch(): the function watch() returns cannot be
  // memoized, so the React Compiler gives up on the whole component.
  const typed = Number(useWatch({ control, name: "amount" }) || 0);
  const receives = Math.max(0, typed - network.withdrawalFee);

  return (
    <>
      <BackLink />
      <PageHeader
        title={`Withdraw ${ASSET.symbol}`}
        description="Send to a wallet or an exchange on a supported network."
      />

      <NotOpenNotice what="Withdrawals" />

      <form
        onSubmit={handleSubmit(() =>
          setNotice(
            "Withdrawals open once custody is connected. Everything you entered is valid; there is simply nothing behind the button yet.",
          ),
        )}
        noValidate
        className="grid gap-4 lg:grid-cols-3 lg:gap-6"
      >
        <div className="flex flex-col gap-4 lg:col-span-2 lg:gap-6">
          <Panel title="Destination">
            <Field
              label="Address"
              error={errors.address?.message}
              hint="Paste it from the wallet or exchange you are sending to. Never type it by hand."
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  {...register("address")}
                  placeholder={`Recipient ${ASSET.symbol} address`}
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono text-[13px]"
                />
              )}
            </Field>
          </Panel>

          <Panel>
            <NetworkPicker value={networkId} onChange={setNetworkId} purpose="withdrawal" />
          </Panel>

          <Panel title="Amount">
            <Field
              label={`How much ${ASSET.symbol}`}
              error={errors.amount?.message}
              hint={`Available: ${formatAmount(AVAILABLE)} ${ASSET.symbol}`}
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
                      available={AVAILABLE}
                    />
                  )}
                />
              )}
            </Field>
          </Panel>
        </div>

        <div className="flex flex-col gap-4 lg:gap-6">
          <Panel title="Summary">
            <FormError message={notice} />

            <dl className="divide-border divide-y">
              <SummaryRow label="Network">{networkLabel(network)}</SummaryRow>
              <SummaryRow label="Amount">
                <Amount value={typed} />
              </SummaryRow>
              <SummaryRow label="Network fee">
                {network.withdrawalFee === 0
                  ? "None"
                  : `${formatAmount(network.withdrawalFee)} ${ASSET.symbol}`}
              </SummaryRow>
              <SummaryRow label="They receive" strong>
                <Amount value={receives} />
              </SummaryRow>
            </dl>

            <div
              role="note"
              className="rounded-control border-destructive/30 bg-status-attention text-status-attention-fg mt-4 flex items-start gap-2.5 border px-3.5 py-3 text-[13px] leading-relaxed"
            >
              <Warning size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
              <p>
                A sent transaction cannot be reversed, by us or by anyone. Check the address and the
                network against the wallet you are sending to.
              </p>
            </div>

            <Button type="submit" size="lg" className="mt-5 w-full">
              Withdraw
            </Button>

            <p className="text-muted-foreground mt-3 text-[12px] leading-relaxed">
              BIRQ charges nothing to withdraw. The network or a third party may charge a fee.
            </p>
          </Panel>

          <Panel title="Sending to another BIRQ account?">
            <Note>
              Use Transfer instead. It moves between accounts by BIRQ ID, arrives instantly, never
              touches a chain, and costs nothing.
            </Note>
          </Panel>
        </div>
      </form>
    </>
  );
}
