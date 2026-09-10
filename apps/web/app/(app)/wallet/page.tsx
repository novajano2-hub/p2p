import type { Metadata } from "next";

import { WalletOverview } from "@/components/wallet/wallet-overview";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Wallet", robots: appRobots };

export default function WalletPage() {
  return <WalletOverview />;
}
