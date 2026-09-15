import type { Metadata } from "next";
import { Suspense } from "react";

import { Marketplace } from "@/components/market/marketplace";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Trade", robots: appRobots };

/* Suspense because the marketplace reads ?want= from the URL on the client. */
export default function TradePage() {
  return (
    <Suspense fallback={null}>
      <Marketplace />
    </Suspense>
  );
}
