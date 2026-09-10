"use client";

import { ArrowLeft, Info, Lock } from "@phosphor-icons/react";
import { useSyncExternalStore, type ReactNode } from "react";

import { AppLink } from "@/components/ui/app-link";
import { Input } from "@/components/ui/field";
import { Radio, RadioGroup } from "@/components/ui/radio";
import {
  getServerBalanceHidden,
  MASKED_AMOUNT,
  readBalanceHidden,
  subscribeBalanceHidden,
} from "@/lib/balance-visibility";
import { cn } from "@/lib/cn";
import { ASSET, NETWORKS, formatAmount, networkLabel, type NetworkId } from "@/lib/wallet";

/* The pieces the three wallet screens share. */

/** Whether figures are masked right now. One preference across the whole app. */
export function useBalanceHidden(): boolean {
  return useSyncExternalStore(subscribeBalanceHidden, readBalanceHidden, getServerBalanceHidden);
}

/** Masked or not, in one place, so no screen forgets. */
export function Amount({
  value,
  className,
  unit = ASSET.symbol,
}: {
  value: number;
  className?: string | undefined;
  unit?: string | null;
}) {
  const hidden = useBalanceHidden();
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn("tabular-nums", hidden && "tracking-widest", className)}>
        {hidden ? MASKED_AMOUNT : formatAmount(value)}
      </span>
      {unit ? <span className="text-muted-foreground text-[13px] font-medium">{unit}</span> : null}
    </span>
  );
}

/** The way back from a wallet sub-page, above its heading. */
export function BackLink({ children = "Wallet" }: { children?: ReactNode }) {
  return (
    <AppLink
      href="/wallet"
      className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium transition-colors duration-150"
    >
      <ArrowLeft size={15} weight="bold" aria-hidden="true" />
      {children}
    </AppLink>
  );
}

/*
  Said once on every wallet screen, plainly. Nothing here can move money: the
  ledger arrives in Phase 2 and custody in Phase 6. A wallet that looks
  operational before it is would be the one screen in this app where being
  vague could cost somebody real money.
*/
export function NotOpenNotice({ what }: { what: string }) {
  return (
    <div
      role="note"
      className="rounded-surface border-border bg-muted text-muted-foreground mb-5 flex items-start gap-3 border px-4 py-3.5 text-[13px] leading-relaxed"
    >
      <Lock size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
      <p>
        <span className="text-foreground font-medium">{what} are not open yet.</span> This screen is
        the finished layout, waiting on custody. Nothing on it can move funds, and no address here
        is real.
      </p>
    </div>
  );
}

/** A quiet aside inside a panel: a rule, a limit, a thing worth knowing. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground rounded-control bg-muted flex items-start gap-2.5 px-3.5 py-3 text-[12px] leading-relaxed">
      <Info size={15} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** One line of a summary: label left, value right, aligned down the column. */
export function SummaryRow({
  label,
  children,
  strong,
}: {
  label: string;
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground shrink-0 text-[13px]">{label}</dt>
      <dd
        className={cn(
          "text-right text-[13px] tabular-nums",
          strong ? "text-foreground text-[15px] font-semibold" : "text-foreground",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/*
  The network, chosen the way every exchange this audience uses presents it:
  the chain and its token standard together, the arrival time beside it, and
  the ones we do not accept visibly refused rather than quietly missing.
*/
export function NetworkPicker({
  value,
  onChange,
  purpose,
}: {
  value: NetworkId;
  onChange: (id: NetworkId) => void;
  purpose: "deposit" | "withdrawal";
}) {
  return (
    <RadioGroup
      legend="Network"
      hint={
        purpose === "deposit"
          ? "Must match the network you are sending from. Sending on any other network loses the funds permanently."
          : "The network the funds arrive on. Check that the receiving wallet supports it."
      }
    >
      {NETWORKS.map((network) => (
        <Radio
          key={network.id}
          name="network"
          value={network.id}
          checked={value === network.id}
          disabled={!network.supported}
          onChange={() => onChange(network.id)}
          label={networkLabel(network)}
          description={
            network.supported
              ? purpose === "deposit"
                ? `Arrives in ${network.arrival.toLowerCase()}, after ${network.confirmations} confirmation${network.confirmations === 1 ? "" : "s"}.`
                : `Minimum ${formatAmount(network.minDeposit)} ${ASSET.symbol}.`
              : "Not supported yet."
          }
          meta={
            network.supported ? (
              purpose === "deposit" ? (
                network.arrival
              ) : network.withdrawalFee === 0 ? (
                "No network fee"
              ) : (
                `${formatAmount(network.withdrawalFee)} ${ASSET.symbol} fee`
              )
            ) : (
              <span className="bg-status-neutral text-status-neutral-fg rounded-full px-2 py-0.5 text-[12px] font-medium">
                Soon
              </span>
            )
          }
        />
      ))}
    </RadioGroup>
  );
}

/*
  An amount, with the asset pinned to the right of the field and a Max that
  fills in the whole available balance. Max matters more than it looks: it is
  the difference between someone withdrawing their balance and someone
  discovering they cannot because they typed one place too many.
*/
export function AmountField({
  value,
  onChange,
  available,
  id,
  describedBy,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  available: number;
  id?: string | undefined;
  describedBy?: string | undefined;
  invalid?: true | undefined;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="decimal"
        placeholder="0.00"
        autoComplete="off"
        className="pr-[7.5rem] font-medium tabular-nums"
      />
      <div className="absolute inset-y-0 right-3.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(available > 0 ? available.toFixed(2) : "0")}
          className="text-primary hover:text-primary-hover text-[13px] font-semibold transition-colors duration-150"
        >
          Max
        </button>
        <span aria-hidden="true" className="bg-border h-4 w-px" />
        <span className="text-muted-foreground text-[13px] font-medium">{ASSET.symbol}</span>
      </div>
    </div>
  );
}
