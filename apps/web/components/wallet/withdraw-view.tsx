"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowsClockwise, Tray, Warning } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { LoadFailed } from "@/components/app/load-failed";
import { EmptyState, PageHeader, Panel } from "@/components/app/panel";
import { FormError } from "@/components/auth/notices";
import { ActivityList, CancelWithdrawal, fromWithdrawal } from "@/components/wallet/activity";
import {
  AmountField,
  BackLink,
  CoinField,
  NetworkSelect,
  SummaryRow,
} from "@/components/wallet/shared";
import { Step, Steps } from "@/components/wallet/steps";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { Sheet } from "@/components/ui/sheet";
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
import { placeOnField, revealProblems } from "@/lib/reveal-problems";
import { toast, toastFailure } from "@/lib/toast";

/*
  Sending USDT out to a chain address.

  The order is the one an exchange uses and it is not arbitrary: the coin,
  where it is going - address, then the network that has to agree with
  wherever that address came from - then the amount, quoted against limits the
  server owns. What they will receive, and the fee, sit beside the button;
  on a phone the two are pinned above the tab bar, like Buy and Pay.

  Then a confirmation, Binance's way, before anything leaves: the address in
  groups of four to check against the other wallet, the figures, the warning,
  and the password last - because it is the act of consent, not a field to
  fill in on the way past. The password is asked for every time. A session
  cookie alone must not be able to send money off the platform, and this is
  the control that costs a thief with a stolen cookie the most (ADR-0010,
  state-machines.md 2).
*/

/** An address in groups of four, the way it is checked against another screen. */
const inFours = (address: string): string => address.match(/.{1,4}/g)?.join(" ") ?? address;

