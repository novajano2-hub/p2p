import type { Metadata } from "next";

import { MyAds } from "@/components/market/my-ads";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "My ads", robots: appRobots };

export default function MyAdsPage() {
  return <MyAds />;
}
