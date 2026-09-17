import type { Metadata } from "next";
import { Suspense } from "react";

import { MyAds } from "@/components/market/my-ads";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "My ads", robots: appRobots };

/* Suspense because the screen reads ?tab= from the URL on the client. */
export default function MyAdsPage() {
  return (
    <Suspense fallback={null}>
      <MyAds />
    </Suspense>
  );
}
