import type { Metadata } from "next";

import { AdForm } from "@/components/market/ad-form";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Post an ad", robots: appRobots };

export default function NewAdPage() {
  return <AdForm />;
}
