import type { Metadata } from "next";

import { TradeView } from "@/components/market/trade-view";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Trade", robots: appRobots };

export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TradeView tradeId={id} />;
}
