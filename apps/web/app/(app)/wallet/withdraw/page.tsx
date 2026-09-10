import type { Metadata } from "next";

import { WithdrawView } from "@/components/wallet/withdraw-view";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Withdraw", robots: appRobots };

export default function WithdrawPage() {
  return <WithdrawView />;
}
