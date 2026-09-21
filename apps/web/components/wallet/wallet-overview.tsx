"use client";

import { ClockCounterClockwise, Info } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { LoadFailed } from "@/components/app/load-failed";
import { EmptyState, PageHeader, Panel } from "@/components/app/panel";
import { ActivityList, mergeActivity, type Activity } from "@/components/wallet/activity";
import { BalanceCard } from "@/components/wallet/balance-card";
import { Tabs } from "@/components/ui/tabs";
import { ASSET } from "@/lib/wallet";
import {
  walletClient,
  type Deposit,
  type WalletBalance,
  type Withdrawal,
} from "@/lib/wallet/client";
import { useInFlight } from "@/lib/wallet/use-in-flight";

/*
  The wallet, in the order somebody actually asks the questions: how much do
  I have and what can I do with it, then what happened recently and where
  each of those has got to.

  The balance card is the one Home uses, with Transfer beside the other two
  and a line under each figure saying what it means. Under it, everything
  that came in or went out, as one table that can be narrowed to either.

  It watches while anything is still moving - a deposit the network is
  counting, a withdrawal being checked or sent - so the bar fills and the
  word changes without a press (use-in-flight.ts), and asks nothing while
  nothing is.
*/

/** How many movements each tab lists. The pages for depositing and withdrawing keep their own. */
const SHOWN = 10;

type Loaded<T> =
  { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: T };

interface Movements {
  deposits: Deposit[];
  withdrawals: Withdrawal[];
}

export function WalletOverview() {
  const [held, setHeld] = useState<Loaded<WalletBalance>>({ status: "loading" });
  const [moved, setMoved] = useState<Loaded<Movements>>({ status: "loading" });

  const load = useCallback(() => {
    void Promise.all([
      walletClient.balance(),
      walletClient.deposits(),
      walletClient.withdrawals(),
    ]).then(([balance, deposits, withdrawals]) => {
      // A reload that fails leaves what was on the screen where it is.
      setHeld((current) =>
        balance.ok
          ? { status: "ready", value: balance.balance }
          : current.status === "ready"
            ? current
            : { status: "error", message: balance.message },
      );
      setMoved((current) => {
        if (deposits.ok && withdrawals.ok) {
          return {
            status: "ready",
            value: { deposits: deposits.deposits, withdrawals: withdrawals.withdrawals },
          };
        }
        if (current.status === "ready") return current;
        const failed = !deposits.ok ? deposits : withdrawals;
        return { status: "error", message: failed.ok ? "" : failed.message };
      });
    });
  }, []);
  useEffect(load, [load]);

  const retry = () => {
    setHeld((current) => (current.status === "ready" ? current : { status: "loading" }));
    setMoved((current) => (current.status === "ready" ? current : { status: "loading" }));
    load();
  };

  const movements = moved.status === "ready" ? moved.value : null;
  useInFlight(
    movements !== null &&
      (movements.deposits.some((d) => d.status === "DETECTED" || d.status === "CONFIRMING") ||
        movements.withdrawals.some(
          (w) => w.stage === "PENDING" || w.stage === "HELD" || w.stage === "SENDING",
        )),
    load,
  );

  const list = (rows: Activity[], nothing: string) =>
    rows.length === 0 ? (
      <EmptyState icon={ClockCounterClockwise} title="Nothing yet" description={nothing} />
    ) : (
      <ActivityList items={rows.slice(0, SHOWN)} />
    );

  return (
    <>
      <PageHeader
        title="Wallet"
        description={`Your ${ASSET.symbol}: what you can trade with, what is held, and how to move it.`}
      />

      <div className="flex flex-col gap-4 lg:gap-5">
        <BalanceCard
          full
          balance={held.status === "ready" ? held.value : null}
          problem={held.status === "error" ? held.message : null}
          onRetry={retry}
        />

        <p className="text-muted-foreground flex items-start gap-2 px-1 text-[12.5px] leading-relaxed">
          <Info size={15} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            {ASSET.symbol} is the only asset BIRQ holds. ETB never sits here: it moves directly
            between you and the person you trade with. What is in escrow or being withdrawn is still
            yours, and comes back to available if the thing it is held for does not happen.
          </span>
        </p>

        <Panel title="Activity">
          {moved.status === "loading" ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-[13px]">Loading…</p>
          ) : moved.status === "error" ? (
            <LoadFailed message={moved.message} onRetry={retry} />
          ) : (
            <Tabs
              label="Activity"
              items={[
                {
                  id: "all",
                  label: "All",
                  content: list(
                    mergeActivity(moved.value.deposits, moved.value.withdrawals, load),
                    "Deposits and withdrawals are listed here, newest first, with where each one has got to.",
                  ),
                },
                {
                  id: "deposits",
                  label: "Deposits",
                  content: list(
                    mergeActivity(moved.value.deposits, [], load),
                    "Deposits appear here as soon as we see them on the chain, before they are credited.",
                  ),
                },
                {
                  id: "withdrawals",
                  label: "Withdrawals",
                  content: list(
                    mergeActivity([], moved.value.withdrawals, load),
                    "Withdrawals appear here from the moment you request one, with where each has got to.",
                  ),
                },
              ]}
            />
          )}
        </Panel>
      </div>
    </>
  );
}
