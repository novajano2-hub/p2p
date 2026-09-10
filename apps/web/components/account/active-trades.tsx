"use client";

import { Handshake } from "@phosphor-icons/react";

import { EmptyState, Panel } from "@/components/app/panel";
import { AppLink } from "@/components/ui/app-link";
import { ButtonLink } from "@/components/ui/button";

/*
  Trades in progress: the ones where money is moving and a timer is running.
  This is the panel a customer checks most while a trade is open, so it sits
  high on the page. Populated by the trade engine in Phase 2.
*/
export function ActiveTrades({ className }: { className?: string | undefined }) {
  return (
    <Panel
      title="Active trades"
      description="Escrow status, payment windows and what to do next."
      action={
        <AppLink
          href="/orders"
          className="text-primary hover:text-primary-hover font-medium underline-offset-4 hover:underline"
        >
          All orders
        </AppLink>
      }
      className={className}
    >
      <EmptyState
        icon={Handshake}
        title="No active trades"
        description="When you buy or sell, the escrow and the payment countdown show up here."
        action={
          <ButtonLink href="/trade" size="sm" variant="secondary" arrow={false}>
            Find an offer
          </ButtonLink>
        }
      />
    </Panel>
  );
}
