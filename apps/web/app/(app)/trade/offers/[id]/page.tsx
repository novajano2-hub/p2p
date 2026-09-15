import type { Metadata } from "next";

import { TakeOffer } from "@/components/market/take-offer";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Take an offer", robots: appRobots };

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TakeOffer offerId={id} />;
}
