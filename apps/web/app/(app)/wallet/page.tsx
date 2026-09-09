import type { Metadata } from "next";

import { SectionPlaceholder } from "@/components/account/section-placeholder";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Wallet", robots: appRobots };

export default function WalletPage() {
  return (
    <SectionPlaceholder
      title="Wallet"
      description="Your USDT: deposit addresses, withdrawals, and where every unit is right now."
      icon="wallet"
      empty={{
        title: "Deposits and withdrawals are not open yet",
        description:
          "Your deposit address and withdrawal form appear here once custody is connected.",
      }}
    />
  );
}