export function WithdrawView() {
  const [networkId, setNetworkId] = useState<NetworkId>(DEFAULT_NETWORK);
  const [limits, setLimits] = useState<WithdrawalLimits | null>(null);
  // Without the limits the button cannot be pressed: say why, and offer to ask again.
  const [limitsProblem, setLimitsProblem] = useState<string | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);
  const [confirmElement, setConfirmElement] = useState<HTMLFormElement | null>(null);
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
    trigger,
    reset,
    resetField,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<WithdrawForm>({
    resolver: zodResolver(withdrawForm),
    defaultValues: { address: "", amount: "", password: "" },
    shouldFocusError: false,
  });

  const refresh = useCallback(() => {
    void walletClient.limits().then((result) => {
      if (result.ok) {
        setLimits(result.limits);
        setLimitsProblem(null);
      } else {
        setLimitsProblem(result.message);
      }
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
  const destination = useWatch({ control, name: "address" }) ?? "";
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

  /** The first press: where and how much are checked, and the confirmation opens. Nothing is sent. */
  const review = async () => {
    setError(null);
    const sound = await trigger(["address", "amount"]);
    if (!sound || blocked || !toMicro(typed)) {
      revealProblems(formElement);
      return;
    }
    resetField("password");
    setConfirming(true);
  };

  const confirm = handleSubmit(
    async (values) => {
      setError(null);
      const amount = toMicro(values.amount);
      if (!amount || blocked) {
        setConfirming(false);
        revealProblems(formElement);
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
        setConfirming(false);
        toast.success("Withdrawal requested", {
          description: `${formatMicro(result.withdrawal.amount)} ${ASSET.symbol} is on its way. Follow it under Recent withdrawals.`,
        });
        reset({ address: "", amount: "", password: "" });
        refresh();
        return;
      }
      // Only a failure we cannot interpret keeps the key: the server never
      // answered, so the same key must go out again rather than a new one.
      if (result.code !== "NETWORK") setIntentKey(null);
      // The password is in the confirmation; the address and the amount are on the page under it.
      if (placeOnField(result, { password: "password" }, setFieldError, confirmElement)) return;
      const fields = { destination: "address", amount: "amount" } as const;
      if (placeOnField(result, fields, setFieldError, formElement)) {
        setConfirming(false);
        return;
      }
      setError(result.message);
      toastFailure(result);
    },
    () => revealProblems(confirmElement),
  );

  const unready = limits === null || blocked !== null;

  return (
    <>
      <BackLink />
      <PageHeader
        title={`Withdraw ${ASSET.symbol}`}
        description="Send to a wallet or an exchange on a supported network."
      />

      <form
        ref={setFormElement}
        onSubmit={(event) => {
          event.preventDefault();
          void review();
        }}
        noValidate
        className="flex flex-col gap-4 lg:grid lg:grid-cols-5 lg:grid-rows-[auto_1fr] lg:items-start lg:gap-6"
      >
        <Panel className="lg:col-span-3 lg:row-span-2">
          <Steps label="How to withdraw">
            <Step n={1} title="Coin" done>
              <CoinField />
            </Step>

            <Step n={2} title="Send to">
              <div className="flex flex-col gap-4">
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
                <div>
                  <NetworkSelect value={networkId} onChange={setNetworkId} label="Network" />
                  <p className="text-muted-foreground mt-2 text-[13px] leading-relaxed">
                    Must match the wallet at the other end.
                  </p>
                </div>
              </div>
            </Step>

            <Step n={3} title="Amount" last>
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
            </Step>
          </Steps>

          {limitsProblem && !limits ? (
            <LoadFailed message={limitsProblem} onRetry={refresh} className="py-4" />
          ) : null}
          {confirming ? null : <FormError message={error} />}

          {/* What they will get, beside the button: in the panel on a desk, pinned above the tab bar on a phone. */}
          <div className="max-lg:border-border max-lg:bg-surface max-lg:above-tab-bar lg:border-border flex items-center justify-between gap-4 max-lg:fixed max-lg:inset-x-0 max-lg:z-30 max-lg:border-t max-lg:px-4 max-lg:py-3 lg:mt-6 lg:border-t lg:pt-5">
            <div className="min-w-0">
              <p className="text-muted-foreground text-[12px]">They receive</p>
              <p className="flex items-baseline gap-1.5">
                <span className="text-foreground font-mono text-lg font-medium tabular-nums lg:text-[1.625rem]">
                  {micro === "0" ? "—" : formatMicro(receives)}
                </span>
                <span className="text-muted-foreground text-[12px] font-medium">
                  {ASSET.symbol}
                </span>
              </p>
              <p className="text-muted-foreground text-[12px] tabular-nums max-lg:hidden">
                Network fee {fee === "0" ? "none" : `${formatMicro(fee)} ${ASSET.symbol}`}
              </p>
            </div>
            <Button type="submit" size="lg" disabled={unready} className="min-w-36 lg:min-w-48">
              Withdraw
            </Button>
          </div>
          <p className="text-muted-foreground mt-3 text-[12px] tabular-nums lg:hidden">
            Network fee {fee === "0" ? "none" : `${formatMicro(fee)} ${ASSET.symbol}`}. BIRQ charges
            nothing to withdraw.
          </p>
        </Panel>

        <Panel title="Before you send" className="lg:col-span-2">
          <Irreversible />
          <p className="text-muted-foreground mt-3 text-[13px] leading-relaxed">
            BIRQ charges nothing to withdraw. A large or unusual withdrawal may be held for a person
            to look at before it is sent; your money is held, not spent, while that happens.
          </p>
        </Panel>

        <Panel title="Your limits" className="lg:col-span-2">
          <dl className="divide-border -my-1 divide-y">
            <SummaryRow label="Smallest withdrawal">
              {limits ? `${formatMicro(limits.minimum)} ${ASSET.symbol}` : "—"}
            </SummaryRow>
            <SummaryRow label="Largest withdrawal">
              {limits ? `${formatMicro(limits.maximum)} ${ASSET.symbol}` : "—"}
            </SummaryRow>
            <SummaryRow label="Left today">
              {limits
                ? `${formatMicro(limits.dailyRemaining)} of ${formatMicro(limits.dailyMaximum)} ${ASSET.symbol}`
                : "—"}
            </SummaryRow>
          </dl>
        </Panel>
      </form>

      <Panel
        title="Recent withdrawals"
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
            label="Recent withdrawals"
            items={withdrawals.map((withdrawal) =>
              fromWithdrawal(
                withdrawal,
                withdrawal.cancellable ? (
                  <CancelWithdrawal id={withdrawal.id} onCancelled={refresh} />
                ) : undefined,
              ),
            )}
          />
        )}
      </Panel>

      {/* Room for the bar pinned above the tab bar on a phone. */}
      <div aria-hidden="true" className="h-24 lg:hidden" />

      <Sheet
        open={confirming}
        title="Confirm withdrawal"
        closeLabel="Close"
        desktop="panel"
        // It opens at the top, on where the money is going: the password is the last thing, and on
        // a phone a keyboard opening over the address would hide the one thing there is to check.
        initialFocus="[data-confirm-start]"
        onClose={() => {
          if (!isSubmitting) setConfirming(false);
        }}
        className="px-5 sm:px-6 sm:pb-6"
      >
        <form
          ref={setConfirmElement}
          noValidate
          onSubmit={(event) => {
            // Its own form, inside the page's: the page's must not hear this as another first press.
            event.stopPropagation();
            void confirm(event);
          }}
          className="flex flex-col gap-4"
        >
          <div
            tabIndex={-1}
            data-confirm-start
            className="rounded-control bg-muted px-3.5 py-3 focus:outline-none"
          >
            <p className="text-muted-foreground text-[12px]">Sending to</p>
            <p className="text-foreground mt-0.5 font-mono text-sm leading-relaxed break-words">
              {inFours(destination.trim())}
            </p>
            <p className="text-muted-foreground mt-1.5 text-[12px] leading-relaxed">
              Check the first and last four characters against the wallet you are sending to.
            </p>
          </div>

          <dl className="divide-border border-border divide-y border-y">
            <SummaryRow label="Network">{networkLabel(network)}</SummaryRow>
            {/* Never masked: this is the confirmation of what is about to leave. */}
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

          <Irreversible />
          <FormError message={error} />

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

          {/* On a phone the button stays in sight while the rest scrolls under it, like every other one that commits. */}
          <div className="max-sm:border-border max-sm:bg-surface max-sm:sticky max-sm:bottom-0 max-sm:-mx-5 max-sm:border-t max-sm:px-5 max-sm:pt-3 max-sm:pb-5">
            <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
              {isSubmitting ? "Sending…" : "Confirm and withdraw"}
            </Button>
          </div>
        </form>
      </Sheet>
    </>
  );
}

/** The one thing to read before sending: said on the page, and again where the password is. */
function Irreversible() {
  return (
    <div
      role="note"
      className="rounded-control border-destructive/30 bg-status-attention text-status-attention-fg flex items-start gap-2.5 border px-3.5 py-3 text-[13px] leading-relaxed"
    >
      <Warning size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
      <p>
        A sent transaction cannot be reversed, by us or by anyone. Check the address and the network
        against the wallet you are sending to.
      </p>
    </div>
  );
}
