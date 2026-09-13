"use client";

import {
  ArrowCircleDown,
  ArrowCircleUp,
  ArrowsLeftRight,
  ClockCounterClockwise,
  Eye,
  EyeSlash,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { EmptyState, PageHeader, Panel } from "@/components/app/panel";
import {
  ActivityList,
  fromDeposit,
  fromWithdrawal,
  type Activity,
} from "@/components/wallet/activity";
import { Amount, useBalanceHidden } from "@/components/wallet/shared";
import { AppLink } from "@/components/ui/app-link";
import { ButtonLink } from "@/components/ui/button";
import { MASKED_AMOUNT, setBalanceHidden } from "@/lib/balance-visibility";
import { walletRoutes } from "@/lib/app-nav";
import { formatMicro } from "@/lib/money";
import { ASSET } from "@/lib/wallet";
import { walletClient, type WalletBalance } from "@/lib/wallet/client";
import { cn } from "@/lib/cn";

/*
  The wallet, in the order somebody actually asks the questions: how much do
  I have, what can I do with it, where is the rest of it, and what happened
  recently.

  Three figures rather than one, because "how much do I have" has three
  answers and a person acting on the wrong one is a person surprised. All
  three come from the ledger on every load: there is no cached balance column
  anywhere in this system, on purpose, so there is nothing here that can drift
  from the entries that made it.

  No estimated birr value. There is no price feed yet, and a figure beside
  somebody's balance that is quietly wrong is worse than no figure at all.
*/

const ACTIONS = [
  {
    href: walletRoutes.deposit,
    title: "Deposit",
    description: `Receive ${ASSET.symbol} from another wallet or exchange.`,
    Icon: ArrowCircleDown,
  },
  {
    href: walletRoutes.withdraw,
    title: "Withdraw",
    description: "Send to an address on a supported network.",
    Icon: ArrowCircleUp,
  },
  {
    href: walletRoutes.transfer,
    title: "Transfer",
    description: "Send to another BIRQ account by its ID. Instant, no fee.",
    Icon: ArrowsLeftRight,
  },
] as const;

const ZERO: WalletBalance = {
  asset: ASSET.symbol,
  available: "0",
  escrowed: "0",
  pendingWithdrawal: "0",
  total: "0",
};

export function WalletOverview() {
  const hidden = useBalanceHidden();
  const [balance, setBalance] = useState<WalletBalance>(ZERO);
  const [activity, setActivity] = useState<Activity[]>([]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [held, deposits, withdrawals] = await Promise.all([
        walletClient.balance(),
        walletClient.deposits(),
        walletClient.withdrawals(),
      ]);
      if (!live) return;
      if (held.ok) setBalance(held.balance);
      const rows: Activity[] = [
        ...(deposits.ok ? deposits.deposits.map((d) => fromDeposit(d)) : []),
        ...(withdrawals.ok ? withdrawals.withdrawals.map((w) => fromWithdrawal(w)) : []),
      ];
      rows.sort((a, b) => b.at.localeCompare(a.at));
      setActivity(rows.slice(0, 10));
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="Wallet"
        description={`Your ${ASSET.symbol}: what you can trade with, what is locked, and how to move it.`}
      />

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <Panel className="lg:col-span-3">
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
                  {hidden ? MASKED_AMOUNT : formatMicro(balance.total)}
                </span>
                <span className="text-muted-foreground text-base font-medium">{ASSET.symbol}</span>
              </p>
              <p className="text-muted-foreground mt-1.5 text-[13px]">
                Everything BIRQ holds for you, wherever it currently is.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <ButtonLink href={walletRoutes.deposit} arrow={false}>
                Deposit
              </ButtonLink>
              <ButtonLink href={walletRoutes.withdraw} variant="secondary" arrow={false}>
                Withdraw
              </ButtonLink>
              <ButtonLink href={walletRoutes.transfer} variant="secondary" arrow={false}>
                Transfer
              </ButtonLink>
            </div>
          </div>

          <dl className="border-border mt-6 grid grid-cols-2 gap-4 border-t pt-5 sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-[12px]">Available</dt>
              <dd className="text-foreground mt-1 font-sans text-lg font-bold">
                <Amount value={balance.available} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-[12px]">In escrow</dt>
              <dd className="text-foreground mt-1 font-sans text-lg font-bold">
                <Amount value={balance.escrowed} />
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-muted-foreground text-[12px]">Withdrawing</dt>
              <dd className="text-foreground mt-1 font-sans text-lg font-bold">
                <Amount value={balance.pendingWithdrawal} />
              </dd>
            </div>
          </dl>

          <p className="text-muted-foreground mt-4 text-[12px] leading-relaxed">
            Escrow holds what is committed to trades in progress. Withdrawing holds what is on its
            way out. Both are yours, and both come back to available if the thing they are held for
            does not happen.
          </p>
        </Panel>

        <div className="lg:col-span-3">
          <ul className="grid gap-3 sm:grid-cols-3" aria-label="Move funds">
            {ACTIONS.map(({ href, title, description, Icon }) => (
              <li key={href}>
                <AppLink
                  href={href}
                  className="group rounded-surface border-border bg-surface shadow-raised-soft hover:border-primary/30 hover:shadow-raised-soft-hover flex h-full items-start gap-3.5 border px-4 py-4 transition-[border-color,box-shadow,translate] duration-150 ease-out hover:-translate-y-px motion-reduce:hover:translate-y-0"
                >
                  <span className="bg-primary-soft text-primary-soft-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
                    <Icon size={22} weight="duotone" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="text-foreground group-hover:text-primary block text-[15px] font-medium transition-colors duration-150">
                      {title}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-[13px] leading-relaxed">
                      {description}
                    </span>
                  </span>
                </AppLink>
              </li>
            ))}
          </ul>
        </div>

        <Panel title="Assets" className="lg:col-span-3">
          <ul>
            <li className="flex items-center justify-between gap-4 py-1">
              <div className="flex min-w-0 items-center gap-3">
                <span className="bg-primary-soft text-primary-soft-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold">
                  ₮
                </span>
                <div className="min-w-0">
                  <p className="text-foreground text-[15px] font-medium">{ASSET.symbol}</p>
                  <p className="text-muted-foreground text-[12px]">{ASSET.name}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-foreground font-sans text-[15px] font-bold">
                  <Amount value={balance.total} unit={null} />
                </p>
                <p className="text-muted-foreground text-[12px]">
                  {hidden ? MASKED_AMOUNT : `${formatMicro(balance.available)} available`}
                </p>
              </div>
            </li>
          </ul>
          <p className="text-muted-foreground border-border mt-4 border-t pt-4 text-[12px] leading-relaxed">
            {ASSET.symbol} is the only asset BIRQ holds. Birr never sits here: it moves directly
            between you and the person you trade with.
          </p>
        </Panel>

        <Panel title="Recent activity" className="lg:col-span-3">
          {activity.length === 0 ? (
            <EmptyState
              icon={ClockCounterClockwise}
              title="Nothing yet"
              description="Deposits and withdrawals are listed here, newest first, with where each one has got to."
            />
          ) : (
            <ActivityList items={activity} />
          )}
        </Panel>
      </div>
    </>
  );
}
