import type { Metadata } from "next";

import { AdForm } from "@/components/market/ad-form";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Edit ad", robots: appRobots };

export default async function EditAdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdForm offerId={id} />;
}
