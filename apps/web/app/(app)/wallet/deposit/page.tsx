import type { Metadata } from "next";

import { DepositView } from "@/components/wallet/deposit-view";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Deposit", robots: appRobots };

export default function DepositPage() {
  return <DepositView />;
}
