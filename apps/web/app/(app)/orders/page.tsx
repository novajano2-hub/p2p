import type { Metadata } from "next";
import { Suspense } from "react";

import { Orders } from "@/components/market/orders";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Orders", robots: appRobots };

export default function OrdersPage() {
  return (
    <Suspense>
      <Orders />
    </Suspense>
  );
}
