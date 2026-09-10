"use client";

import {
  ArrowCircleDown,
  ArrowCircleUp,
  ArrowsLeftRight,
  ClockCounterClockwise,
  Eye,
  EyeSlash,
} from "@phosphor-icons/react";

import { EmptyState, PageHeader, Panel } from "@/components/app/panel";
import { Amount, NotOpenNotice, useBalanceHidden } from "@/components/wallet/shared";
import { AppLink } from "@/components/ui/app-link";
import { ButtonLink } from "@/components/ui/button";
import { MASKED_AMOUNT, setBalanceHidden } from "@/lib/balance-visibility";
import { walletRoutes } from "@/lib/app-nav";
import { ASSET, formatEtb } from "@/lib/wallet";
import { cn } from "@/lib/cn";

/*
  The wallet, in the order somebody actually asks the questions: how much do
  I have, what can I do with it, where is the rest of it, and what happened
  recently.

  Every figure is zero because every figure is true. The ledger that fills
  these in is Phase 2; until it exists a new account holds nothing, and the
  screen says so rather than inventing a balance to look impressive.
*/

const BALANCE = { available: 0, escrow: 0 };
const ETB_ESTIMATE = 0;

const actions = [
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

export function WalletOverview() {
  const hidden = useBalanceHidden();
  const total = BALANCE.available + BALANCE.escrow;

  return (
    <>
      <PageHeader
        title="Wallet"
        description={`Your ${ASSET.symbol}: what you can trade with, what is locked, and how to move it.`}
      />

      <NotOpenNotice what="Deposits, withdrawals and transfers" />

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
                  {hidden ? MASKED_AMOUNT : total.toFixed(2)}
                </span>
                <span className="text-muted-foreground text-base font-medium">{ASSET.symbol}</span>
              </p>
              <p className="text-muted-foreground mt-1.5 text-[13px]">
                {hidden ? MASKED_AMOUNT : `≈ ${formatEtb(ETB_ESTIMATE)}`}
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
                <Amount value={BALANCE.available} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-[12px]">In escrow</dt>
              <dd className="text-foreground mt-1 font-sans text-lg font-bold">
                <Amount value={BALANCE.escrow} />
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-muted-foreground text-[12px]">Estimated value</dt>
              <dd className="text-foreground mt-1 font-sans text-lg font-bold tabular-nums">
                {hidden ? MASKED_AMOUNT : formatEtb(ETB_ESTIMATE)}
              </dd>
            </div>
          </dl>

          <p className="text-muted-foreground mt-4 text-[12px] leading-relaxed">
            Escrow holds what is committed to trades in progress. It is yours, and it comes back to
            available when the trade settles or is cancelled.
          </p>
        </Panel>

        <div className="lg:col-span-3">
          <ul className="grid gap-3 sm:grid-cols-3" aria-label="Move funds">
            {actions.map(({ href, title, description, Icon }) => (
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
                  <Amount value={BALANCE.available + BALANCE.escrow} unit={null} />
                </p>
                <p className="text-muted-foreground text-[12px] tabular-nums">
                  {hidden ? MASKED_AMOUNT : `≈ ${formatEtb(ETB_ESTIMATE)}`}
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
          <EmptyState
            icon={ClockCounterClockwise}
            title="Nothing yet"
            description="Deposits, withdrawals, transfers and trades will be listed here, newest first."
          />
        </Panel>
      </div>
    </>
  );
}
