"use client";

import { Eye, EyeSlash } from "@phosphor-icons/react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Panel } from "@/components/app/panel";
import { ButtonLink } from "@/components/ui/button";
import {
  getServerBalanceHidden,
  MASKED_AMOUNT,
  readBalanceHidden,
  setBalanceHidden,
  subscribeBalanceHidden,
} from "@/lib/balance-visibility";
import { walletRoutes } from "@/lib/app-nav";
import { cn } from "@/lib/cn";
import { formatMicro } from "@/lib/money";
import { walletClient, type WalletBalance } from "@/lib/wallet/client";

/*
  The balance card. Three figures a customer needs at a glance: what they can
  trade with now, what is locked in escrow for trades in progress, and the
  total. All three come from the ledger on every load, the same read the
  wallet page makes; there is no cached balance column anywhere in this
  system, on purpose.

  No estimated birr value. There is no price feed, and a figure beside
  somebody's balance that is quietly wrong is worse than no figure at all.

  The eye toggle masks every figure on the card at once and remembers the
  choice (lib/balance-visibility.ts), the way an exchange app does before a
  screen-share or handing the phone to someone else.
*/

export function WalletCard({ className }: { className?: string | undefined }) {
  const hidden = useSyncExternalStore(
    subscribeBalanceHidden,
    readBalanceHidden,
    getServerBalanceHidden,
  );
  const [balance, setBalance] = useState<WalletBalance | null>(null);

  useEffect(() => {
    let live = true;
    void walletClient.balance().then((result) => {
      if (live && result.ok) setBalance(result.balance);
    });
    return () => {
      live = false;
    };
  }, []);

  const figure = (value: string | undefined): string =>
    hidden ? MASKED_AMOUNT : value === undefined ? "—" : formatMicro(value);

  const stats = [
    { label: "Available", value: figure(balance?.available) },
    { label: "In escrow", value: figure(balance?.escrowed) },
    { label: "Withdrawing", value: figure(balance?.pendingWithdrawal) },
  ];

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
              {figure(balance?.total)}
            </span>
            <span className="text-muted-foreground text-base font-medium">USDT</span>
          </p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href={walletRoutes.deposit} arrow={false}>
            Deposit
          </ButtonLink>
          <ButtonLink href={walletRoutes.withdraw} variant="secondary" arrow={false}>
            Withdraw
          </ButtonLink>
        </div>
      </div>

      <dl className="border-border mt-6 grid grid-cols-3 gap-4 border-t pt-5">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt className="text-muted-foreground text-[12px]">{stat.label}</dt>
            <dd
              className={cn(
                "text-foreground mt-0.5 text-[15px] font-medium tabular-nums",
                hidden && "tracking-widest",
              )}
            >
              {stat.value}{" "}
              <span className="text-muted-foreground text-[12px] font-normal">USDT</span>
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
