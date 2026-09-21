"use client";

import { ClockCounterClockwise } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { LoadFailed } from "@/components/app/load-failed";
import { EmptyState, Panel } from "@/components/app/panel";
import { ActivityBrief, mergeActivity, type Activity } from "@/components/wallet/activity";
import { AppLink } from "@/components/ui/app-link";
import { walletClient } from "@/lib/wallet/client";

/*
  The last few things that came in or went out, with where each has got to.

  For a long time this panel had nothing behind it and said "Nothing yet" to
  everybody. It reads what the Wallet reads - deposits and withdrawals, newest
  first - and sends anyone who wants the whole story there. Orders have their
  own panel above, and their own page.
*/

/** As many as Home shows. */
const SHOWN = 4;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: Activity[] };

export function RecentActivity({ className }: { className?: string | undefined }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(() => {
    void Promise.all([walletClient.deposits(), walletClient.withdrawals()]).then(
      ([deposits, withdrawals]) => {
        if (!deposits.ok || !withdrawals.ok) {
          const failed = !deposits.ok ? deposits : withdrawals;
          setState({ status: "error", message: failed.ok ? "" : failed.message });
          return;
        }
        // Cancelling belongs to the Wallet, where the whole row is: here it is only told.
        const rows = mergeActivity(deposits.deposits, withdrawals.withdrawals, () => undefined);
        setState({ status: "ready", rows: rows.slice(0, SHOWN) });
      },
    );
  }, []);
  useEffect(load, [load]);

  return (
    <Panel
      title="Recent activity"
      action={
        <AppLink
          href="/wallet"
          className="text-primary hover:text-primary-hover font-medium underline-offset-4 hover:underline"
        >
          Wallet
        </AppLink>
      }
      className={className}
    >
      {state.status === "loading" ? (
        <p className="text-muted-foreground px-4 py-8 text-center text-[13px]">Loading…</p>
      ) : state.status === "error" ? (
        <LoadFailed
          message={state.message}
          onRetry={() => {
            setState({ status: "loading" });
            load();
          }}
        />
      ) : state.rows.length === 0 ? (
        <EmptyState
          icon={ClockCounterClockwise}
          title="Nothing yet"
          description="Deposits and withdrawals are listed here, newest first."
        />
      ) : (
        <ActivityBrief items={state.rows} />
      )}
    </Panel>
  );
}
