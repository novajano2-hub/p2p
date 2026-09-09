import type { Metadata } from "next";

import { SectionPlaceholder } from "@/components/account/section-placeholder";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Trade", robots: appRobots };

export default function TradePage() {
  return (
    <SectionPlaceholder
      title="Trade"
      description="Buy and sell USDT for birr with other customers. Every trade is held in escrow."
      icon="trade"
      empty={{
        title: "The marketplace is not open yet",
        description: "Offers, prices and payment methods appear here once trading is switched on.",
      }}
    />
  );
}
