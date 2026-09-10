import type { Metadata } from "next";

import { TransferView } from "@/components/wallet/transfer-view";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Transfer", robots: appRobots };

export default function TransferPage() {
  return <TransferView />;
}
