"use client";

import { ActiveTrades } from "@/components/account/active-trades";
import { MarketSnapshot } from "@/components/account/market-snapshot";
import { QuickActions } from "@/components/account/quick-actions";
import { RecentActivity } from "@/components/account/recent-activity";
import { SecurityChecklist } from "@/components/account/security-checklist";
import { WalletCard } from "@/components/account/wallet-card";
import { PageHeader } from "@/components/app/panel";
import { useSession } from "@/components/app/session-provider";
import { StatusPill } from "@/components/ui/status-pill";

/*
  Home for a signed-in customer. Reading order matches what they want to know:
  how much do I have, what can I do, is anything in progress, what is the
  price, is my account safe, what happened recently.
*/
export function AccountHome() {
  const { user } = useSession();

  return (
    <>
      <PageHeader title="Home" description={`Signed in as ${user.email}`}>
        <StatusPill status={user.status === "ACTIVE" ? "complete" : "attention"}>
          {user.status === "ACTIVE" ? "Account active" : "Account suspended"}
        </StatusPill>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <WalletCard className="lg:col-span-2" />
        <SecurityChecklist />

        <div className="lg:col-span-3">
          <QuickActions />
        </div>

        <ActiveTrades className="lg:col-span-2" />
        <MarketSnapshot />

        <RecentActivity className="lg:col-span-3" />
      </div>
    </>
  );
}
