import type { Metadata } from "next";

import { SectionPlaceholder } from "@/components/account/section-placeholder";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Orders", robots: appRobots };

export default function OrdersPage() {
  return (
    <SectionPlaceholder
      title="Orders"
      description="Every trade you have started or taken, open and finished."
      icon="orders"
      empty={{
        title: "No orders yet",
        description: "Once you buy or sell, each trade and its escrow status is listed here.",
      }}
    />
  );
}
