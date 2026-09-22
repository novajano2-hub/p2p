"use client";

import { ActiveTrades } from "@/components/account/active-trades";
import { KycCard, KycPill } from "@/components/account/kyc-card";
import { MarketSnapshot } from "@/components/account/market-snapshot";
import { QuickActions } from "@/components/account/quick-actions";
import { RecentActivity } from "@/components/account/recent-activity";
import { WalletCard } from "@/components/account/wallet-card";
import { UidChip } from "@/components/app/copy-button";
import { useSession } from "@/components/app/session-provider";
import { timeGreeting } from "@/lib/greeting";

/*
  Home for a signed-in customer, in the order of what they want to know: who
  am I here, how much do I have and what can I do with it, is anything in
  progress, what is the price, what happened recently.

  Who you are comes first, the way an exchange's dashboard has it: the name,
  the account number to hand to someone, and where verification stands - a
  pill that is always there and always the way to /verify, however long ago
  the card under it was dismissed.

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
      <div className="mb-6 flex items-center gap-3.5">
        <span
          aria-hidden="true"
          className="bg-primary-soft text-primary-soft-foreground flex size-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold uppercase sm:size-14 sm:text-xl"
        >
          {user.username.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-foreground text-[1.375rem] leading-tight [overflow-wrap:anywhere] sm:text-[1.75rem]">
            {timeGreeting()}, {user.username}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <UidChip platformId={user.platformId} />
            <KycPill />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:gap-5">
        <KycCard />
        <div className="grid gap-4 lg:grid-cols-3 lg:items-start lg:gap-5">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-2 lg:gap-5">
            <WalletCard />
            <QuickActions />
            <ActiveTrades />
          </div>
          <div className="flex min-w-0 flex-col gap-4 lg:gap-5">
            <MarketSnapshot />
            <RecentActivity />
          </div>
        </div>
      </div>
    </>
  );
}
