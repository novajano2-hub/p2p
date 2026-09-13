"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowsClockwise, CheckCircle, Tray, Warning } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { EmptyState, PageHeader, Panel } from "@/components/app/panel";
import { FormError } from "@/components/auth/notices";
import { ActivityList, fromWithdrawal } from "@/components/wallet/activity";
import { AmountField, BackLink, NetworkPicker, Note, SummaryRow } from "@/components/wallet/shared";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { compareMicro, formatMicro, subMicro, toMicro } from "@/lib/money";
import { ASSET, DEFAULT_NETWORK, networkById, networkLabel, withdrawForm } from "@/lib/wallet";
import type { NetworkId, WithdrawForm } from "@/lib/wallet";
import {
  newIdempotencyKey,
  walletClient,
  type Withdrawal,
  type WithdrawalLimits,
} from "@/lib/wallet/client";
import { useInFlight } from "@/lib/wallet/use-in-flight";

/*
  Sending USDT out to a chain address.

  The order is the one an exchange uses and it is not arbitrary: address,
  then network, then amount, then the password. The address is what a person
  pastes from somewhere else and is the thing most worth checking twice; the
  network has to agree with wherever that address came from; the amount is
  quoted against limits the server owns; and the password is last because it
  is the act of consent, not a field to fill in on the way past.

  The password is asked for every time. A session cookie alone must not be
  able to send money off the platform, and this is the control that costs a
  thief with a stolen cookie the most (ADR-0010, state-machines.md 2).
*/

