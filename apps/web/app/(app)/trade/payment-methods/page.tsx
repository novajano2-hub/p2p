import type { Metadata } from "next";

import { PaymentMethods } from "@/components/market/payment-methods";
import { appRobots } from "@/lib/app-nav";

export const metadata: Metadata = { title: "Payment methods", robots: appRobots };

export default function PaymentMethodsPage() {
  return <PaymentMethods />;
}
