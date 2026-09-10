"use client";

import { Eye, EyeSlash } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";

import { Panel } from "@/components/app/panel";
import { ButtonLink } from "@/components/ui/button";
import {
  getServerBalanceHidden,
  MASKED_AMOUNT,
  readBalanceHidden,
  setBalanceHidden,
  subscribeBalanceHidden,
} from "@/lib/balance-visibility";
import { cn } from "@/lib/cn";

/*
  The balance card. Three figures a customer needs at a glance: what they can
  trade with now, what is locked in escrow for trades in progress, and roughly
  what that is worth in birr. The ledger that fills these in is Phase 2; until
  then a new account's true balance is zero, and the card says so rather than
  inventing a number.

  The eye toggle masks every figure on the card at once and remembers the
  choice (lib/balance-visibility.ts), the way an exchange app does before a
  screen-share or handing the phone to someone else.

  The balance itself is set in the sans face, not the mono one used for
  identifiers elsewhere in the app: a large bold number with tabular figures
  reads the way a balance does on the exchanges this audience already knows,
  where the amount is typographically the loudest thing on the page.
*/

const stats = [
  { label: "Available", value: "0.00", unit: "USDT" },
  { label: "In escrow", value: "0.00", unit: "USDT" },
  { label: "Estimated value", value: "—", unit: "ETB" },
] as const;

export function WalletCard({ className }: { className?: string | undefined }) {
  const hidden = useSyncExternalStore(
    subscribeBalanceHidden,
    readBalanceHidden,
    getServerBalanceHidden,
  );

  return (
    <Panel className={className}>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-muted-foreground text-[13px] font-medium">Total balance</p>
            <button
              type="button"
              onClick={() => setBalanceHidden(!hidden)}
              aria-label={hidden ? "Show balance" : "Hide balance"}
              aria-pressed={hidden}
              className="rounded-control text-muted-foreground hover:text-foreground -m-1 flex size-6 items-center justify-center transition-colors duration-150"
            >
              {hidden ? <EyeSlash size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <p className="mt-1 flex items-baseline gap-2">
            <span
              className={cn(
                "text-foreground font-sans text-4xl leading-none font-bold tracking-tight tabular-nums",
                hidden && "tracking-widest",
              )}
            >
              {hidden ? MASKED_AMOUNT : "0.00"}
            </span>
            <span className="text-muted-foreground text-base font-medium">USDT</span>
          </p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href="/wallet" arrow={false}>
            Deposit
          </ButtonLink>
          <ButtonLink href="/wallet" variant="secondary" arrow={false}>
            Withdraw
          </ButtonLink>
        </div>
      </div>

      <dl className="border-border mt-6 grid grid-cols-3 gap-4 border-t pt-5">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt className="text-muted-foreground text-[12px]">{stat.label}</dt>
            <dd className="mt-1 flex items-baseline gap-1">
              <span className="text-foreground font-sans text-lg font-bold tabular-nums">
                {hidden ? MASKED_AMOUNT : stat.value}
              </span>
              <span className="text-muted-foreground text-[12px]">{stat.unit}</span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-muted-foreground mt-4 text-[12px] leading-relaxed">
        Deposits and withdrawals open once custody is connected. Nothing can be moved yet.
      </p>
    </Panel>
  );
}
