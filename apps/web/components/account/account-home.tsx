"use client";

import { ActiveTrades } from "@/components/account/active-trades";
import { KycCard, KycPill } from "@/components/account/kyc-card";
import { MarketSnapshot } from "@/components/account/market-snapshot";
import { QuickActions } from "@/components/account/quick-actions";
import { RecentActivity } from "@/components/account/recent-activity";
import { WalletCard } from "@/components/account/wallet-card";
import { UidChip } from "@/components/app/copy-button";
import { PageHeader } from "@/components/app/panel";
import { useSession } from "@/components/app/session-provider";
import { StatusPill } from "@/components/ui/status-pill";
import { timeGreeting } from "@/lib/greeting";

/*
  Home for a signed-in customer. Reading order matches what they want to know:
  how much do I have, what can I do, is anything in progress, what is the
  price, is my account safe, what happened recently.

  The greeting stands in for a page title - nobody needs to be told they are
  on the page called "Home". It is computed on every render rather than once
  on mount, which is fine here: this component only ever renders on the
  client, after SessionProvider has a session, so there is no server-rendered
  hour for it to disagree with.
*/
export function AccountHome() {
  const { user } = useSession();

  return (
    <>
      <PageHeader title={`${timeGreeting()}, ${user.username}`}>
        <UidChip platformId={user.platformId} />
        <KycPill />
        <StatusPill status={user.status === "ACTIVE" ? "complete" : "attention"}>
          {user.status === "ACTIVE" ? "Account active" : "Account suspended"}
        </StatusPill>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <KycCard className="lg:col-span-3" />

        <WalletCard className="lg:col-span-3" />

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
