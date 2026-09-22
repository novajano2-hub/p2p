"use client";

import { ArrowLeft, Info, Lock } from "@phosphor-icons/react";
import { useSyncExternalStore, type ReactNode } from "react";

import { AppLink } from "@/components/ui/app-link";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import {
  getServerBalanceHidden,
  MASKED_AMOUNT,
  readBalanceHidden,
  subscribeBalanceHidden,
} from "@/lib/balance-visibility";
import { cn } from "@/lib/cn";
import { formatMicro, plainMicro } from "@/lib/money";
import { ASSET, NETWORKS, networkLabel, type NetworkId } from "@/lib/wallet";

/* The pieces the wallet screens share. */

/** Whether figures are masked right now. One preference across the whole app. */
export function useBalanceHidden(): boolean {
  return useSyncExternalStore(subscribeBalanceHidden, readBalanceHidden, getServerBalanceHidden);
}

/**
 * An amount, masked or not, in one place so no screen forgets.
 *
 * `value` is an integer string of millionths, exactly as the API sent it,
 * shown to two places like every USDT figure a person reads here (lib/money.ts);
 * the ledger keeps all six.
 */
export function Amount({
  value,
  className,
  unit = ASSET.symbol,
}: {
  value: string;
  className?: string | undefined;
  unit?: string | null;
}) {
  const hidden = useBalanceHidden();
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn("tabular-nums", hidden && "tracking-widest", className)}>
        {hidden ? MASKED_AMOUNT : formatMicro(value)}
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
  Still said on the one screen it is still true of. Transfers between BIRQ
  accounts move a ledger balance from one customer to another, and that is a
  Phase 4 conversation with trades; deposits and withdrawals are real now and
  no longer carry this.
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
        the finished layout. Nothing on it can move funds.
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
  The coin, as the first step of moving it. There is one, so this is a
  statement and not a choice: drawn like the field a choice would be, so the
  steps read the way they do on every exchange, and not pretending to open.
*/
export function CoinField() {
  return (
    <div className="rounded-control border-border bg-surface flex h-12 items-center gap-2.5 border px-3.5">
      <span
        aria-hidden="true"
        className="bg-status-complete text-status-complete-fg flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
      >
        ₮
      </span>
      <span className="text-foreground text-[15px] font-semibold">{ASSET.symbol}</span>
      <span className="text-muted-foreground text-[13px]">{ASSET.name}</span>
    </div>
  );
}

/*
  The network, chosen the way every exchange this audience uses presents it:
  the chain and its token standard together, how long it takes beside it, and
  the ones we do not accept yet visibly refused rather than quietly missing.
  It is the app's one select, so on a phone it is the shared sheet.
*/
const NETWORK_OPTIONS = NETWORKS.map((network) => ({
  value: network.id,
  label: networkLabel(network),
  description: network.supported ? network.arrival : "Not supported yet",
  disabled: !network.supported,
}));

export function NetworkSelect({
  value,
  onChange,
  label,
}: {
  value: NetworkId;
  onChange: (id: NetworkId) => void;
  /** A label of its own, where the step's title is not already it. */
  label?: string | undefined;
}) {
  const select = (a11y: { id?: string; "aria-describedby"?: string | undefined }) => (
    <Select
      {...a11y}
      {...(label ? {} : { "aria-label": "Network" })}
      title="Network"
      value={value}
      onChange={(id) => onChange(id as NetworkId)}
      options={NETWORK_OPTIONS}
    />
  );
  return label ? <Field label={label}>{select}</Field> : select({});
}

/*
  An amount, with the asset pinned to the right of the field and a Max that
  fills in the whole spendable balance. Max matters more than it looks: it is
  the difference between someone withdrawing their balance and someone
  discovering they cannot because they typed one place too many.

  `available` is millionths, and Max writes back the exact figure rather than
  a rounded one - a Max that under-fills strands the remainder, and one that
  over-fills is refused by the server after the password has been typed.
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
  available: string;
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
          onClick={() => onChange(plainMicro(available))}
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
