"use client";

import { ArrowLineDown, ArrowLineUp, ArrowsLeftRight, Eye, EyeSlash } from "@phosphor-icons/react";

import { LoadFailed } from "@/components/app/load-failed";
import { useBalanceHidden } from "@/components/wallet/shared";
import { buttonClasses, ButtonLink } from "@/components/ui/button";
import { walletRoutes } from "@/lib/app-nav";
import { MASKED_AMOUNT, setBalanceHidden } from "@/lib/balance-visibility";
import { cn } from "@/lib/cn";
import { formatMicro } from "@/lib/money";
import { ASSET } from "@/lib/wallet";
import { type WalletBalance } from "@/lib/wallet/client";

/*
  The balance, once, for Home and for the Wallet: the same card in both, so
  the figure a person sees on one screen is laid out the way they learnt it on
  the other.

  Three figures under the total, because "how much do I have" has three
  answers and a person acting on the wrong one is a person surprised. All of
  them come from the ledger on every load; there is no cached balance column
  anywhere in this system, on purpose.

  No estimated ETB value. There is no price feed, and a figure beside
  somebody's balance that is quietly wrong is worse than no figure at all.

  A balance that did not load is a dash and a way to ask again, never a zero:
  a figure beside somebody's money is a statement about it, and "you have
  nothing" is a worse one than none.

  The eye masks every figure at once and remembers the choice
  (lib/balance-visibility.ts), the way an exchange app does before a
  screen-share or handing the phone to someone else.
*/

const PARTS = [
  { key: "available", label: "Available", meaning: "Ready to trade or withdraw" },
  { key: "escrowed", label: "In escrow", meaning: "Held for orders in progress" },
  { key: "pendingWithdrawal", label: "Withdrawing", meaning: "On its way out" },
] as const;

export function BalanceCard({
  balance,
  problem,
  onRetry,
  full = false,
  className,
}: {
  balance: WalletBalance | null;
  /** Why there is no balance to show, when there is not. */
  problem?: string | null | undefined;
  onRetry: () => void;
  /** The Wallet's own: Transfer beside the other two, and what each figure means. */
  full?: boolean;
  className?: string | undefined;
}) {
  const hidden = useBalanceHidden();
  const figure = (value: string | undefined): string =>
    hidden ? MASKED_AMOUNT : value === undefined ? "—" : formatMicro(value);

  /*
    Three across would not fit side by side with their icons on a phone, so
    there each is its icon over its word and the three share the row -
    Binance's way. Two fit as they are.
  */
  const action = cn(
    full &&
      "max-sm:h-[3.75rem] max-sm:flex-1 max-sm:flex-col max-sm:gap-1 max-sm:px-1 max-sm:text-[13px]",
    !full && "max-sm:flex-1",
  );

  return (
    <section
      aria-label="Balance"
      className={cn(
        "rounded-surface border-border bg-surface shadow-panel min-w-0 border px-5 py-5 sm:px-6 sm:py-6",
        className,
      )}
    >
      {/* Beside the figure where there is room; under it where there is not, however long the figure. */}
      <div className="flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-muted-foreground text-[13px] font-medium">Total balance</p>
            <button
              type="button"
              onClick={() => setBalanceHidden(!hidden)}
              aria-label={hidden ? "Show balance" : "Hide balance"}
              aria-pressed={hidden}
              className="rounded-control text-muted-foreground hover:text-foreground -m-1 flex size-7 items-center justify-center transition-colors duration-150"
            >
              {hidden ? <EyeSlash size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="mt-1.5 flex items-baseline gap-2">
            <span
              className={cn(
                "text-foreground font-mono text-[2rem] leading-none font-medium tracking-tight tabular-nums sm:text-[2.375rem]",
                hidden && "tracking-widest",
              )}
            >
              {figure(balance?.total)}
            </span>
            <span className="text-muted-foreground text-sm font-medium">{ASSET.symbol}</span>
          </p>
        </div>

        <div className="flex gap-2">
          <ButtonLink href={walletRoutes.deposit} arrow={false} className={action}>
            <ArrowLineDown size={17} weight="bold" aria-hidden="true" />
            Deposit
          </ButtonLink>
          <ButtonLink
            href={walletRoutes.withdraw}
            variant="secondary"
            arrow={false}
            className={action}
          >
            <ArrowLineUp size={17} weight="bold" aria-hidden="true" />
            Withdraw
          </ButtonLink>
          {full ? (
            // Transfers between BIRQ accounts are not open yet: said, not hidden.
            <button
              type="button"
              disabled
              className={cn(
                buttonClasses({ variant: "secondary", size: "md" }),
                "relative disabled:opacity-100",
                "bg-muted text-muted-foreground border-transparent shadow-none",
                action,
              )}
            >
              <ArrowsLeftRight size={17} weight="bold" aria-hidden="true" />
              Transfer
              <span className="bg-status-neutral text-status-neutral-fg rounded-full px-1.5 py-px text-[11px] leading-4 font-semibold max-sm:absolute max-sm:-top-2 max-sm:-right-1">
                Soon
              </span>
            </button>
          ) : null}
        </div>
      </div>

      <dl className="border-border mt-5 grid grid-cols-3 gap-3 border-t pt-5 sm:gap-6">
        {PARTS.map((part) => (
          <div key={part.key} className="min-w-0">
            <dt className="text-muted-foreground text-[12.5px]">{part.label}</dt>
            <dd
              className={cn(
                "text-foreground mt-0.5 font-mono text-[15px] font-medium tabular-nums sm:text-[17px]",
                hidden && "tracking-widest",
              )}
            >
              {figure(balance?.[part.key])}
            </dd>
            {full ? (
              <dd className="text-muted-foreground mt-0.5 text-[12px] max-sm:hidden">
                {part.meaning}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>

      {problem && !balance ? (
        <LoadFailed message={problem} onRetry={onRetry} className="py-5" />
      ) : null}
    </section>
  );
}