export function WithdrawView() {
  const [networkId, setNetworkId] = useState<NetworkId>(DEFAULT_NETWORK);
  const [limits, setLimits] = useState<WithdrawalLimits | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Withdrawal | null>(null);
  const network = networkById(networkId);

  /*
    One key per intent, not per attempt (ADR-0007). It is kept across a retry
    that failed for the network - the one case where we cannot know whether
    the request landed - and thrown away as soon as the server has answered,
    because by then the next press is a new intent.

    State rather than a ref: it only has to survive between renders, and a ref
    read inside a handler that is built during render is the thing the compiler
    rules rightly warn about.
  */
  const [intentKey, setIntentKey] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<WithdrawForm>({
    resolver: zodResolver(withdrawForm),
    defaultValues: { address: "", amount: "", password: "" },
  });

  const refresh = useCallback(() => {
    void walletClient.limits().then((result) => {
      if (result.ok) setLimits(result.limits);
    });
    void walletClient.withdrawals().then((result) => {
      if (result.ok) setWithdrawals(result.withdrawals);
    });
  }, []);
  useEffect(refresh, [refresh]);

  // Approval and settlement both happen elsewhere, so watch while one is in
  // the middle of happening.
  useInFlight(
    withdrawals.some((w) => w.stage === "PENDING" || w.stage === "HELD" || w.stage === "SENDING"),
    refresh,
  );

  // useWatch rather than watch(): the function watch() returns cannot be
  // memoized, so the React Compiler gives up on the whole component.
  const typed = useWatch({ control, name: "amount" }) ?? "";
  const micro = toMicro(typed) ?? "0";
  const fee = limits?.fee ?? "0";
  const receives = subMicro(micro, fee);
  const available = limits?.available ?? "0";

  /*
    The same refusals the server will make, said before the password is
    typed rather than after. The server is still the one that decides; this
    only saves somebody from entering a password to be told no.
  */
  const tooSmall = limits !== null && micro !== "0" && compareMicro(micro, limits.minimum) < 0;
  const tooLarge = limits !== null && compareMicro(micro, limits.maximum) > 0;
  const overBalance = limits !== null && compareMicro(micro, available) > 0;
  const overDaily = limits !== null && compareMicro(micro, limits.dailyRemaining) > 0;
  const blocked = tooSmall
    ? `The smallest withdrawal is ${formatMicro(limits.minimum)} ${ASSET.symbol}.`
    : tooLarge
      ? `The largest single withdrawal is ${formatMicro(limits.maximum)} ${ASSET.symbol}.`
      : overBalance
        ? "That is more than your available balance."
        : overDaily
          ? `That is more than you have left today (${formatMicro(limits!.dailyRemaining)} ${ASSET.symbol}).`
          : null;

  const submit = handleSubmit(async (values) => {
    setError(null);
    const amount = toMicro(values.amount);
    if (!amount || blocked) {
      setError(blocked ?? "Enter an amount.");
      return;
    }
    const key = intentKey ?? newIdempotencyKey();
    setIntentKey(key);
    const result = await walletClient.withdraw({
      network: networkId,
      amount,
      destination: values.address,
      password: values.password,
      idempotencyKey: key,
    });
    if (result.ok) {
      setIntentKey(null);
      setDone(result.withdrawal);
      reset({ address: "", amount: "", password: "" });
      refresh();
      return;
    }
    // Only a failure we cannot interpret keeps the key: the server never
    // answered, so the same key must go out again rather than a new one.
    if (result.code !== "NETWORK") setIntentKey(null);
    setError(result.message);
  });

  return (
    <>
      <BackLink />
      <PageHeader
        title={`Withdraw ${ASSET.symbol}`}
        description="Send to a wallet or an exchange on a supported network."
      />

      {done ? (
        <div
          role="status"
          className="rounded-surface bg-status-complete text-status-complete-fg mb-5 flex items-start gap-2.5 px-4 py-3.5 text-[13px] leading-relaxed"
        >
          <CheckCircle size={17} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
          <p>
            <span className="font-semibold">
              {formatMicro(done.amount)} {ASSET.symbol} is on its way.
            </span>{" "}
            It is listed below, and the status there is the one to watch.
          </p>
        </div>
      ) : null}

      <form onSubmit={submit} noValidate className="grid gap-4 lg:grid-cols-3 lg:gap-6">
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
            <NetworkPicker
              value={networkId}
              onChange={setNetworkId}
              detail={
                limits
                  ? `Minimum ${formatMicro(limits.minimum)}, maximum ${formatMicro(limits.maximum)} ${ASSET.symbol}.`
                  : "Loading…"
              }
            />
          </Panel>

          <Panel title="Amount">
            <Field
              label={`How much ${ASSET.symbol}`}
              error={errors.amount?.message ?? blocked ?? undefined}
              hint={
                limits
                  ? `Available: ${formatMicro(available)} ${ASSET.symbol}. Left today: ${formatMicro(limits.dailyRemaining)}.`
                  : "Loading your balance…"
              }
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
          </Panel>
        </div>

        <div className="flex flex-col gap-4 lg:gap-6">
          <Panel title="Summary">
            <FormError message={error} />

            <dl className="divide-border divide-y">
              <SummaryRow label="Network">{networkLabel(network)}</SummaryRow>
              {/* Never masked: this is the confirmation of what is about to
                  leave, and the figure is already in the field above. */}
              <SummaryRow label="Amount">
                {formatMicro(micro)} {ASSET.symbol}
              </SummaryRow>
              <SummaryRow label="Network fee">
                {fee === "0" ? "None" : `${formatMicro(fee)} ${ASSET.symbol}`}
              </SummaryRow>
              <SummaryRow label="They receive" strong>
                {formatMicro(receives)} {ASSET.symbol}
              </SummaryRow>
            </dl>

            <div className="mt-4">
              <Field
                label="Your password"
                error={errors.password?.message}
                hint="Asked every time. A signed-in tab alone cannot send money."
              >
                {(a11y) => (
                  <PasswordInput
                    {...a11y}
                    {...register("password")}
                    autoComplete="current-password"
                    placeholder="Confirm it is you"
                  />
                )}
              </Field>
            </div>

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

            <Button
              type="submit"
              size="lg"
              loading={isSubmitting}
              disabled={limits === null || blocked !== null}
              className="mt-5 w-full"
            >
              {isSubmitting ? "Sending…" : "Withdraw"}
            </Button>

            <p className="text-muted-foreground mt-3 text-[12px] leading-relaxed">
              BIRQ charges nothing to withdraw. A large or unusual withdrawal may be held for a
              person to look at before it is sent; your money is held, not spent, while that
              happens.
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

      <Panel
        title="Your withdrawals"
        className="mt-4 lg:mt-6"
        action={
          <button
            type="button"
            onClick={refresh}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 font-medium transition-colors duration-150"
          >
            <ArrowsClockwise size={14} weight="bold" aria-hidden="true" />
            Refresh
          </button>
        }
      >
        {withdrawals.length === 0 ? (
          <EmptyState
            icon={Tray}
            title="Nothing yet"
            description="Withdrawals appear here from the moment you request one, with where each has got to."
          />
        ) : (
          <ActivityList
            items={withdrawals.map((withdrawal) =>
              fromWithdrawal(
                withdrawal,
                withdrawal.cancellable ? (
                  <CancelButton id={withdrawal.id} onCancelled={refresh} />
                ) : undefined,
              ),
            )}
          />
        )}
      </Panel>
    </>
  );
}

/** Calling one off while nothing has been done to it yet. The hold is released. */
function CancelButton({ id, onCancelled }: { id: string; onCancelled: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(null);
          const result = await walletClient.cancel(id);
          setBusy(false);
          if (result.ok) onCancelled();
          else setFailed(result.message);
        }}
      >
        {busy ? "Cancelling…" : "Cancel"}
      </Button>
      {failed ? (
        <p role="alert" className="text-destructive mt-1.5 text-[12px]">
          {failed}
        </p>
      ) : null}
    </>
  );
}
