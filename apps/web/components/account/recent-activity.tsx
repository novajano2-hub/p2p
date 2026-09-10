"use client";

import { ClockCounterClockwise } from "@phosphor-icons/react";

import { EmptyState, Panel } from "@/components/app/panel";

/*
  The account's history in one stream: deposits, trades, withdrawals, and the
  fees on each. It is the customer-facing face of the ledger, so it fills in
  when the ledger does (Phase 2).
*/
export function RecentActivity({ className }: { className?: string | undefined }) {
  return (
    <Panel title="Recent activity" className={className}>
      <EmptyState
        icon={ClockCounterClockwise}
        title="Nothing yet"
        description="Deposits, trades and withdrawals will be listed here, newest first."
      />
    </Panel>
  );
}
