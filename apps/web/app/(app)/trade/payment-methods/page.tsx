import type { Metadata } from "next";
import { Suspense } from "react";

import { PaymentMethods } from "@/components/market/payment-methods";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Payment methods", robots: appRobots };

/* Suspense because the page reads ?next= from the URL on the client. */
export default function PaymentMethodsPage() {
  return (
    <Suspense fallback={null}>
      <PaymentMethods />
    </Suspense>
  );
}
